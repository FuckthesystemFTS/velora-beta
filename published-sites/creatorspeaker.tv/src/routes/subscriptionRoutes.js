const express = require("express");

const db = require("../db");
const { requireUser } = require("../middleware/auth");
const { requireAdmin, requirePermission } = require("../middleware/adminOnly");
const { requiredText } = require("../utils/validators");
const { getSiteSettings, renderPublicPage, renderUserPage, renderAdminPage } = require("../utils/viewHelpers");
const subscriptionService = require("../services/subscriptionService");

const router = express.Router();

function clientIp(req) {
  return (
    requiredText(req.headers["x-forwarded-for"]).split(",")[0].trim() ||
    requiredText(req.ip)
  );
}

async function publicShell() {
  return getSiteSettings();
}

async function userShell() {
  return getSiteSettings();
}

async function adminShell() {
  return getSiteSettings();
}

function ensureModuleEnabled(req, res, next) {
  if (!subscriptionService.subscriptionsEnabled()) {
    return res.status(404).render("layout-public", {
      title: "Modulo non disponibile",
      bodyTemplate: "404",
      page: {},
      data: {
        message: "Modulo abbonamenti non disponibile"
      }
    });
  }
  next();
}

function adminEncryptionState() {
  return {
    enabled: subscriptionService.subscriptionsEnabled(),
    hasKey: subscriptionService.hasSubscriptionsKey(),
    message: subscriptionService.hasSubscriptionsKey()
      ? ""
      : "Chiave di cifratura mancante. Impostare SUBSCRIPTIONS_SECRET_KEY nelle variabili ambiente"
  };
}

router.use(ensureModuleEnabled);
router.use("/admin/abbonamenti", requirePermission("subscriptions"));

router.get("/abbonamenti", async (req, res) => {
  const platforms = await subscriptionService.listPlatforms(false);
  return renderPublicPage(res, "Abbonamenti digitali disponibili", "subscriptions-list", await publicShell(), {
    title: "Abbonamenti digitali disponibili",
    intro:
      "Da questa sezione puoi richiedere l accesso agli abbonamenti digitali messi a disposizione da CreatorSpeaker. Ogni accesso viene attivato manualmente dopo verifica e approvazione",
    platforms
  });
});

router.get("/abbonamenti/:slug", async (req, res) => {
  const platform = subscriptionService.enrichPlatform(await subscriptionService.getPlatformBySlug(req.params.slug));
  if (!platform || platform.status !== "active") {
    return res.status(404).render("layout-public", {
      title: "Abbonamento non trovato",
      bodyTemplate: "404",
      page: {},
      data: { message: "Abbonamento non disponibile" }
    });
  }
  return renderPublicPage(
    res,
    platform.name,
    "subscription-public-detail",
    await publicShell(),
    {
      platform
    }
  );
});

router.get("/abbonamenti/:slug/richiedi", requireUser, async (req, res) => {
  const platform = subscriptionService.enrichPlatform(await subscriptionService.getPlatformBySlug(req.params.slug));
  if (!platform || platform.status !== "active") {
    req.session.flash = { type: "error", message: "Piattaforma non disponibile." };
    return res.redirect("/abbonamenti");
  }
  const user = await db.get("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
  return renderPublicPage(
    res,
    `Richiedi accesso ${platform.name}`,
    "subscription-request-form",
    await publicShell(),
    {
      platform,
      user
    }
  );
});

router.post("/abbonamenti/:slug/richiedi", requireUser, async (req, res) => {
  const platform = await subscriptionService.getPlatformBySlug(req.params.slug);
  const acceptedTerms = Boolean(req.body.accept_terms);
  const personalUse = Boolean(req.body.confirm_personal_use);
  const noShare = Boolean(req.body.confirm_no_share);
  if (!platform || platform.status !== "active") {
    req.session.flash = { type: "error", message: "Piattaforma non disponibile." };
    return res.redirect("/abbonamenti");
  }
  if (!acceptedTerms || !personalUse || !noShare) {
    req.session.flash = { type: "error", message: "Conferma termini, uso personale e divieto di condivisione." };
    return res.redirect(`/abbonamenti/${platform.slug}/richiedi`);
  }
  try {
    await subscriptionService.createRequest({
      userId: req.session.userId,
      platformId: platform.id,
      fullName: requiredText(req.body.full_name),
      email: requiredText(req.body.email),
      phone: requiredText(req.body.phone),
      message: requiredText(req.body.message)
    });
    req.session.flash = {
      type: "success",
      message:
        "Richiesta inviata correttamente. La tua richiesta e stata registrata e verra attivata dopo verifica manuale da parte dell admin"
    };
    return res.redirect("/dashboard/accessi");
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
    return res.redirect(`/abbonamenti/${platform.slug}/richiedi`);
  }
});

router.get("/dashboard/accessi", requireUser, async (req, res) => {
  const accesses = (await subscriptionService.buildUserAccessState(req.session.userId)).filter(
    (item) => item.request_id || item.assignment_id
  );
  return renderUserPage(res, "I miei accessi", "user-access-dashboard", await userShell(), {
    accesses
  });
});

router.get("/dashboard/accessi/:slug", requireUser, async (req, res) => {
  const access = (await subscriptionService.buildUserAccessState(req.session.userId, req.params.slug))[0];
  if (!access || (!access.request_id && !access.assignment_id)) {
    req.session.flash = { type: "error", message: "Nessun accesso trovato per questa piattaforma." };
    return res.redirect("/dashboard/accessi");
  }
  res.set("Cache-Control", "no-store");
  return renderUserPage(res, access.name, "user-access-detail", await userShell(), {
    access
  });
});

router.get("/dashboard/accessi/:slug/mostra-credenziali", requireUser, async (req, res) => {
  return res.redirect(`/dashboard/accessi/${req.params.slug}`);
});

router.post("/dashboard/accessi/:slug/mostra-credenziali", requireUser, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const payload = await subscriptionService.revealCredentialsForUser({
      userId: req.session.userId,
      slug: req.params.slug,
      ipAddress: clientIp(req),
      userAgent: requiredText(req.headers["user-agent"])
    });
    return res.json({
      ok: true,
      email: payload.email,
      password: payload.password,
      loginUrl: payload.loginUrl
    });
  } catch (error) {
    return res.status(403).json({
      ok: false,
      message: error.message
    });
  }
});

router.get("/dashboard/accessi/:slug/problema", requireUser, async (req, res) => {
  const access = (await subscriptionService.buildUserAccessState(req.session.userId, req.params.slug))[0];
  if (!access || (!access.request_id && !access.assignment_id)) {
    req.session.flash = { type: "error", message: "Accesso non trovato." };
    return res.redirect("/dashboard/accessi");
  }
  return renderUserPage(res, `Segnala problema ${access.name}`, "user-access-issue", await userShell(), {
    access,
    issueTypes: subscriptionService.ISSUE_TYPES
  });
});

router.post("/dashboard/accessi/:slug/problema", requireUser, async (req, res) => {
  const access = (await subscriptionService.buildUserAccessState(req.session.userId, req.params.slug))[0];
  if (!access || !access.platform_id) {
    req.session.flash = { type: "error", message: "Accesso non trovato." };
    return res.redirect("/dashboard/accessi");
  }
  const issueType = requiredText(req.body.issue_type);
  const message = requiredText(req.body.message);
  if (!subscriptionService.ISSUE_TYPES.includes(issueType) || !message) {
    req.session.flash = { type: "error", message: "Compila tipo problema e messaggio." };
    return res.redirect(`/dashboard/accessi/${req.params.slug}/problema`);
  }
  await db.insert("subscription_issues", {
    user_id: req.session.userId,
    platform_id: access.id,
    assignment_id: access.assignment_id || null,
    issue_type: issueType,
    message,
    status: "open",
    admin_reply: ""
  });
  await db.insert("notifications_log", {
    type: "subscription_issue_created",
    target: "admin",
    subject: `Segnalazione accesso ${access.name}`,
    body: `Nuova segnalazione per ${access.name}: ${issueType}`,
    status: "new"
  });
  req.session.flash = { type: "success", message: "Segnalazione inviata. L admin la vedra nel pannello." };
  return res.redirect(`/dashboard/accessi/${req.params.slug}`);
});

router.get("/admin/abbonamenti", requireAdmin, async (req, res) => {
  return renderAdminPage(
    res,
    "Admin abbonamenti",
    "admin-subscriptions-dashboard",
    await adminShell(),
    {
      dashboard: await subscriptionService.buildAdminDashboard(),
      encryption: adminEncryptionState()
    }
  );
});

router.get("/admin/abbonamenti/piattaforme", requireAdmin, async (req, res) => {
  return renderAdminPage(
    res,
    "Piattaforme abbonamento",
    "admin-subscriptions-platforms",
    await adminShell(),
    {
      platforms: await subscriptionService.listPlatforms(true),
      encryption: adminEncryptionState()
    }
  );
});

router.get("/admin/abbonamenti/piattaforme/nuova", requireAdmin, async (req, res) => {
  return renderAdminPage(
    res,
    "Nuova piattaforma",
    "admin-subscription-platform-form",
    await adminShell(),
    {
      platform: null,
      encryption: adminEncryptionState()
    }
  );
});

router.post("/admin/abbonamenti/piattaforme", requireAdmin, async (req, res) => {
  if (!subscriptionService.hasSubscriptionsKey()) {
    req.session.flash = { type: "error", message: adminEncryptionState().message };
    return res.redirect("/admin/abbonamenti/piattaforme");
  }
  try {
    const payload = subscriptionService.sanitizePlatformPayload(req.body);
    await db.insert("subscription_platforms", payload);
    req.session.flash = { type: "success", message: "Piattaforma creata." };
    return res.redirect("/admin/abbonamenti/piattaforme");
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
    return res.redirect("/admin/abbonamenti/piattaforme/nuova");
  }
});

router.get("/admin/abbonamenti/piattaforme/:id", requireAdmin, async (req, res) => {
  const platform = subscriptionService.enrichPlatform(await subscriptionService.getPlatformById(req.params.id));
  if (!platform) {
    req.session.flash = { type: "error", message: "Piattaforma non trovata." };
    return res.redirect("/admin/abbonamenti/piattaforme");
  }
  return renderAdminPage(
    res,
    `Piattaforma ${platform.name}`,
    "admin-subscription-platform-detail",
    await adminShell(),
    {
      platform,
      reveal: null,
      encryption: adminEncryptionState()
    }
  );
});

router.post("/admin/abbonamenti/piattaforme/:id", requireAdmin, async (req, res) => {
  const existing = await subscriptionService.getPlatformById(req.params.id);
  if (!existing) {
    req.session.flash = { type: "error", message: "Piattaforma non trovata." };
    return res.redirect("/admin/abbonamenti/piattaforme");
  }
  if (!subscriptionService.hasSubscriptionsKey()) {
    req.session.flash = { type: "error", message: adminEncryptionState().message };
    return res.redirect(`/admin/abbonamenti/piattaforme/${req.params.id}`);
  }
  const payload = subscriptionService.sanitizePlatformPayload(req.body);
  await db.run(
    `UPDATE subscription_platforms
      SET name = ?, slug = ?, description = ?, public_description = ?, status = ?, max_users = ?, price_per_user = ?, currency = ?, duration_days = ?, platform_url = ?, login_url = ?, shared_login_email_encrypted = ?, shared_login_password_encrypted = ?, admin_private_notes_encrypted = ?, user_visible_instructions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      payload.name,
      payload.slug,
      payload.description,
      payload.public_description,
      payload.status,
      payload.max_users,
      payload.price_per_user,
      payload.currency,
      payload.duration_days,
      payload.platform_url,
      payload.login_url,
      payload.shared_login_email_encrypted || existing.shared_login_email_encrypted,
      payload.shared_login_password_encrypted || existing.shared_login_password_encrypted,
      payload.admin_private_notes_encrypted || existing.admin_private_notes_encrypted,
      payload.user_visible_instructions,
      req.params.id
    ]
  );
  req.session.flash = { type: "success", message: "Piattaforma aggiornata." };
  return res.redirect(`/admin/abbonamenti/piattaforme/${req.params.id}`);
});

router.post("/admin/abbonamenti/piattaforme/:id/mostra-credenziali", requireAdmin, async (req, res) => {
  const platform = subscriptionService.enrichPlatform(await subscriptionService.getPlatformById(req.params.id));
  if (!platform) {
    req.session.flash = { type: "error", message: "Piattaforma non trovata." };
    return res.redirect("/admin/abbonamenti/piattaforme");
  }
  try {
    const reveal = await subscriptionService.revealCredentialsForAdmin({
      adminId: req.session.adminId,
      platformId: req.params.id
    });
    return renderAdminPage(
      res,
      `Piattaforma ${platform.name}`,
      "admin-subscription-platform-detail",
      await adminShell(),
      {
        platform,
        reveal,
        encryption: adminEncryptionState()
      }
    );
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
    return res.redirect(`/admin/abbonamenti/piattaforme/${req.params.id}`);
  }
});

router.get("/admin/abbonamenti/richieste", requireAdmin, async (req, res) => {
  const filter = requiredText(req.query.filter || "all");
  return renderAdminPage(
    res,
    "Richieste abbonamenti",
    "admin-subscriptions-requests",
    await adminShell(),
    {
      requests: await subscriptionService.listRequestRows(filter),
      filter,
      encryption: adminEncryptionState()
    }
  );
});

router.get("/admin/abbonamenti/richieste/:id", requireAdmin, async (req, res) => {
  const request = await subscriptionService.getRequestDetail(req.params.id);
  if (!request) {
    req.session.flash = { type: "error", message: "Richiesta non trovata." };
    return res.redirect("/admin/abbonamenti/richieste");
  }
  return renderAdminPage(
    res,
    `Richiesta ${request.platform_name || "abbonamento"}`,
    "admin-subscription-request-detail",
    await adminShell(),
    {
      request,
      encryption: adminEncryptionState()
    }
  );
});

router.post("/admin/abbonamenti/richieste/:id/payment-received", requireAdmin, async (req, res) => {
  const request = await subscriptionService.getRequestDetail(req.params.id);
  if (!request) {
    req.session.flash = { type: "error", message: "Richiesta non trovata." };
    return res.redirect("/admin/abbonamenti/richieste");
  }
  await db.run(
    "UPDATE subscription_requests SET payment_status = 'received', payment_received_at = CURRENT_TIMESTAMP, payment_note = ?, status = 'payment_received', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [requiredText(req.body.payment_note), request.id]
  );
  await subscriptionService.createAdminLog({
    adminId: req.session.adminId,
    userId: request.user_id,
    platformId: request.platform_id,
    requestId: request.id,
    action: "payment_received",
    details: requiredText(req.body.payment_note)
  });
  req.session.flash = { type: "success", message: "Pagamento segnato come ricevuto." };
  return res.redirect(`/admin/abbonamenti/richieste/${request.id}`);
});

router.post("/admin/abbonamenti/richieste/:id/authorize", requireAdmin, async (req, res) => {
  const request = await subscriptionService.getRequestDetail(req.params.id);
  if (!request) {
    req.session.flash = { type: "error", message: "Richiesta non trovata." };
    return res.redirect("/admin/abbonamenti/richieste");
  }
  await db.run(
    "UPDATE subscription_requests SET payment_status = 'not_required', payment_note = ?, status = 'payment_received', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [requiredText(req.body.payment_note), request.id]
  );
  await subscriptionService.createAdminLog({
    adminId: req.session.adminId,
    userId: request.user_id,
    platformId: request.platform_id,
    requestId: request.id,
    action: "authorized_without_payment",
    details: requiredText(req.body.payment_note)
  });
  req.session.flash = { type: "success", message: "Richiesta autorizzata senza pagamento." };
  return res.redirect(`/admin/abbonamenti/richieste/${request.id}`);
});

router.post("/admin/abbonamenti/richieste/:id/activate", requireAdmin, async (req, res) => {
  try {
    const request = await subscriptionService.getRequestDetail(req.params.id);
    const startsAt = requiredText(req.body.starts_at) || new Date().toISOString();
    const expiresAt =
      requiredText(req.body.expires_at) ||
      new Date(Date.now() + Number(request.duration_days || 30) * 86400000).toISOString();
    await subscriptionService.activateAssignment({
      adminId: req.session.adminId,
      requestId: req.params.id,
      startsAt,
      expiresAt,
      userVisibleNote: requiredText(req.body.user_visible_note),
      adminPrivateNote: requiredText(req.body.admin_private_note)
    });
    req.session.flash = { type: "success", message: "Accesso attivato." };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect(`/admin/abbonamenti/richieste/${req.params.id}`);
});

router.post("/admin/abbonamenti/richieste/:id/reject", requireAdmin, async (req, res) => {
  const request = await subscriptionService.getRequestDetail(req.params.id);
  if (!request) {
    req.session.flash = { type: "error", message: "Richiesta non trovata." };
    return res.redirect("/admin/abbonamenti/richieste");
  }
  const note = requiredText(req.body.admin_note);
  await db.run(
    "UPDATE subscription_requests SET status = 'rejected', admin_note = ?, payment_status = CASE WHEN payment_status = 'waiting' THEN 'rejected' ELSE payment_status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [note, request.id]
  );
  await subscriptionService.createAdminLog({
    adminId: req.session.adminId,
    userId: request.user_id,
    platformId: request.platform_id,
    requestId: request.id,
    action: "request_rejected",
    details: note
  });
  req.session.flash = { type: "success", message: "Richiesta rifiutata." };
  return res.redirect(`/admin/abbonamenti/richieste/${request.id}`);
});

router.post("/admin/abbonamenti/richieste/:id/note", requireAdmin, async (req, res) => {
  const request = await subscriptionService.getRequestDetail(req.params.id);
  if (!request) {
    req.session.flash = { type: "error", message: "Richiesta non trovata." };
    return res.redirect("/admin/abbonamenti/richieste");
  }
  const note = requiredText(req.body.admin_note);
  await db.run(
    "UPDATE subscription_requests SET admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [note, request.id]
  );
  await subscriptionService.createAdminLog({
    adminId: req.session.adminId,
    userId: request.user_id,
    platformId: request.platform_id,
    requestId: request.id,
    action: "admin_note_added",
    details: note
  });
  req.session.flash = { type: "success", message: "Nota salvata." };
  return res.redirect(`/admin/abbonamenti/richieste/${request.id}`);
});

router.get("/admin/abbonamenti/accessi", requireAdmin, async (req, res) => {
  return renderAdminPage(
    res,
    "Accessi attivi",
    "admin-subscriptions-accesses",
    await adminShell(),
    {
      accesses: await subscriptionService.listAssignments(),
      encryption: adminEncryptionState()
    }
  );
});

router.post("/admin/abbonamenti/accessi/:id/status", requireAdmin, async (req, res) => {
  try {
    await subscriptionService.updateAssignmentStatus({
      adminId: req.session.adminId,
      assignmentId: req.params.id,
      status: requiredText(req.body.status),
      userVisibleNote: requiredText(req.body.user_visible_note),
      adminPrivateNote: requiredText(req.body.admin_private_note)
    });
    req.session.flash = { type: "success", message: "Stato accesso aggiornato." };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect("/admin/abbonamenti/accessi");
});

router.get("/admin/abbonamenti/log", requireAdmin, async (req, res) => {
  return renderAdminPage(
    res,
    "Log abbonamenti",
    "admin-subscriptions-logs",
    await adminShell(),
    {
      logs: await subscriptionService.listAccessLogs(),
      encryption: adminEncryptionState()
    }
  );
});

router.get("/admin/abbonamenti/segnalazioni", requireAdmin, async (req, res) => {
  return renderAdminPage(
    res,
    "Segnalazioni accessi",
    "admin-subscriptions-issues",
    await adminShell(),
    {
      issues: await subscriptionService.listIssues(),
      encryption: adminEncryptionState()
    }
  );
});

router.post("/admin/abbonamenti/segnalazioni/:id", requireAdmin, async (req, res) => {
  await db.run(
    "UPDATE subscription_issues SET status = ?, admin_reply = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      requiredText(req.body.status || "in_progress"),
      requiredText(req.body.admin_reply),
      req.params.id
    ]
  );
  req.session.flash = { type: "success", message: "Segnalazione aggiornata." };
  return res.redirect("/admin/abbonamenti/segnalazioni");
});

module.exports = router;
