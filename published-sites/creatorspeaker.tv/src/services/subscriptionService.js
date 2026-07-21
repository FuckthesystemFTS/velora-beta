const crypto = require("crypto");

const db = require("../db");
const { requiredText, isEmail, toInt } = require("../utils/validators");

const REQUEST_STATUSES = {
  pending: "In attesa",
  payment_waiting: "Da verificare",
  payment_received: "Pagamento ricevuto",
  active: "Attiva",
  rejected: "Rifiutata",
  suspended: "Sospesa",
  expired: "Scaduta"
};

const PAYMENT_STATUSES = {
  waiting: "Da verificare",
  received: "Ricevuto",
  rejected: "Rifiutato",
  refunded: "Rimborsato",
  not_required: "Non richiesto"
};

const ASSIGNMENT_STATUSES = {
  active: "Attivo",
  suspended: "Sospeso",
  revoked: "Revocato",
  expired: "Scaduto"
};

const ISSUE_STATUSES = {
  open: "Aperta",
  in_progress: "In gestione",
  closed: "Chiusa"
};

const ISSUE_TYPES = [
  "non riesco ad accedere",
  "password non funziona",
  "accesso non attivo",
  "accesso scaduto",
  "pagamento gia effettuato",
  "altro"
];

function subscriptionsEnabled() {
  return String(process.env.SUBSCRIPTIONS_ENABLED || "true") === "true";
}

function hasSubscriptionsKey() {
  return Boolean(requiredText(process.env.SUBSCRIPTIONS_SECRET_KEY));
}

function normalizeSecretKey() {
  const raw = requiredText(process.env.SUBSCRIPTIONS_SECRET_KEY);
  if (!raw) {
    throw new Error("SUBSCRIPTIONS_SECRET_KEY missing");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSecret(value) {
  const normalized = requiredText(value);
  if (!normalized) {
    return "";
  }
  const key = normalizeSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value) {
  const normalized = requiredText(value);
  if (!normalized) {
    return "";
  }
  const key = normalizeSecretKey();
  const [ivEncoded, tagEncoded, payloadEncoded] = normalized.split(":");
  if (!ivEncoded || !tagEncoded || !payloadEncoded) {
    throw new Error("Encrypted secret payload is invalid");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivEncoded, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadEncoded, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function maskEmail(value) {
  const normalized = requiredText(value);
  if (!normalized || !normalized.includes("@")) {
    return normalized ? "indirizzo presente" : "non impostata";
  }
  const [local, domain] = normalized.split("@");
  if (!local) {
    return `*@${domain}`;
  }
  const first = local.slice(0, 1);
  const maskedLocal = `${first}${"*".repeat(Math.max(4, local.length - 1))}`;
  return `${maskedLocal}@${domain}`;
}

function maskSecret(value) {
  return requiredText(value) ? "****************" : "non impostata";
}

function coerceBool(value) {
  return db.meta.driver === "pg" ? Boolean(value) : Number(Boolean(value));
}

function statusBadge(kind, status) {
  const map =
    kind === "request"
      ? REQUEST_STATUSES
      : kind === "payment"
        ? PAYMENT_STATUSES
        : kind === "issue"
          ? ISSUE_STATUSES
          : ASSIGNMENT_STATUSES;
  return map[status] || status;
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function toSqlDateTime(value) {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function sanitizePlatformPayload(body) {
  const name = requiredText(body.name);
  const slug = requiredText(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  const maxUsers = Math.max(1, toInt(body.max_users, 1));
  const durationDays = Math.max(1, toInt(body.duration_days, 30));
  return {
    name,
    slug,
    description: requiredText(body.description),
    public_description: requiredText(body.public_description),
    status: requiredText(body.status || "active"),
    max_users: maxUsers,
    price_per_user: Math.max(0, toInt(body.price_per_user, 0)),
    currency: requiredText(body.currency || "EUR").toUpperCase(),
    duration_days: durationDays,
    platform_url: requiredText(body.platform_url),
    login_url: requiredText(body.login_url),
    shared_login_email_encrypted: requiredText(body.shared_login_email)
      ? encryptSecret(requiredText(body.shared_login_email).toLowerCase())
      : "",
    shared_login_password_encrypted: requiredText(body.shared_login_password)
      ? encryptSecret(requiredText(body.shared_login_password))
      : "",
    admin_private_notes_encrypted: requiredText(body.admin_private_notes)
      ? encryptSecret(requiredText(body.admin_private_notes))
      : "",
    user_visible_instructions: requiredText(body.user_visible_instructions),
    active_users_count: 0
  };
}

async function ensurePlatformCount(platformId) {
  const row = await db.get(
    "SELECT COUNT(*) AS total FROM subscription_assignments WHERE platform_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)",
    [platformId]
  );
  await db.run(
    "UPDATE subscription_platforms SET active_users_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [Number((row && row.total) || 0), platformId]
  );
}

async function expireAssignments() {
  const changed = await db.run(
    "UPDATE subscription_assignments SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP",
    []
  );
  await db.run(
    "UPDATE subscription_requests SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND id IN (SELECT request_id FROM subscription_assignments WHERE status = 'expired' AND request_id IS NOT NULL)",
    []
  );
  const platforms = await db.all("SELECT id FROM subscription_platforms");
  for (const platform of platforms) {
    await ensurePlatformCount(platform.id);
  }
  return changed;
}

async function getPlatformBySlug(slug) {
  return db.get("SELECT * FROM subscription_platforms WHERE slug = ?", [slug]);
}

async function getPlatformById(id) {
  return db.get("SELECT * FROM subscription_platforms WHERE id = ?", [id]);
}

async function listPlatforms(includeInactive = false) {
  const sql = includeInactive
    ? "SELECT * FROM subscription_platforms ORDER BY created_at ASC, id ASC"
    : "SELECT * FROM subscription_platforms WHERE status = 'active' ORDER BY created_at ASC, id ASC";
  const rows = await db.all(sql);
  return rows.map(enrichPlatform);
}

function enrichPlatform(platform) {
  if (!platform) {
    return null;
  }
  let decryptedEmail = "";
  let decryptedPassword = "";
  let decryptedNotes = "";
  if (hasSubscriptionsKey()) {
    try {
      decryptedEmail = decryptSecret(platform.shared_login_email_encrypted);
    } catch (error) {
      decryptedEmail = "";
    }
    try {
      decryptedPassword = decryptSecret(platform.shared_login_password_encrypted);
    } catch (error) {
      decryptedPassword = "";
    }
    try {
      decryptedNotes = decryptSecret(platform.admin_private_notes_encrypted);
    } catch (error) {
      decryptedNotes = "";
    }
  }
  return {
    ...platform,
    active_users_count: Number(platform.active_users_count || 0),
    max_users: Number(platform.max_users || 0),
    price_per_user: Number(platform.price_per_user || 0),
    duration_days: Number(platform.duration_days || 0),
    spots_left: Math.max(0, Number(platform.max_users || 0) - Number(platform.active_users_count || 0)),
    status_label: statusBadge("assignment", platform.status === "active" ? "active" : platform.status),
    maskedEmail: maskEmail(decryptedEmail),
    maskedPassword: maskSecret(decryptedPassword),
    hasPrivateNotes: Boolean(decryptedNotes),
    decryptedEmail,
    decryptedPassword,
    decryptedNotes
  };
}

function requestSummaryLabel(status) {
  return REQUEST_STATUSES[status] || status;
}

function paymentSummaryLabel(status) {
  return PAYMENT_STATUSES[status] || status;
}

function assignmentSummaryLabel(status) {
  return ASSIGNMENT_STATUSES[status] || status;
}

async function buildUserAccessState(userId, slug = null) {
  await expireAssignments();
  const params = [userId];
  let where = "";
  if (slug) {
    params.push(slug);
    where = "AND subscription_platforms.slug = ?";
  }
  const rows = await db.all(
    `SELECT
      subscription_platforms.*,
      subscription_requests.id AS request_id,
      subscription_requests.status AS request_status,
      subscription_requests.payment_status,
      subscription_requests.payment_note,
      subscription_requests.payment_reference,
      subscription_requests.payment_received_at,
      subscription_requests.admin_note,
      subscription_requests.message AS request_message,
      subscription_requests.created_at AS request_created_at,
      subscription_assignments.id AS assignment_id,
      subscription_assignments.status AS assignment_status,
      subscription_assignments.starts_at,
      subscription_assignments.expires_at,
      subscription_assignments.user_visible_note,
      subscription_assignments.credentials_view_count,
      subscription_assignments.last_credentials_viewed_at
    FROM subscription_platforms
    LEFT JOIN subscription_requests
      ON subscription_requests.platform_id = subscription_platforms.id
      AND subscription_requests.user_id = ?
    LEFT JOIN subscription_assignments
      ON subscription_assignments.platform_id = subscription_platforms.id
      AND subscription_assignments.user_id = ?
      AND subscription_assignments.id = (
        SELECT inner_assignments.id
        FROM subscription_assignments AS inner_assignments
        WHERE inner_assignments.user_id = subscription_assignments.user_id
          AND inner_assignments.platform_id = subscription_assignments.platform_id
        ORDER BY inner_assignments.created_at DESC, inner_assignments.id DESC
        LIMIT 1
      )
    WHERE subscription_platforms.status IN ('active', 'inactive') ${where}
    ORDER BY subscription_platforms.created_at ASC, subscription_platforms.id ASC`,
    slug ? [userId, userId, slug] : [userId, userId]
  );

  return rows.map((row) => {
    const platform = enrichPlatform(row);
    const assignmentStatus = requiredText(row.assignment_status);
    const requestStatus = requiredText(row.request_status);
    const isActive =
      assignmentStatus === "active" &&
      (!row.expires_at || new Date(row.expires_at).getTime() >= Date.now()) &&
      platform.status === "active";
    return {
      ...platform,
      request_id: row.request_id,
      request_status: requestStatus,
      request_status_label: requestSummaryLabel(requestStatus),
      payment_status: row.payment_status,
      payment_status_label: paymentSummaryLabel(row.payment_status),
      payment_note: row.payment_note,
      payment_reference: row.payment_reference,
      payment_received_at: row.payment_received_at,
      admin_note: row.admin_note,
      request_message: row.request_message,
      request_created_at: row.request_created_at,
      assignment_id: row.assignment_id,
      assignment_status: assignmentStatus,
      assignment_status_label: assignmentSummaryLabel(assignmentStatus),
      starts_at: row.starts_at,
      expires_at: row.expires_at,
      starts_at_label: formatDate(row.starts_at),
      expires_at_label: formatDate(row.expires_at),
      last_credentials_viewed_at: row.last_credentials_viewed_at,
      last_credentials_viewed_at_label: formatDateTime(row.last_credentials_viewed_at),
      credentials_view_count: Number(row.credentials_view_count || 0),
      user_visible_note: row.user_visible_note,
      canRevealCredentials: isActive,
      hasPendingRequest: Boolean(requestStatus) && !assignmentStatus,
      isActive
    };
  });
}

async function createRequest({ userId, platformId, fullName, email, phone, message }) {
  if (!fullName || !isEmail(email)) {
    throw new Error("Dati richiesta non validi");
  }
  const existingOpen = await db.get(
    "SELECT id, status FROM subscription_requests WHERE user_id = ? AND platform_id = ? AND status IN ('pending', 'payment_waiting', 'payment_received', 'active', 'suspended') ORDER BY created_at DESC LIMIT 1",
    [userId, platformId]
  );
  if (existingOpen) {
    throw new Error("Esiste gia una richiesta in gestione per questa piattaforma");
  }

  const id = await db.insert("subscription_requests", {
    user_id: userId,
    platform_id: platformId,
    full_name: fullName,
    email: email.toLowerCase(),
    phone,
    message,
    status: "pending",
    payment_status: "waiting",
    payment_reference: "",
    payment_note: "",
    payment_received_at: null,
    admin_note: ""
  });

  await db.insert("notifications_log", {
    type: "subscription_request_created",
    target: "admin",
    subject: "Nuova richiesta abbonamento",
    body: `Utente ${fullName} ha richiesto accesso alla piattaforma #${platformId}`,
    status: "new"
  });

  return id;
}

async function createAdminLog({
  adminId,
  userId = null,
  platformId = null,
  requestId = null,
  assignmentId = null,
  action,
  details = ""
}) {
  return db.insert("subscription_admin_logs", {
    admin_id: adminId,
    user_id: userId,
    platform_id: platformId,
    request_id: requestId,
    assignment_id: assignmentId,
    action,
    details
  });
}

async function getRequestDetail(id) {
  const row = await db.get(
    `SELECT
      subscription_requests.*,
      users.name AS user_name,
      users.email AS user_account_email,
      subscription_platforms.name AS platform_name,
      subscription_platforms.slug AS platform_slug,
      subscription_platforms.max_users,
      subscription_platforms.active_users_count,
      subscription_platforms.duration_days
    FROM subscription_requests
    LEFT JOIN users ON users.id = subscription_requests.user_id
    LEFT JOIN subscription_platforms ON subscription_platforms.id = subscription_requests.platform_id
    WHERE subscription_requests.id = ?`,
    [id]
  );
  if (!row) {
    return null;
  }
  const logs = await db.all(
    "SELECT subscription_admin_logs.*, admins.username AS admin_username FROM subscription_admin_logs LEFT JOIN admins ON admins.id = subscription_admin_logs.admin_id WHERE request_id = ? ORDER BY created_at DESC, id DESC",
    [id]
  );
  return {
    ...row,
    status_label: requestSummaryLabel(row.status),
    payment_status_label: paymentSummaryLabel(row.payment_status),
    logs
  };
}

async function activateAssignment({
  adminId,
  requestId,
  startsAt,
  expiresAt,
  userVisibleNote,
  adminPrivateNote
}) {
  const request = await getRequestDetail(requestId);
  if (!request) {
    throw new Error("Richiesta non trovata");
  }
  if (!["received", "not_required"].includes(request.payment_status)) {
    throw new Error("Pagamento o autorizzazione non ancora verificati");
  }
  if (Number(request.active_users_count || 0) >= Number(request.max_users || 0)) {
    throw new Error("Posti disponibili esauriti per questa piattaforma");
  }

  const assignmentId = await db.insert("subscription_assignments", {
    user_id: request.user_id,
    platform_id: request.platform_id,
    request_id: request.id,
    status: "active",
    starts_at: toSqlDateTime(startsAt),
    expires_at: expiresAt ? toSqlDateTime(expiresAt) : null,
    user_visible_note: userVisibleNote,
    admin_private_note_encrypted: requiredText(adminPrivateNote) ? encryptSecret(adminPrivateNote) : "",
    activated_by_admin_id: adminId,
    credentials_view_count: 0,
    last_credentials_viewed_at: null
  });

  await db.run(
    "UPDATE subscription_requests SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [request.id]
  );
  await ensurePlatformCount(request.platform_id);
  await createAdminLog({
    adminId,
    userId: request.user_id,
    platformId: request.platform_id,
    requestId: request.id,
    assignmentId,
    action: "assignment_activated",
    details: `Validita dal ${startsAt} al ${expiresAt || "senza scadenza"}`
  });
  await db.insert("notifications_log", {
    type: "subscription_assignment_activated",
    target: String(request.user_account_email || request.email || request.user_id),
    subject: "Accesso attivato",
    body: `Il tuo accesso a ${request.platform_name} e attivo`,
    status: "logged"
  });
  return assignmentId;
}

async function getAssignmentForUser(userId, slug) {
  await expireAssignments();
  return db.get(
    `SELECT
      subscription_assignments.*,
      subscription_platforms.name AS platform_name,
      subscription_platforms.slug AS platform_slug,
      subscription_platforms.status AS platform_status,
      subscription_platforms.login_url,
      subscription_platforms.platform_url,
      subscription_platforms.user_visible_instructions,
      subscription_platforms.shared_login_email_encrypted,
      subscription_platforms.shared_login_password_encrypted
    FROM subscription_assignments
    INNER JOIN subscription_platforms ON subscription_platforms.id = subscription_assignments.platform_id
    WHERE subscription_assignments.user_id = ?
      AND subscription_platforms.slug = ?
    ORDER BY subscription_assignments.created_at DESC, subscription_assignments.id DESC
    LIMIT 1`,
    [userId, slug]
  );
}

async function revealCredentialsForUser({ userId, slug, ipAddress, userAgent }) {
  if (!hasSubscriptionsKey()) {
    throw new Error("Chiave di cifratura mancante");
  }
  const assignment = await getAssignmentForUser(userId, slug);
  if (!assignment) {
    throw new Error("Accesso non trovato");
  }
  const expired = assignment.expires_at && new Date(assignment.expires_at).getTime() < Date.now();
  if (
    assignment.status !== "active" ||
    assignment.platform_status !== "active" ||
    expired
  ) {
    throw new Error("Credenziali non disponibili per questo accesso");
  }
  const email = decryptSecret(assignment.shared_login_email_encrypted);
  const password = decryptSecret(assignment.shared_login_password_encrypted);
  await db.run(
    "UPDATE subscription_assignments SET credentials_view_count = COALESCE(credentials_view_count, 0) + 1, last_credentials_viewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [assignment.id]
  );
  await db.insert("subscription_access_logs", {
    user_id: userId,
    platform_id: assignment.platform_id,
    assignment_id: assignment.id,
    action: "credentials_viewed",
    ip_address: requiredText(ipAddress),
    user_agent: requiredText(userAgent)
  });
  return {
    email,
    password,
    loginUrl: requiredText(assignment.login_url || assignment.platform_url || "https://www.canva.com/login")
  };
}

async function revealCredentialsForAdmin({ adminId, platformId }) {
  if (!hasSubscriptionsKey()) {
    throw new Error("Chiave di cifratura mancante");
  }
  const platform = await getPlatformById(platformId);
  if (!platform) {
    throw new Error("Piattaforma non trovata");
  }
  const email = decryptSecret(platform.shared_login_email_encrypted);
  const password = decryptSecret(platform.shared_login_password_encrypted);
  await createAdminLog({
    adminId,
    platformId,
    action: "admin_credentials_viewed",
    details: "Visualizzazione credenziali piattaforma"
  });
  return {
    email,
    password
  };
}

async function updateAssignmentStatus({ adminId, assignmentId, status, userVisibleNote = "", adminPrivateNote = "" }) {
  const assignment = await db.get("SELECT * FROM subscription_assignments WHERE id = ?", [assignmentId]);
  if (!assignment) {
    throw new Error("Accesso non trovato");
  }
  await db.run(
    "UPDATE subscription_assignments SET status = ?, user_visible_note = ?, admin_private_note_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      status,
      requiredText(userVisibleNote),
      requiredText(adminPrivateNote) ? encryptSecret(adminPrivateNote) : assignment.admin_private_note_encrypted,
      assignmentId
    ]
  );
  if (assignment.request_id) {
    await db.run(
      "UPDATE subscription_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status === "revoked" ? "rejected" : status, assignment.request_id]
    );
  }
  await ensurePlatformCount(assignment.platform_id);
  await createAdminLog({
    adminId,
    userId: assignment.user_id,
    platformId: assignment.platform_id,
    requestId: assignment.request_id,
    assignmentId,
    action: `assignment_${status}`,
    details: requiredText(adminPrivateNote)
  });
}

async function listRequestRows(filter = "all") {
  const params = [];
  let where = "";
  if (filter !== "all") {
    if (filter === "payment_check") {
      where = "WHERE subscription_requests.payment_status = 'waiting'";
    } else {
      where = "WHERE subscription_requests.status = ?";
      params.push(filter);
    }
  }
  const rows = await db.all(
    `SELECT
      subscription_requests.*,
      subscription_platforms.name AS platform_name,
      subscription_platforms.slug AS platform_slug,
      users.name AS user_name
    FROM subscription_requests
    LEFT JOIN subscription_platforms ON subscription_platforms.id = subscription_requests.platform_id
    LEFT JOIN users ON users.id = subscription_requests.user_id
    ${where}
    ORDER BY subscription_requests.created_at DESC, subscription_requests.id DESC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    status_label: requestSummaryLabel(row.status),
    payment_status_label: paymentSummaryLabel(row.payment_status)
  }));
}

async function listAssignments() {
  await expireAssignments();
  const rows = await db.all(
    `SELECT
      subscription_assignments.*,
      users.name AS user_name,
      users.email AS user_email,
      subscription_platforms.name AS platform_name,
      subscription_platforms.slug AS platform_slug
    FROM subscription_assignments
    LEFT JOIN users ON users.id = subscription_assignments.user_id
    LEFT JOIN subscription_platforms ON subscription_platforms.id = subscription_assignments.platform_id
    ORDER BY subscription_assignments.created_at DESC, subscription_assignments.id DESC`
  );
  return rows.map((row) => ({
    ...row,
    status_label: assignmentSummaryLabel(row.status),
    starts_at_label: formatDate(row.starts_at),
    expires_at_label: formatDate(row.expires_at)
  }));
}

async function listIssues() {
  const rows = await db.all(
    `SELECT
      subscription_issues.*,
      users.name AS user_name,
      users.email AS user_email,
      subscription_platforms.name AS platform_name,
      subscription_platforms.slug AS platform_slug
    FROM subscription_issues
    LEFT JOIN users ON users.id = subscription_issues.user_id
    LEFT JOIN subscription_platforms ON subscription_platforms.id = subscription_issues.platform_id
    ORDER BY CASE subscription_issues.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, subscription_issues.created_at DESC`
  );
  return rows.map((row) => ({
    ...row,
    status_label: statusBadge("issue", row.status)
  }));
}

async function listAccessLogs() {
  const userLogs = await db.all(
    `SELECT
      subscription_access_logs.created_at,
      users.name AS actor_name,
      'utente' AS actor_type,
      subscription_platforms.name AS platform_name,
      subscription_access_logs.action,
      subscription_access_logs.ip_address,
      subscription_access_logs.user_agent
    FROM subscription_access_logs
    LEFT JOIN users ON users.id = subscription_access_logs.user_id
    LEFT JOIN subscription_platforms ON subscription_platforms.id = subscription_access_logs.platform_id
    ORDER BY subscription_access_logs.created_at DESC
    LIMIT 60`
  );
  const adminLogs = await db.all(
    `SELECT
      subscription_admin_logs.created_at,
      admins.username AS actor_name,
      'admin' AS actor_type,
      subscription_platforms.name AS platform_name,
      subscription_admin_logs.action,
      '' AS ip_address,
      subscription_admin_logs.details AS user_agent
    FROM subscription_admin_logs
    LEFT JOIN admins ON admins.id = subscription_admin_logs.admin_id
    LEFT JOIN subscription_platforms ON subscription_platforms.id = subscription_admin_logs.platform_id
    ORDER BY subscription_admin_logs.created_at DESC
    LIMIT 60`
  );
  return [...userLogs, ...adminLogs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 80)
    .map((row) => ({
      ...row,
      created_at_label: formatDateTime(row.created_at),
      action_label: row.action
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
      user_agent_short: requiredText(row.user_agent).slice(0, 120)
    }));
}

async function buildAdminDashboard() {
  await expireAssignments();
  const cutoff = toSqlDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [
    activePlatforms,
    pendingRequests,
    paymentChecks,
    activeAssignments,
    suspendedAssignments,
    openIssues,
    lastDayViews,
    latestRequests,
    canva
  ] = await Promise.all([
    db.get("SELECT COUNT(*) AS total FROM subscription_platforms WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM subscription_requests WHERE status = 'pending'"),
    db.get("SELECT COUNT(*) AS total FROM subscription_requests WHERE payment_status = 'waiting'"),
    db.get("SELECT COUNT(*) AS total FROM subscription_assignments WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM subscription_assignments WHERE status = 'suspended'"),
    db.get("SELECT COUNT(*) AS total FROM subscription_issues WHERE status = 'open'"),
    db.get("SELECT COUNT(*) AS total FROM subscription_access_logs WHERE action = 'credentials_viewed' AND created_at >= ?", [cutoff]),
    listRequestRows("all"),
    getPlatformBySlug("canva")
  ]);

  const platform = enrichPlatform(canva);
  return {
    stats: {
      activePlatforms: Number((activePlatforms && activePlatforms.total) || 0),
      pendingRequests: Number((pendingRequests && pendingRequests.total) || 0),
      paymentChecks: Number((paymentChecks && paymentChecks.total) || 0),
      activeAssignments: Number((activeAssignments && activeAssignments.total) || 0),
      suspendedAssignments: Number((suspendedAssignments && suspendedAssignments.total) || 0),
      openIssues: Number((openIssues && openIssues.total) || 0),
      credentialsViews24h: Number((lastDayViews && lastDayViews.total) || 0),
      canvaSpotsLeft: platform ? platform.spots_left : 0
    },
    latestRequests: latestRequests.slice(0, 8),
    platform
  };
}

module.exports = {
  REQUEST_STATUSES,
  PAYMENT_STATUSES,
  ASSIGNMENT_STATUSES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  subscriptionsEnabled,
  hasSubscriptionsKey,
  encryptSecret,
  decryptSecret,
  maskEmail,
  maskSecret,
  coerceBool,
  statusBadge,
  formatDate,
  formatDateTime,
  toSqlDateTime,
  sanitizePlatformPayload,
  ensurePlatformCount,
  expireAssignments,
  getPlatformBySlug,
  getPlatformById,
  listPlatforms,
  enrichPlatform,
  buildUserAccessState,
  createRequest,
  createAdminLog,
  getRequestDetail,
  activateAssignment,
  getAssignmentForUser,
  revealCredentialsForUser,
  revealCredentialsForAdmin,
  updateAssignmentStatus,
  listRequestRows,
  listAssignments,
  listIssues,
  listAccessLogs,
  buildAdminDashboard
};
