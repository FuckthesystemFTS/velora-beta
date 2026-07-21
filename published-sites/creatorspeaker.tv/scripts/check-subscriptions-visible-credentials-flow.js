require("dotenv").config();

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.SUBSCRIPTIONS_ENABLED = "true";
process.env.SUBSCRIPTIONS_SECRET_KEY =
  process.env.SUBSCRIPTIONS_SECRET_KEY || "local-check-subscriptions-key-2026";

const bcrypt = require("bcrypt");

const db = require("../src/db");
const { createApp } = require("../src");
const subscriptionService = require("../src/services/subscriptionService");

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  storeCookies(response) {
    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    setCookie.forEach((item) => {
      const [pair] = String(item).split(";");
      const [key, value] = pair.split("=");
      this.cookies.set(key, value);
    });
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      redirect: options.redirect || "manual",
      headers: {
        ...(options.headers || {}),
        cookie: this.cookieHeader()
      },
      method: options.method || "GET",
      body: options.body
    });
    this.storeCookies(response);
    return response;
  }

  async getText(path) {
    const response = await this.request(path);
    return {
      response,
      text: await response.text()
    };
  }

  extractCsrf(html) {
    const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!match) {
      throw new Error("CSRF token non trovato");
    }
    return match[1];
  }

  async csrfFrom(path) {
    const { text } = await this.getText(path);
    return this.extractCsrf(text);
  }

  async postForm(path, fields, refererPath = path) {
    const csrf = await this.csrfFrom(refererPath);
    const body = new URLSearchParams({ ...fields, _csrf: csrf });
    return this.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureUser(email, name, password) {
  const existing = await db.get("SELECT id FROM users WHERE email = ?", [email]);
  const passwordHash = await bcrypt.hash(password, 10);
  if (existing) {
    await db.run(
      "UPDATE users SET name = ?, password_hash = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [name, passwordHash, existing.id]
    );
    return existing.id;
  }
  return db.insert("users", {
    name,
    email,
    password_hash: passwordHash,
    status: "active",
    credits: 0
  });
}

async function purgeUserData(userId) {
  await db.run("DELETE FROM subscription_access_logs WHERE user_id = ?", [userId]);
  await db.run("DELETE FROM subscription_issues WHERE user_id = ?", [userId]);
  await db.run("DELETE FROM subscription_assignments WHERE user_id = ?", [userId]);
  await db.run("DELETE FROM subscription_requests WHERE user_id = ?", [userId]);
}

async function prepareFixtures() {
  await db.initialize();
  await subscriptionService.expireAssignments();

  const canva = await subscriptionService.getPlatformBySlug("canva");
  assert(canva, "Piattaforma Canva mancante");
  await db.run(
    "UPDATE subscription_platforms SET shared_login_email_encrypted = ?, shared_login_password_encrypted = ?, user_visible_instructions = ?, max_users = 25, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      subscriptionService.encryptSecret("canva.shared@example.com"),
      subscriptionService.encryptSecret("CanvaSecret!2026"),
      "Usa queste credenziali solo per il tuo accesso personale",
      canva.id
    ]
  );

  const password = "SubscriptionUser!2026";
  const users = {
    unauthorized: await ensureUser("subscription-unauthorized@test.local", "Unauthorized User", password),
    pending: await ensureUser("subscription-pending@test.local", "Pending User", password),
    suspended: await ensureUser("subscription-suspended@test.local", "Suspended User", password),
    expired: await ensureUser("subscription-expired@test.local", "Expired User", password),
    active: await ensureUser("subscription-active@test.local", "Active User", password),
    flowA: await ensureUser("subscription-flow-a@test.local", "Flow A User", password),
    flowB: await ensureUser("subscription-flow-b@test.local", "Flow B User", password)
  };

  for (const userId of Object.values(users)) {
    await purgeUserData(userId);
  }

  const pendingRequestId = await db.insert("subscription_requests", {
    user_id: users.pending,
    platform_id: canva.id,
    full_name: "Pending User",
    email: "subscription-pending@test.local",
    phone: "",
    message: "Richiesta pending",
    status: "pending",
    payment_status: "waiting",
    payment_reference: "",
    payment_note: "",
    payment_received_at: null,
    admin_note: ""
  });

  const suspendedRequestId = await db.insert("subscription_requests", {
    user_id: users.suspended,
    platform_id: canva.id,
    full_name: "Suspended User",
    email: "subscription-suspended@test.local",
    phone: "",
    message: "Richiesta sospesa",
    status: "suspended",
    payment_status: "received",
    payment_reference: "",
    payment_note: "",
    payment_received_at: null,
    admin_note: ""
  });
  await db.insert("subscription_assignments", {
    user_id: users.suspended,
    platform_id: canva.id,
    request_id: suspendedRequestId,
    status: "suspended",
    starts_at: subscriptionService.toSqlDateTime(new Date(Date.now() - 3 * 86400000)),
    expires_at: subscriptionService.toSqlDateTime(new Date(Date.now() + 3 * 86400000)),
    user_visible_note: "",
    admin_private_note_encrypted: "",
    activated_by_admin_id: 1,
    credentials_view_count: 0,
    last_credentials_viewed_at: null
  });

  const expiredRequestId = await db.insert("subscription_requests", {
    user_id: users.expired,
    platform_id: canva.id,
    full_name: "Expired User",
    email: "subscription-expired@test.local",
    phone: "",
    message: "Richiesta scaduta",
    status: "active",
    payment_status: "received",
    payment_reference: "",
    payment_note: "",
    payment_received_at: null,
    admin_note: ""
  });
  await db.insert("subscription_assignments", {
    user_id: users.expired,
    platform_id: canva.id,
    request_id: expiredRequestId,
    status: "active",
    starts_at: subscriptionService.toSqlDateTime(new Date(Date.now() - 10 * 86400000)),
    expires_at: subscriptionService.toSqlDateTime(new Date(Date.now() - 2 * 86400000)),
    user_visible_note: "",
    admin_private_note_encrypted: "",
    activated_by_admin_id: 1,
    credentials_view_count: 0,
    last_credentials_viewed_at: null
  });

  const activeRequestId = await db.insert("subscription_requests", {
    user_id: users.active,
    platform_id: canva.id,
    full_name: "Active User",
    email: "subscription-active@test.local",
    phone: "",
    message: "Richiesta attiva",
    status: "active",
    payment_status: "received",
    payment_reference: "",
    payment_note: "",
    payment_received_at: null,
    admin_note: ""
  });
  await db.insert("subscription_assignments", {
    user_id: users.active,
    platform_id: canva.id,
    request_id: activeRequestId,
    status: "active",
    starts_at: subscriptionService.toSqlDateTime(new Date(Date.now() - 2 * 86400000)),
    expires_at: subscriptionService.toSqlDateTime(new Date(Date.now() + 5 * 86400000)),
    user_visible_note: "",
    admin_private_note_encrypted: "",
    activated_by_admin_id: 1,
    credentials_view_count: 0,
    last_credentials_viewed_at: null
  });

  await subscriptionService.ensurePlatformCount(canva.id);
  return { password, users, canva };
}

async function main() {
  const fixture = await prepareFixtures();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const guest = new Client(baseUrl);
    let result = await guest.getText("/abbonamenti");
    assert(result.response.status === 200, "Route /abbonamenti assente");
    result = await guest.getText("/abbonamenti/canva");
    assert(result.response.status === 200, "Route /abbonamenti/canva assente");

    const guestAdmin = await guest.request("/admin/abbonamenti");
    assert(guestAdmin.status === 302, "Utente non admin puo accedere alle route admin");

    const unauthorized = new Client(baseUrl);
    await unauthorized.postForm("/login", {
      email: "subscription-unauthorized@test.local",
      password: fixture.password
    }, "/login");
    const unauthorizedDetail = await unauthorized.request("/dashboard/accessi/canva");
    assert(unauthorizedDetail.status === 302, "Utente non autorizzato non deve aprire i dettagli");
    const unauthorizedReveal = await unauthorized.postForm("/dashboard/accessi/canva/mostra-credenziali", {}, "/dashboard");
    assert(unauthorizedReveal.status === 403, "Utente non autorizzato vede credenziali");

    const pending = new Client(baseUrl);
    await pending.postForm("/login", {
      email: "subscription-pending@test.local",
      password: fixture.password
    }, "/login");
    const pendingDetail = await pending.getText("/dashboard/accessi/canva");
    assert(pendingDetail.response.status === 200, "Route /dashboard/accessi/canva assente");
    assert(!pendingDetail.text.includes("Mostra credenziali"), "Utente con richiesta pending vede credenziali");

    const suspended = new Client(baseUrl);
    await suspended.postForm("/login", {
      email: "subscription-suspended@test.local",
      password: fixture.password
    }, "/login");
    const suspendedDetail = await suspended.getText("/dashboard/accessi/canva");
    assert(!suspendedDetail.text.includes("Mostra credenziali"), "Utente sospeso vede credenziali");
    const suspendedReveal = await suspended.postForm("/dashboard/accessi/canva/mostra-credenziali", {}, "/dashboard/accessi/canva");
    assert(suspendedReveal.status === 403, "Utente sospeso vede credenziali");

    const expired = new Client(baseUrl);
    await expired.postForm("/login", {
      email: "subscription-expired@test.local",
      password: fixture.password
    }, "/login");
    const expiredDetail = await expired.getText("/dashboard/accessi/canva");
    assert(!expiredDetail.text.includes("Mostra credenziali"), "Utente scaduto vede credenziali");
    const expiredReveal = await expired.postForm("/dashboard/accessi/canva/mostra-credenziali", {}, "/dashboard/accessi/canva");
    assert(expiredReveal.status === 403, "Utente scaduto vede credenziali");

    const active = new Client(baseUrl);
    await active.postForm("/login", {
      email: "subscription-active@test.local",
      password: fixture.password
    }, "/login");
    const activeDashboard = await active.getText("/dashboard/accessi");
    assert(activeDashboard.response.status === 200, "Route /dashboard/accessi assente");
    const activeDetail = await active.getText("/dashboard/accessi/canva");
    assert(activeDetail.text.includes("Mostra credenziali"), "Utente autorizzato non vede il pulsante Mostra credenziali");
    assert(!activeDetail.text.includes("canva.shared@example.com"), "Credenziali presenti nell HTML iniziale");
    assert(!activeDetail.text.includes("CanvaSecret!2026"), "Password presente nell HTML iniziale");
    assert(!activeDetail.text.includes("localStorage"), "Le credenziali non devono essere salvate in localStorage");
    const revealResponse = await active.postForm("/dashboard/accessi/canva/mostra-credenziali", {}, "/dashboard/accessi/canva");
    const revealPayload = await revealResponse.json();
    assert(revealResponse.status === 200 && revealPayload.ok, "Endpoint mostra credenziali non funziona per assignment attivo");
    assert(revealPayload.email === "canva.shared@example.com", "Email Canva errata");
    assert(revealPayload.password === "CanvaSecret!2026", "Password Canva errata");
    const viewLog = await db.get(
      "SELECT COUNT(*) AS total FROM subscription_access_logs WHERE user_id = ? AND action = 'credentials_viewed'",
      [fixture.users.active]
    );
    assert(Number(viewLog.total || 0) >= 1, "Visualizzazione credenziali non crea log");

    const admin = new Client(baseUrl);
    await admin.postForm("/admin/login", {
      username: process.env.ADMIN_INITIAL_USERNAME || "admin",
      password: process.env.ADMIN_INITIAL_PASSWORD || "CreatorSpeakerTV!2026-ChangeMe"
    }, "/admin/login");
    const adminHome = await admin.getText("/admin/abbonamenti");
    assert(adminHome.response.status === 200, "Route /admin/abbonamenti assente");

    const newSlug = `figma-${Date.now()}`;
    const createPlatform = await admin.postForm(
      "/admin/abbonamenti/piattaforme",
      {
        name: "Figma",
        slug: newSlug,
        description: "Piattaforma test Figma",
        public_description: "Accesso Figma su approvazione",
        status: "active",
        max_users: "2",
        price_per_user: "900",
        currency: "EUR",
        duration_days: "30",
        platform_url: "https://www.figma.com",
        login_url: "https://www.figma.com/login",
        shared_login_email: "figma.shared@example.com",
        shared_login_password: "FigmaSecret!2026",
        admin_private_notes: "Uso interno",
        user_visible_instructions: "Accedi manualmente"
      },
      "/admin/abbonamenti/piattaforme/nuova"
    );
    assert(createPlatform.status === 302, "Admin non puo creare piattaforma");

    const flowAUser = new Client(baseUrl);
    await flowAUser.postForm("/login", {
      email: "subscription-flow-a@test.local",
      password: fixture.password
    }, "/login");
    await flowAUser.postForm("/abbonamenti/canva/richiedi", {
      full_name: "Flow A User",
      email: "subscription-flow-a@test.local",
      phone: "",
      message: "Richiesta flusso A",
      accept_terms: "on",
      confirm_personal_use: "on",
      confirm_no_share: "on"
    }, "/abbonamenti/canva/richiedi");

    const flowBUser = new Client(baseUrl);
    await flowBUser.postForm("/login", {
      email: "subscription-flow-b@test.local",
      password: fixture.password
    }, "/login");
    await flowBUser.postForm("/abbonamenti/canva/richiedi", {
      full_name: "Flow B User",
      email: "subscription-flow-b@test.local",
      phone: "",
      message: "Richiesta flusso B",
      accept_terms: "on",
      confirm_personal_use: "on",
      confirm_no_share: "on"
    }, "/abbonamenti/canva/richiedi");

    const requestsPage = await admin.getText("/admin/abbonamenti/richieste");
    assert(requestsPage.text.includes("Flow A User"), "Admin non puo vedere richiesta");

    const flowARequest = await db.get(
      "SELECT id FROM subscription_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [fixture.users.flowA]
    );
    assert(flowARequest, "Richiesta flow A mancante");
    const markPayment = await admin.postForm(
      `/admin/abbonamenti/richieste/${flowARequest.id}/payment-received`,
      { payment_note: "Bonifico verificato" },
      `/admin/abbonamenti/richieste/${flowARequest.id}`
    );
    assert(markPayment.status === 302, "Admin non puo segnare pagamento ricevuto");
    const activate = await admin.postForm(
      `/admin/abbonamenti/richieste/${flowARequest.id}/activate`,
      {
        starts_at: "2026-06-15T10:00",
        expires_at: "2026-07-15T10:00",
        user_visible_note: "Accesso attivato",
        admin_private_note: "Attivazione test"
      },
      `/admin/abbonamenti/richieste/${flowARequest.id}`
    );
    assert(activate.status === 302, "Admin non puo attivare accesso");
    const flowAAssignment = await db.get(
      "SELECT id FROM subscription_assignments WHERE request_id = ?",
      [flowARequest.id]
    );
    assert(flowAAssignment, "Admin non attiva accesso");

    const flowBRequest = await db.get(
      "SELECT id FROM subscription_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [fixture.users.flowB]
    );
    const authorizeNoPayment = await admin.postForm(
      `/admin/abbonamenti/richieste/${flowBRequest.id}/authorize`,
      { payment_note: "Accesso omaggio" },
      `/admin/abbonamenti/richieste/${flowBRequest.id}`
    );
    assert(authorizeNoPayment.status === 302, "Admin non puo autorizzare senza pagamento");

    const maxSlug = `max-one-${Date.now()}`;
    await admin.postForm(
      "/admin/abbonamenti/piattaforme",
      {
        name: "Max One",
        slug: maxSlug,
        description: "Piattaforma test capienza",
        public_description: "Test capienza",
        status: "active",
        max_users: "1",
        price_per_user: "0",
        currency: "EUR",
        duration_days: "30",
        platform_url: "https://example.com",
        login_url: "https://example.com/login",
        shared_login_email: "maxone@example.com",
        shared_login_password: "MaxOneSecret!2026",
        admin_private_notes: "",
        user_visible_instructions: "Test"
      },
      "/admin/abbonamenti/piattaforme/nuova"
    );
    const maxPlatform = await subscriptionService.getPlatformBySlug(maxSlug);
    const firstRequest = await db.insert("subscription_requests", {
      user_id: fixture.users.active,
      platform_id: maxPlatform.id,
      full_name: "Active User",
      email: "subscription-active@test.local",
      phone: "",
      message: "Prima richiesta",
      status: "payment_received",
      payment_status: "received",
      payment_reference: "",
      payment_note: "",
      payment_received_at: null,
      admin_note: ""
    });
    const secondRequest = await db.insert("subscription_requests", {
      user_id: fixture.users.pending,
      platform_id: maxPlatform.id,
      full_name: "Pending User",
      email: "subscription-pending@test.local",
      phone: "",
      message: "Seconda richiesta",
      status: "payment_received",
      payment_status: "received",
      payment_reference: "",
      payment_note: "",
      payment_received_at: null,
      admin_note: ""
    });
    await admin.postForm(
      `/admin/abbonamenti/richieste/${firstRequest}/activate`,
      {
        starts_at: "2026-06-15T10:00",
        expires_at: "2026-07-15T10:00",
        user_visible_note: "",
        admin_private_note: ""
      },
      `/admin/abbonamenti/richieste/${firstRequest}`
    );
    const secondAttempt = await admin.postForm(
      `/admin/abbonamenti/richieste/${secondRequest}/activate`,
      {
        starts_at: "2026-06-15T10:00",
        expires_at: "2026-07-15T10:00",
        user_visible_note: "",
        admin_private_note: ""
      },
      `/admin/abbonamenti/richieste/${secondRequest}`
    );
    assert(secondAttempt.status === 302, "Tentativo max_users non gestito");
    const noSecondAssignment = await db.get(
      "SELECT id FROM subscription_assignments WHERE request_id = ?",
      [secondRequest]
    );
    assert(!noSecondAssignment, "max_users non viene rispettato");

    console.log("check-subscriptions-visible-credentials-flow: OK");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
