const express = require("express");
const bcrypt = require("bcrypt");

const db = require("../db");
const {
  STAFF_PERMISSION_KEYS,
  DEFAULT_STAFF_PERMISSIONS,
  normalizePermissions,
  requireAdmin,
  requireSuperAdmin,
  requirePermission
} = require("../middleware/adminOnly");
const { normalizePackagePayload, requiredText, toBool, toInt } = require("../utils/validators");
const { parseJson, stringifyJson } = require("../utils/safeJson");
const { getSiteSettings, maskSecret, renderAdminPage } = require("../utils/viewHelpers");
const { activateOrder } = require("../services/orderService");
const telegramService = require("../services/telegramService");
const facebookService = require("../services/facebookService");
const amazonService = require("../services/amazonService");
const schedulerService = require("../services/schedulerService");
const mediaService = require("../services/mediaService");
const subscriptionService = require("../services/subscriptionService");
const analyticsService = require("../services/analyticsService");
const mailService = require("../services/mailService");
const videoService = require("../services/videoService");
const databaseExportService = require("../services/databaseExportService");
const { sendStoredFile } = require("../services/fileStorageService");

const router = express.Router();

function panelBasePath(req) {
  return req.panelBasePath || "/admin";
}

function panelPath(req, path) {
  const basePath = panelBasePath(req);
  if (basePath === "/admin") {
    return path;
  }
  if (path === "/admin") {
    return basePath;
  }
  if (path.startsWith("/admin/")) {
    return `${basePath}${path.slice("/admin".length)}`;
  }
  return path;
}

function panelHome(req, account = null) {
  const currentAccount = account || null;
  if (currentAccount && currentAccount.role === "staff") {
    return "/staff/dashboard";
  }
  return "/admin/dashboard";
}

function renderAccessPage(res, req, title, pageData = {}) {
  return renderAdminPage(res, title, "admin-login", {
    ...pageData,
    accessMode: req.panelType === "staff" ? "staff" : "admin"
  });
}

function sanitizeStaffPermissions(body) {
  const raw = STAFF_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = toBool(body[`permission_${key}`]);
    return acc;
  }, {});
  return normalizePermissions(raw);
}

const staffPermissionLabels = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  media: "Media Library",
  cms_sections: "Home e sezioni",
  cms_packages: "Pacchetti CMS",
  creators: "Creator Network",
  speakers: "Speaker Network",
  brands: "Aziende e Brand",
  smart_tv: "Smart TV",
  requests: "Richieste utenti",
  orders: "Ordini e attivazioni",
  users: "Utenti",
  database: "Database",
  content: "Contenuti",
  video_jobs: "Video jobs",
  credits: "Crediti",
  offers: "Offerte",
  "affiliate_deals.view": "Offerte Affiliate",
  "affiliate_deals.search": "Ricerca offerte Amazon",
  "affiliate_deals.approve": "Approva offerte affiliate",
  "affiliate_deals.publish": "Pubblica offerte affiliate",
  "affiliate_deals.categories_manage": "Categorie affiliate",
  "affiliate_deals.templates_manage": "Template post affiliate",
  "affiliate_deals.scheduler_manage": "Scheduler affiliate",
  "affiliate_deals.settings_manage": "Configurazione affiliate",
  "affiliate_deals.logs_view": "Log affiliate",
  "affiliate_deals.facebook_manage": "Facebook affiliate",
  "affiliate_deals.telegram_manage": "Telegram affiliate",
  "affiliate_deals.amazon_manage": "Amazon affiliate",
  subscriptions: "Abbonamenti",
  integrations: "Integrazioni",
  settings: "Impostazioni sito",
  logs: "Log attivita",
  "outreach.view": "Mail e contatti",
  "outreach.search": "Cerca contatti aziende",
  "outreach.contacts.manage": "Approva contatti",
  "outreach.lists.manage": "Liste contatti",
  "outreach.templates.manage": "Modelli email",
  "outreach.campaigns.create": "Crea campagne email",
  "outreach.campaigns.send": "Invia campagne email",
  "outreach.settings.manage": "Configura outreach",
  "outreach.logs.view": "Log outreach"
};

function makeCheck(label, ready, href, detail) {
  return {
    label,
    ready: Boolean(ready),
    href,
    detail: requiredText(detail) || (ready ? "Configurazione pronta" : "Configurazione da completare")
  };
}

function buildOperationalChecks({ legal, operations, bank, cloudinary, mail }) {
  const hasOfficialEmails =
    requiredText(operations.officialInfoEmail) &&
    requiredText(operations.officialServiceEmail) &&
    requiredText(operations.officialNetworkEmail);
  const hasLegalTexts =
    requiredText(legal && legal.privacy) &&
    requiredText(legal && legal.cookie) &&
    requiredText(legal && legal.terms);

  return [
    makeCheck(
      "Cloudinary",
      cloudinary.configured,
      "/admin/media",
      cloudinary.configured ? "Media library pronta per upload reali" : cloudinary.message
    ),
    makeCheck(
      "SMTP",
      mail.configured,
      "/admin/settings",
      mail.configured
        ? "Recupero password e email benvenuto pronti"
        : mail.message
    ),
    makeCheck(
      "Bonifico",
      bank.holder && bank.iban && !String(bank.iban).includes("INSERIRE-IBAN"),
      "/admin/settings",
      bank.holder && bank.iban && !String(bank.iban).includes("INSERIRE-IBAN")
        ? "Dati bonifico completi"
        : "Completa intestatario e IBAN reale"
    ),
    makeCheck(
      "PayPal",
      operations.enablePaypal === false || requiredText(operations.paypalMerchantEmail),
      "/admin/settings",
      operations.enablePaypal === false
        ? "Metodo disattivato dall admin"
        : requiredText(operations.paypalMerchantEmail)
          ? "Email merchant presente"
          : "Inserisci email merchant PayPal"
    ),
    makeCheck(
      "Stripe",
      operations.enableStripe === false || requiredText(operations.stripePublishableKey),
      "/admin/settings",
      operations.enableStripe === false
        ? "Metodo disattivato dall admin"
        : requiredText(operations.stripePublishableKey)
          ? "Chiave publishable presente"
          : "Inserisci almeno la chiave publishable"
    ),
    makeCheck(
      "Email ufficiali",
      hasOfficialEmails,
      "/admin/settings",
      hasOfficialEmails ? "Email ufficiali configurate" : "Compila info, service e network"
    ),
    makeCheck(
      "Accessi condivisi",
      subscriptionService.hasSubscriptionsKey(),
      "/admin/abbonamenti",
      subscriptionService.hasSubscriptionsKey()
        ? "Chiave cifratura presente"
        : "Manca SUBSCRIPTIONS_SECRET_KEY per gestire gli accessi protetti"
    ),
    makeCheck(
      "Testi legali",
      hasLegalTexts,
      "/admin/settings",
      hasLegalTexts ? "Privacy, cookie e termini presenti" : "Controlla privacy, cookie e termini"
    )
  ];
}

function buildActionQueue(stats) {
  return [
    {
      label: "Ordini da verificare",
      value: Number(stats.pendingOrders || 0),
      href: "/admin/orders",
      detail: "Attiva pagamenti, conferme e servizi"
    },
    {
      label: "Utenti da approvare",
      value: Number(stats.pendingUsers || 0),
      href: "/admin/users",
      detail: "Controlla nuovi registrati e stato account"
    },
    {
      label: "Contenuti in coda",
      value: Number(stats.pendingContent || 0),
      href: "/admin/content",
      detail: "Revisiona upload e richieste di pubblicazione"
    },
    {
      label: "Video job aperti",
      value: Number(stats.videoJobs || 0),
      href: "/admin/video-jobs",
      detail: "Verifica elaborazioni e possibili errori"
    },
    {
      label: "Richieste utenti",
      value: Number(stats.openRequests || 0),
      href: "/admin/requests",
      detail: "Rispondi ai contatti e alle richieste operative"
    }
  ].sort((a, b) => b.value - a.value);
}

function buildAdminWorkflows(req, stats) {
  return [
    {
      title: "Gestisci richieste e clienti",
      detail: "Ordini, utenti, richieste arrivate dal sito e attivazioni da completare",
      href: panelPath(req, "/admin/requests"),
      count: Number(stats.pendingOrders || 0) + Number(stats.pendingUsers || 0) + Number(stats.openRequests || 0),
      permission: "requests",
      actions: [
        { label: "Apri richieste", href: panelPath(req, "/admin/requests") },
        { label: "Elenco clienti", href: panelPath(req, "/admin/clients") },
        { label: "Ordini", href: panelPath(req, "/admin/orders") }
      ]
    },
    {
      title: "Pubblica contenuti",
      detail: "Upload ricevuti dagli utenti, media, pagine, creator, speaker e brand",
      href: panelPath(req, "/admin/content"),
      count: Number(stats.pendingContent || 0),
      permission: "content",
      actions: [
        { label: "Media Library", href: panelPath(req, "/admin/media") },
        { label: "Nuovo creator", href: panelPath(req, "/admin/creators") },
        { label: "Nuovo speaker", href: panelPath(req, "/admin/speakers") }
      ]
    },
    {
      title: "Aggiorna sito e offerte",
      detail: "Home, sezioni, pacchetti, offerte, Smart TV e servizi pubblici",
      href: panelPath(req, "/admin/site"),
      count: Number(stats.activeCmsPackages || 0),
      permission: "cms_sections",
      actions: [
        { label: "Modifica home", href: panelPath(req, "/admin/home") },
        { label: "Gestisci pacchetti", href: panelPath(req, "/admin/cms-packages") },
        { label: "Smart TV", href: panelPath(req, "/admin/smart-tv") }
      ]
    },
    {
      title: "Offerte affiliate Amazon",
      detail: "Categorie, offerte trovate, code Telegram e Facebook, template e scheduler",
      href: panelPath(req, "/admin/affiliate-deals"),
      count: 0,
      permission: "affiliate_deals.view",
      actions: [
        { label: "Panoramica", href: panelPath(req, "/admin/affiliate-deals") },
        { label: "Offerte trovate", href: panelPath(req, "/admin/affiliate-deals/offers") },
        { label: "Coda", href: panelPath(req, "/admin/affiliate-deals/queue") }
      ]
    },
    {
      title: "Cerca contatti e invia email",
      detail: "Ricerca aziende, approva indirizzi, prepara modelli e campagne email",
      href: panelPath(req, "/admin/outreach"),
      count: 0,
      permission: "outreach.view",
      actions: [
        { label: "Cerca contatti", href: panelPath(req, "/admin/outreach/search") },
        { label: "Modelli email", href: panelPath(req, "/admin/outreach/templates") },
        { label: "Campagne", href: panelPath(req, "/admin/outreach/campaigns") }
      ]
    },
    {
      title: "Controlla configurazione",
      detail: "Pagamenti, email, Cloudinary, SMTP, staff, integrazioni e testi legali",
      href: panelPath(req, "/admin/settings"),
      count: 0,
      permission: "settings",
      actions: [
        { label: "Impostazioni", href: panelPath(req, "/admin/settings") },
        { label: "Cloudinary", href: panelPath(req, "/admin/media") },
        { label: "Staff", href: panelPath(req, "/admin/staff") }
      ]
    }
  ];
}

function buildStaffWorkflowActions(req, account) {
  const actions = [
    { label: "Carica media", href: panelPath(req, "/admin/media"), detail: "Aggiungi immagini, video o documenti", permission: "media" },
    { label: "Aggiorna pagine", href: panelPath(req, "/admin/sections"), detail: "Modifica sezioni, testi, immagini e CTA", permission: "cms_sections" },
    { label: "Gestisci pacchetti", href: panelPath(req, "/admin/cms-packages"), detail: "Crea o aggiorna offerte e servizi", permission: "cms_packages" },
    { label: "Profili creator", href: panelPath(req, "/admin/creators"), detail: "Crea e aggiorna schede creator", permission: "creators" },
    { label: "Profili speaker", href: panelPath(req, "/admin/speakers"), detail: "Crea e aggiorna schede speaker", permission: "speakers" },
    { label: "Aziende e brand", href: panelPath(req, "/admin/brands"), detail: "Gestisci servizi e sezioni aziende", permission: "brands" },
    { label: "Contenuti utenti", href: panelPath(req, "/admin/content"), detail: "Revisiona upload e stato pubblicazione", permission: "content" },
    { label: "Video jobs", href: panelPath(req, "/admin/video-jobs"), detail: "Controlla elaborazioni video e problemi", permission: "video_jobs" },
    { label: "Offerte affiliate", href: panelPath(req, "/admin/affiliate-deals"), detail: "Ricerca offerte, approvazione e pubblicazioni social", permission: "affiliate_deals.view" },
    { label: "Mail e contatti", href: panelPath(req, "/admin/outreach"), detail: "Cerca contatti, prepara liste e modelli email", permission: "outreach.view" }
  ];
  return actions.filter((item) => !account || account.role === "admin" || account.permissions[item.permission]);
}

function dedupeByKey(rows, keyFn) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function adminBase() {
  const shell = await getSiteSettings();
  const scheduler = await schedulerService.getStatus();
  const telegram = await telegramService.getConfig();
  const facebook = await facebookService.getConfig();
  const amazon = await amazonService.getConfig();
  const growth = await db.getSetting("growth_strategy", []);
  const offerSettings = (await db.getSetting("offer_settings", {})) || {};
  const operations = (await db.getSetting("operations", {})) || {};
  const bank = (await db.getSetting("bank", {})) || {};
  const cloudinary = mediaService.getCloudinaryStatus();
  const mail = await mailService.getStatus();

  let amazonState = "manuale";
  if (amazon.provider === "demo") {
    amazonState = "demo";
  } else if (
    (amazon.provider === "amazon_api_ready" || amazon.provider === "creators_api") &&
    amazon.credentialId &&
    amazon.credentialSecret
  ) {
    amazonState = "API configurata";
  } else if (amazon.provider === "amazon_api_ready" || amazon.provider === "creators_api") {
    amazonState = "API pronta ma non configurata";
  }

  return {
    ...shell,
    scheduler,
    growth,
    operations,
    operationalChecks: buildOperationalChecks({
      legal: shell.legal,
      operations,
      bank,
      cloudinary,
      mail
    }),
    integrationState: {
      telegram: maskSecret(telegram.botToken),
      facebook: maskSecret(facebook.accessToken),
      amazon: amazonState,
      scheduler: offerSettings.schedulerEnabled === false ? "disattivato" : "attivo",
      database: db.meta.driver === "pg" ? "PostgreSQL attivo" : "SQLite locale",
      storage: "File nel database",
      cloudinary: cloudinary.configured ? "Pronto" : "Da completare",
      smtp: mail.configured ? "Pronto" : "Da configurare",
      bank:
        bank.holder && bank.iban && !String(bank.iban).includes("INSERIRE-IBAN")
          ? "Pronto"
          : "Da completare",
      paypal: operations.paypalMerchantEmail ? "Pronto per chiavi" : "Da completare",
      stripe:
        operations.stripePublishableKey
          ? "Publishable key presente"
          : "Da completare"
    },
    currentAmazonProvider: amazon.provider,
    mailStatus: mail
  };
}

router.get("/admin", async (req, res) => {
  if (req.session.adminId) {
    return res.redirect(panelHome(req, res.locals.currentAdmin));
  }
  return res.redirect("/admin/login");
});

router.get("/admin/login", async (req, res) => {
  if (req.session.adminId) {
    return res.redirect(panelHome(req, res.locals.currentAdmin));
  }
  const shell = await getSiteSettings();
  return renderAccessPage(res, req, "Admin login", shell);
});

router.post("/admin/login", async (req, res) => {
  const username = requiredText(req.body.username);
  const password = String(req.body.password || "");
  const admin = await db.get("SELECT * FROM admins WHERE username = ?", [username]);
  if (!admin || admin.role !== "admin" || admin.status !== "active" || !(await bcrypt.compare(password, admin.password_hash))) {
    req.session.flash = { type: "error", message: "Credenziali admin non valide." };
    return res.redirect("/admin/login");
  }

  req.session.adminId = admin.id;
  req.session.flash = { type: "success", message: "Accesso admin eseguito." };
  return res.redirect("/admin/dashboard");
});

router.get("/staff", async (req, res) => {
  if (req.session.adminId) {
    return res.redirect(panelHome(req, res.locals.currentAdmin));
  }
  return res.redirect("/staff/login");
});

router.get("/staff/login", async (req, res) => {
  if (req.session.adminId) {
    return res.redirect(panelHome(req, res.locals.currentAdmin));
  }
  res.locals.panelType = "staff";
  res.locals.panelBasePath = "/staff";
  res.locals.currentPath = "/staff/login";
  res.locals.panelPath = (path = "") => panelPath({ panelBasePath: "/staff" }, path);
  const shell = await getSiteSettings();
  return renderAccessPage(res, { ...req, panelType: "staff" }, "Login staff", shell);
});

router.post("/staff/login", async (req, res) => {
  const username = requiredText(req.body.username);
  const password = String(req.body.password || "");
  const admin = await db.get("SELECT * FROM admins WHERE username = ?", [username]);
  if (!admin || admin.role !== "staff" || admin.status !== "active" || !(await bcrypt.compare(password, admin.password_hash))) {
    req.session.flash = { type: "error", message: "Credenziali staff non valide." };
    return res.redirect("/staff/login");
  }

  req.session.adminId = admin.id;
  req.session.flash = { type: "success", message: "Accesso staff eseguito." };
  return res.redirect("/staff/dashboard");
});

router.use("/admin/dashboard", requirePermission("dashboard"));
router.use("/admin/analytics", requirePermission("analytics"));
router.use("/admin/orders", requirePermission("orders"));
router.use("/admin/activations", requirePermission("orders"));
router.use("/admin/payments", requirePermission("orders"));
router.use("/admin/users", requirePermission("users"));
router.use("/admin/clients", requirePermission("users"));
router.use("/admin/database", requirePermission("database"));
router.use("/admin/packages", requirePermission("cms_packages"));
router.use("/admin/services", requirePermission("cms_packages"));
router.use("/admin/content", requirePermission("content"));
router.use("/admin/files", requirePermission("content"));
router.use("/admin/video-jobs", requirePermission("video_jobs"));
router.use("/admin/videos", requirePermission("video_jobs"));
router.use("/admin/video-profiles", requirePermission("video_jobs"));
router.use("/admin/credits", requirePermission("credits"));
router.use("/admin/offers", requirePermission("offers"));
router.use("/admin/offer-settings", requirePermission("offers"));
router.use("/admin/telegram", requirePermission("integrations"));
router.use("/admin/facebook", requirePermission("integrations"));
router.use("/admin/amazon", requirePermission("integrations"));
router.use("/admin/settings", requirePermission("settings"));
router.use("/admin/cms-settings", requirePermission("settings"));
router.use("/admin/logs", requirePermission("logs"));

router.get("/admin/dashboard", requireAdmin, async (req, res) => {
  const rows = await Promise.all([
    db.get("SELECT COUNT(*) AS total FROM orders WHERE status IN ('pending_bank_transfer', 'pending_payment_setup')"),
    db.get("SELECT COUNT(*) AS total FROM users WHERE status = 'pending'"),
    db.get("SELECT COUNT(*) AS total FROM content_uploads WHERE status IN ('uploaded', 'under_review')"),
    db.get("SELECT COUNT(*) AS total FROM video_jobs WHERE status IN ('processing', 'failed')"),
    db.get("SELECT COUNT(*) AS total FROM offers WHERE source != 'demo'"),
    db.get("SELECT COUNT(*) AS total FROM offers WHERE source != 'demo' AND status = 'published_telegram'"),
    db.get("SELECT COUNT(*) AS total FROM offers WHERE source != 'demo' AND status = 'published_facebook'"),
    db.get("SELECT COUNT(*) AS total FROM media_assets WHERE status != 'deleted'"),
    db.get("SELECT COUNT(*) AS total FROM service_packages WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM creator_profiles WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM speaker_profiles WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM brand_services WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM notifications_log WHERE status IN ('new', 'nuova', 'logged')"),
    db.all("SELECT id, title, type, created_at FROM media_assets WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 5"),
    db.all("SELECT id, subject, type, status, created_at FROM notifications_log ORDER BY created_at DESC LIMIT 5"),
    db.all("SELECT admin_audit_logs.*, admins.username FROM admin_audit_logs LEFT JOIN admins ON admins.id = admin_audit_logs.admin_id ORDER BY admin_audit_logs.created_at DESC LIMIT 5")
  ]);

  const notifications = dedupeByKey(
    await db.all(
      `SELECT * FROM notifications_log
       WHERE type IN ('contact_request', 'activation_request', 'subscription_request_created', 'subscription_issue_created')
          OR status IN ('new', 'nuova')
       ORDER BY created_at DESC LIMIT 30`
    ),
    (item) => `${item.type}|${item.subject}|${item.status}`
  ).slice(0, 6);
  const technicalErrors = dedupeByKey(
    await db.all(
    "SELECT id, type, subject, status, created_at FROM notifications_log WHERE status IN ('failed', 'skipped') ORDER BY created_at DESC LIMIT 8"
    ),
    (item) => `${item.type}|${item.subject}|${item.status}`
  ).slice(0, 5);
  const offerSettings = await db.getSetting("offer_settings", {});
  const failedJobs = dedupeByKey(
    await db.all(
    "SELECT id, title, error_message, updated_at FROM video_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 5"
    ),
    (item) => `${item.title}|${item.error_message || ""}`
  ).slice(0, 4);
  const analyticsSummary = await analyticsService.getSummary(7);

  const stats = {
    pendingOrders: Number(rows[0].total || 0),
    pendingUsers: Number(rows[1].total || 0),
    pendingContent: Number(rows[2].total || 0),
    videoJobs: Number(rows[3].total || 0),
    offersFound: Number(rows[4].total || 0),
    telegramPublished: Number(rows[5].total || 0),
    facebookPublished: Number(rows[6].total || 0),
    mediaAssets: Number(rows[7].total || 0),
    activeCmsPackages: Number(rows[8].total || 0),
    publishedCreators: Number(rows[9].total || 0),
    publishedSpeakers: Number(rows[10].total || 0),
    activeBrandServices: Number(rows[11].total || 0),
    openRequests: Number(rows[12].total || 0)
  };
  const workflowCards = buildAdminWorkflows(req, stats);
  const staffQuickActions = buildStaffWorkflowActions(req, res.locals.currentAdmin);

  return renderAdminPage(res, "Admin dashboard", "admin-dashboard", {
    ...(await adminBase()),
    stats,
    actionQueue: buildActionQueue(stats),
    workflowCards,
    staffQuickActions,
    analyticsSummary,
    latestMedia: rows[13],
    latestRequests: rows[14],
    latestAuditLogs: rows[15],
    notifications,
    offerSettings,
    technicalErrors,
    failedJobs
  });
});

router.get("/admin/database", requireAdmin, async (req, res) => {
  const snapshot = await databaseExportService.getDatabaseSnapshot({ includeRows: true, previewOnly: true });
  return renderAdminPage(res, "Controllo database", "admin-database", {
    ...(await adminBase()),
    snapshot
  });
});

router.get("/admin/database/download", requireAdmin, async (req, res) => {
  const pdf = await databaseExportService.createDatabasePdf();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="creatorspeaker-database-${stamp}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  return res.send(pdf);
});

router.get("/admin/analytics", requireAdmin, async (req, res) => {
  const rangeDays = analyticsService.rangeDaysFromQuery(req.query.range);
  return renderAdminPage(res, "Analytics reali", "admin-analytics", {
    ...(await adminBase()),
    analytics: await analyticsService.getSummary(rangeDays)
  });
});

router.get("/admin/orders", requireAdmin, async (req, res) => {
  const orders = await db.all("SELECT * FROM orders ORDER BY created_at DESC");
  return renderAdminPage(res, "Ordini admin", "admin-orders", {
    ...(await adminBase()),
    orders: orders.map((row) => ({
      ...row,
      items: parseJson(row.items_json, []),
      payment_method_label:
        {
          bank_transfer: "Bonifico",
          paypal: "PayPal",
          stripe: "Stripe"
        }[row.payment_method] || row.payment_method || "Bonifico"
    }))
  });
});

router.get("/admin/payments", requireAdmin, async (req, res) => {
  const orders = await db.all("SELECT * FROM orders ORDER BY created_at DESC");
  return renderAdminPage(res, "Pagamenti e attivazioni", "admin-orders", {
    ...(await adminBase()),
    paymentMode: true,
    orders: orders.map((row) => ({
      ...row,
      items: parseJson(row.items_json, []),
      payment_method_label:
        {
          bank_transfer: "Bonifico",
          paypal: "PayPal",
          stripe: "Stripe"
        }[row.payment_method] || row.payment_method || "Bonifico"
    }))
  });
});

router.post("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const status = requiredText(req.body.status);
  const notes = requiredText(req.body.admin_notes);
  if (status === "activated") {
    await activateOrder(req.params.id);
  } else {
    await db.run(
      "UPDATE orders SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, notes, req.params.id]
    );
  }
  req.session.flash = { type: "success", message: "Ordine aggiornato." };
  return res.redirect("/admin/orders");
});

router.get("/admin/users", requireAdmin, async (req, res) => {
  const users = await db.all(
    `SELECT users.*,
      (SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id OR orders.customer_email = users.email) AS orders_total,
      (SELECT COUNT(*) FROM content_uploads WHERE content_uploads.user_id = users.id) AS uploads_total,
      (SELECT COUNT(*) FROM video_jobs WHERE video_jobs.user_id = users.id) AS video_jobs_total
    FROM users
    ORDER BY created_at DESC`
  );
  return renderAdminPage(res, "Utenti", "admin-users", {
    ...(await adminBase()),
    users
  });
});

router.get("/admin/clients", requireAdmin, async (req, res) => {
  const users = await db.all(
    `SELECT users.*,
      (SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id OR orders.customer_email = users.email) AS orders_total,
      (SELECT COUNT(*) FROM content_uploads WHERE content_uploads.user_id = users.id) AS uploads_total,
      (SELECT COUNT(*) FROM video_jobs WHERE video_jobs.user_id = users.id) AS video_jobs_total
    FROM users
    WHERE status != 'pending'
       OR EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id OR orders.customer_email = users.email)
    ORDER BY created_at DESC`
  );
  return renderAdminPage(res, "Clienti", "admin-users", {
    ...(await adminBase()),
    clientsMode: true,
    users
  });
});

router.post("/admin/users/:id/status", requireAdmin, async (req, res) => {
  await db.run("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    requiredText(req.body.status),
    req.params.id
  ]);
  req.session.flash = { type: "success", message: "Stato utente aggiornato." };
  return res.redirect("/admin/users");
});

router.post("/admin/users/:id/credits", requireAdmin, async (req, res) => {
  await db.run("UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    toInt(req.body.credits, 0),
    req.params.id
  ]);
  req.session.flash = { type: "success", message: "Crediti utente aggiornati." };
  return res.redirect("/admin/users");
});

router.get("/admin/staff", requireSuperAdmin, async (req, res) => {
  const staffAccounts = await db.all(
    "SELECT id, username, display_name, role, status, permissions_json, must_change_password, created_at, updated_at FROM admins WHERE role = 'staff' ORDER BY id ASC"
  );
  return renderAdminPage(res, "Gestione staff", "admin-staff", {
    ...(await adminBase()),
    staffAccounts: staffAccounts.map((item) => ({
      ...item,
      permissions: normalizePermissions(parseJson(item.permissions_json, {}))
    })),
    permissionKeys: STAFF_PERMISSION_KEYS,
    permissionLabels: staffPermissionLabels
  });
});

router.post("/admin/staff", requireSuperAdmin, async (req, res) => {
  const username = requiredText(req.body.username);
  const displayName = requiredText(req.body.display_name) || username;
  const password = String(req.body.password || "");
  if (!username || password.length < 10) {
    req.session.flash = { type: "error", message: "Inserisci username staff e password di almeno 10 caratteri." };
    return res.redirect("/admin/staff");
  }

  const existing = await db.get("SELECT id FROM admins WHERE username = ?", [username]);
  if (existing) {
    req.session.flash = { type: "error", message: "Username staff gia presente." };
    return res.redirect("/admin/staff");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert("admins", {
    username,
    display_name: displayName,
    role: "staff",
    status: requiredText(req.body.status || "active"),
    permissions_json: stringifyJson(sanitizeStaffPermissions(req.body)),
    password_hash: passwordHash,
    must_change_password: db.meta.driver === "pg" ? true : 1
  });
  req.session.flash = { type: "success", message: "Account staff creato." };
  return res.redirect("/admin/staff");
});

router.post("/admin/staff/:id", requireSuperAdmin, async (req, res) => {
  const staff = await db.get("SELECT * FROM admins WHERE id = ? AND role = 'staff'", [req.params.id]);
  if (!staff) {
    req.session.flash = { type: "error", message: "Account staff non trovato." };
    return res.redirect("/admin/staff");
  }

  const username = requiredText(req.body.username);
  if (!username) {
    req.session.flash = { type: "error", message: "Lo username staff non puo essere vuoto." };
    return res.redirect("/admin/staff");
  }

  const duplicated = await db.get("SELECT id FROM admins WHERE username = ? AND id != ?", [username, req.params.id]);
  if (duplicated) {
    req.session.flash = { type: "error", message: "Esiste gia un account con questo username." };
    return res.redirect("/admin/staff");
  }

  await db.run(
    "UPDATE admins SET username = ?, display_name = ?, status = ?, permissions_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      username,
      requiredText(req.body.display_name) || username,
      requiredText(req.body.status || "active"),
      stringifyJson(sanitizeStaffPermissions(req.body)),
      req.params.id
    ]
  );
  req.session.flash = { type: "success", message: "Permessi e dati staff aggiornati." };
  return res.redirect("/admin/staff");
});

router.post("/admin/staff/:id/password", requireSuperAdmin, async (req, res) => {
  const staff = await db.get("SELECT * FROM admins WHERE id = ? AND role = 'staff'", [req.params.id]);
  const newPassword = String(req.body.new_password || "");
  if (!staff) {
    req.session.flash = { type: "error", message: "Account staff non trovato." };
    return res.redirect("/admin/staff");
  }
  if (newPassword.length < 10) {
    req.session.flash = { type: "error", message: "La nuova password staff deve avere almeno 10 caratteri." };
    return res.redirect("/admin/staff");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.run(
    "UPDATE admins SET password_hash = ?, must_change_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [passwordHash, db.meta.driver === "pg" ? true : 1, req.params.id]
  );
  req.session.flash = { type: "success", message: "Password staff aggiornata." };
  return res.redirect("/admin/staff");
});

router.get("/admin/packages", requireAdmin, async (req, res) => {
  const packages = await db.all("SELECT * FROM packages ORDER BY sort_order ASC, id ASC");
  return renderAdminPage(res, "Pacchetti", "admin-packages", {
    ...(await adminBase()),
    packages: packages.map((item) => ({ ...item, features: parseJson(item.features_json, []) }))
  });
});

router.post("/admin/packages", requireAdmin, async (req, res) => {
  const payload = normalizePackagePayload(req.body);
  await db.insert("packages", {
    area: payload.area,
    name: payload.name,
    slug: payload.slug,
    price_cents: payload.price_cents,
    billing_type: payload.billing_type,
    description: payload.description,
    features_json: stringifyJson(payload.features),
    active: db.meta.driver === "pg" ? payload.active : Number(payload.active),
    sort_order: payload.sort_order
  });
  req.session.flash = { type: "success", message: "Pacchetto creato." };
  return res.redirect("/admin/packages");
});

router.post("/admin/packages/:id", requireAdmin, async (req, res) => {
  const payload = normalizePackagePayload(req.body);
  await db.run(
    "UPDATE packages SET area = ?, name = ?, slug = ?, price_cents = ?, billing_type = ?, description = ?, features_json = ?, active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      payload.area,
      payload.name,
      payload.slug,
      payload.price_cents,
      payload.billing_type,
      payload.description,
      stringifyJson(payload.features),
      db.meta.driver === "pg" ? payload.active : Number(payload.active),
      payload.sort_order,
      req.params.id
    ]
  );
  req.session.flash = { type: "success", message: "Pacchetto aggiornato." };
  return res.redirect("/admin/packages");
});

router.get("/admin/services", requireAdmin, async (req, res) => {
  const services = await db.all(
    "SELECT * FROM packages WHERE area IN ('extra', 'caricamenti', 'aziende') ORDER BY sort_order ASC, id ASC"
  );
  return renderAdminPage(res, "Servizi", "admin-services", {
    ...(await adminBase()),
    services
  });
});

router.get("/admin/content", requireAdmin, async (req, res) => {
  const content = await db.all(
    "SELECT content_uploads.*, users.name AS user_name FROM content_uploads LEFT JOIN users ON users.id = content_uploads.user_id ORDER BY content_uploads.created_at DESC"
  );
  return renderAdminPage(res, "Contenuti", "admin-content", {
    ...(await adminBase()),
    content: content.map((item) => ({
      ...item,
      file_url: item.file_id ? `/admin/files/${item.file_id}` : `/${item.file_path}`,
      file_label: item.original_filename || item.title,
      progress_percent: Number(item.progress_percent || 100)
    }))
  });
});

router.post("/admin/content/:id/status", requireAdmin, async (req, res) => {
  await db.run(
    "UPDATE content_uploads SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [requiredText(req.body.status), requiredText(req.body.admin_notes), req.params.id]
  );
  req.session.flash = { type: "success", message: "Contenuto aggiornato." };
  return res.redirect("/admin/content");
});

router.get("/admin/video-jobs", requireAdmin, async (req, res) => {
  const showAll = requiredText(req.query.show) === "all";
  const jobs = await db.all(
    `SELECT video_jobs.*, users.name AS user_name, video_render_profiles.name AS profile_name
     FROM video_jobs
     LEFT JOIN users ON users.id = video_jobs.user_id
     LEFT JOIN video_render_profiles ON video_render_profiles.id = video_jobs.render_profile_id
     ${showAll ? "" : "WHERE video_jobs.status != 'refunded' AND video_jobs.refunded = " + (db.meta.driver === "pg" ? "FALSE" : "0")}
     ORDER BY video_jobs.created_at DESC`
  );
  return renderAdminPage(res, "Video jobs", "admin-video-jobs", {
    ...(await adminBase()),
    showAll,
    jobs: jobs.map((job) => ({
      ...job,
      progress_percent: Number(job.progress_percent || 0),
      output_url: job.output_file_id ? `/admin/videos/${job.id}/download` : job.output_secure_url || job.output_path || ""
    }))
  });
});

router.get("/admin/video-jobs/:id/status", requireAdmin, async (req, res) => {
  const job = await db.get("SELECT * FROM video_jobs WHERE id = ?", [req.params.id]);
  if (!job) {
    return res.status(404).json({ ok: false });
  }
  return res.json({
    ok: true,
    status: job.status,
    statusLabel: job.status,
    progressPercent: Number(job.progress_percent || 0),
    statusDetail: job.status_detail || "",
    outputUrl: job.output_file_id ? `/admin/videos/${job.id}/download` : job.output_secure_url || job.output_path || "",
    errorMessage: job.error_message || ""
  });
});

router.get("/admin/videos", requireAdmin, async (req, res) => {
  const status = requiredText(req.query.status);
  const params = [];
  const where = [];
  if (status) {
    where.push("video_jobs.status = ?");
    params.push(status);
  }
  const jobs = await db.all(
    `SELECT video_jobs.*, users.name AS user_name, users.email AS user_email, video_render_profiles.name AS profile_name
     FROM video_jobs
     LEFT JOIN users ON users.id = video_jobs.user_id
     LEFT JOIN video_render_profiles ON video_render_profiles.id = video_jobs.render_profile_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY video_jobs.created_at DESC, video_jobs.id DESC`,
    params
  );
  return renderAdminPage(res, "Archivio video", "admin-videos", {
    ...(await adminBase()),
    status,
    jobs: jobs.map((job) => ({
      ...job,
      progress_percent: Number(job.progress_percent || 0),
      output_url: job.output_file_id ? `/admin/videos/${job.id}/download` : job.output_secure_url || job.output_path || ""
    }))
  });
});

router.get("/admin/videos/:id", requireAdmin, async (req, res) => {
  const job = await db.get(
    `SELECT video_jobs.*, users.name AS user_name, users.email AS user_email, video_render_profiles.name AS profile_name
     FROM video_jobs
     LEFT JOIN users ON users.id = video_jobs.user_id
     LEFT JOIN video_render_profiles ON video_render_profiles.id = video_jobs.render_profile_id
     WHERE video_jobs.id = ?`,
    [req.params.id]
  );
  if (!job) {
    return res.redirect("/admin/videos");
  }
  const timeline = await db.all(
    `SELECT video_job_images.*, stored_files.original_name
     FROM video_job_images
     LEFT JOIN stored_files ON stored_files.id = video_job_images.file_id
     WHERE video_job_images.video_job_id = ?
     ORDER BY video_job_images.sort_order ASC, video_job_images.id ASC`,
    [job.id]
  );
  return renderAdminPage(res, "Dettaglio video", "admin-video-detail", {
    ...(await adminBase()),
    job: {
      ...job,
      progress_percent: Number(job.progress_percent || 0),
      output_url: job.output_file_id ? `/admin/videos/${job.id}/download` : job.output_secure_url || job.output_path || ""
    },
    timeline
  });
});

router.get("/admin/video-profiles", requireAdmin, async (req, res) => {
  const profiles = await videoService.listRenderProfiles({ includeInactive: true });
  return renderAdminPage(res, "Profili video", "admin-video-profiles", {
    ...(await adminBase()),
    profiles
  });
});

router.post("/admin/video-profiles/:id", requireAdmin, async (req, res) => {
  await videoService.updateRenderProfile(req.params.id, req.body);
  req.session.flash = { type: "success", message: "Profilo video aggiornato" };
  return res.redirect("/admin/video-profiles");
});

router.get("/admin/credits", requireAdmin, async (req, res) => {
  const users = await db.all("SELECT id, name, email, credits, status FROM users ORDER BY credits DESC");
  const costs = await db.getSetting("video_credit_costs", {});
  return renderAdminPage(res, "Crediti", "admin-credits", {
    ...(await adminBase()),
    users,
    costs
  });
});

router.post("/admin/video-jobs/:id/refund", requireAdmin, async (req, res) => {
  const job = await db.get("SELECT * FROM video_jobs WHERE id = ?", [req.params.id]);
  if (job) {
    await videoService.refundJobCredits(job, "Crediti rimborsati e job chiuso");
  }
  req.session.flash = { type: "success", message: "Rimborso crediti eseguito se disponibile" };
  return res.redirect("/admin/video-jobs");
});

router.post("/admin/video-jobs/:id/retry", requireAdmin, async (req, res) => {
  const job = await videoService.retryVideoJob(req.params.id);
  req.session.flash = {
    type: job ? "success" : "error",
    message: job ? "Elaborazione rilanciata." : "Video job non trovato."
  };
  return res.redirect("/admin/video-jobs");
});

router.get("/admin/offers", requireAdmin, async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.category) {
    where.push("categories.slug = ?");
    params.push(req.query.category);
  }
  if (req.query.status) {
    where.push("offers.status = ?");
    params.push(req.query.status);
  }
  if (req.query.q) {
    where.push("LOWER(offers.title) LIKE ?");
    params.push(`%${String(req.query.q).toLowerCase()}%`);
  }

  const sql = `SELECT offers.*, categories.name AS category_name, categories.slug AS category_slug
    FROM offers
    LEFT JOIN categories ON categories.id = offers.category_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY offers.score DESC, offers.created_at DESC`;
  const offers = await db.all(sql, params);
  const categories = await db.all("SELECT * FROM categories ORDER BY sort_order ASC");

  return renderAdminPage(res, "Offerte", "admin-offers", {
    ...(await adminBase()),
    offers,
    categories,
    filters: req.query
  });
});

router.post("/admin/offers/manual", requireAdmin, async (req, res) => {
  const category = await db.get("SELECT * FROM categories WHERE id = ?", [req.body.category_id]);
  const productUrl = requiredText(req.body.product_url);
  const affiliateUrl = requiredText(req.body.affiliate_url) || productUrl;
  const normal = toInt(req.body.normal_price_cents, 0);
  const current = toInt(req.body.current_price_cents, 0);
  const discount = normal > current ? Math.round(((normal - current) / normal) * 100) : 0;

  await db.insert("offers", {
    source: "manual",
    category_id: category ? category.id : null,
    title: requiredText(req.body.title),
    asin: requiredText(req.body.asin) || null,
    image_url: requiredText(req.body.image_url),
    product_url: productUrl,
    affiliate_url: affiliateUrl,
    normal_price_cents: normal || null,
    current_price_cents: current,
    discount_percent: discount,
    prime_available: db.meta.driver === "pg" ? toBool(req.body.prime_available) : Number(toBool(req.body.prime_available)),
    score: toInt(req.body.score, 65),
    status: "approved"
  });
  req.session.flash = { type: "success", message: "Offerta manuale salvata." };
  return res.redirect("/admin/offers");
});

router.post("/admin/offers/:id/approve", requireAdmin, async (req, res) => {
  await db.run("UPDATE offers SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    req.params.id
  ]);
  res.redirect("/admin/offers");
});

router.post("/admin/offers/:id/reject", requireAdmin, async (req, res) => {
  await db.run("UPDATE offers SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    req.params.id
  ]);
  res.redirect("/admin/offers");
});

router.post("/admin/offers/:id/publish-telegram", requireAdmin, async (req, res) => {
  const offer = await db.get("SELECT * FROM offers WHERE id = ?", [req.params.id]);
  const result = await telegramService.publishOffer(offer);
  if (result.ok) {
    await db.run(
      "UPDATE offers SET status = 'published_telegram', published_telegram_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [req.params.id]
    );
  }
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/admin/offers");
});

router.post("/admin/offers/:id/publish-facebook", requireAdmin, async (req, res) => {
  const offer = await db.get("SELECT * FROM offers WHERE id = ?", [req.params.id]);
  const result = await facebookService.publishOffer(offer, "📣 OFFERTA SELEZIONATA");
  if (result.ok) {
    await db.run(
      "UPDATE offers SET status = 'published_facebook', published_facebook_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [req.params.id]
    );
  }
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/admin/offers");
});

router.post("/admin/offers/:id/archive", requireAdmin, async (req, res) => {
  await db.run("UPDATE offers SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    req.params.id
  ]);
  return res.redirect("/admin/offers");
});

router.get("/admin/offer-settings", requireAdmin, async (req, res) => {
  const offerSettings = await db.getSetting("offer_settings", {});
  const categories = await db.all("SELECT * FROM categories ORDER BY sort_order ASC");
  return renderAdminPage(res, "Impostazioni offerte", "admin-offer-settings", {
    ...(await adminBase()),
    offerSettings,
    categories: categories.map((item) => ({ ...item, meta: parseJson(item.amazon_keywords_json, {}) })),
    amazonProvider: await amazonService.getConfig()
  });
});

router.post("/admin/offer-settings", requireAdmin, async (req, res) => {
  const settings = (await db.getSetting("offer_settings", {})) || {};
  settings.schedulerEnabled = toBool(req.body.schedulerEnabled);
  settings.searchFrequencyMinutes = toInt(req.body.searchFrequencyMinutes, 60);
  settings.telegramFrequencyMinutes = toInt(req.body.telegramFrequencyMinutes, 120);
  settings.minDiscountPercent = toInt(req.body.minDiscountPercent, 10);
  settings.minScore = toInt(req.body.minScore, 55);
  await db.setSetting("offer_settings", settings);

  const categories = await db.all("SELECT * FROM categories ORDER BY sort_order ASC");
  for (const category of categories) {
    const active = toBool(req.body[`category_active_${category.id}`]);
    const meta = parseJson(category.amazon_keywords_json, {});
    meta.keywords = String(req.body[`category_keywords_${category.id}`] || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    meta.minDiscountPercent = toInt(req.body[`category_min_discount_${category.id}`], 10);
    meta.minPriceCents = toInt(req.body[`category_min_price_${category.id}`], 1000);
    meta.maxPriceCents = toInt(req.body[`category_max_price_${category.id}`], 300000);
    meta.minScore = toInt(req.body[`category_min_score_${category.id}`], 55);
    await db.run(
      "UPDATE categories SET active = ?, amazon_keywords_json = ? WHERE id = ?",
      [db.meta.driver === "pg" ? active : Number(active), JSON.stringify(meta), category.id]
    );
  }

  req.session.flash = { type: "success", message: "Impostazioni offerte aggiornate." };
  return res.redirect("/admin/offer-settings");
});

router.get("/admin/telegram", requireAdmin, async (req, res) => {
  const telegram = await telegramService.getConfig();
  return renderAdminPage(res, "Telegram", "admin-telegram", {
    ...(await adminBase()),
    telegram,
    secretState: maskSecret(telegram.botToken)
  });
});

router.post("/admin/telegram", requireAdmin, async (req, res) => {
  const current = (await db.getSetting("telegram", {})) || {};
  current.enabled = toBool(req.body.enabled);
  current.channelId = requiredText(req.body.channelId);
  current.channelLogo = requiredText(req.body.channelLogo) || current.channelLogo;
  current.frequencyMinutes = toInt(req.body.frequencyMinutes, 120);
  current.dailyLimit = toInt(req.body.dailyLimit, 4);
  current.messageFormat = requiredText(req.body.messageFormat) || "standard";
  if (requiredText(req.body.botToken)) {
    current.botToken = requiredText(req.body.botToken);
  }
  await db.setSetting("telegram", current);
  req.session.flash = { type: "success", message: "Configurazione Telegram salvata." };
  return res.redirect("/admin/telegram");
});

router.post("/admin/telegram/test", requireAdmin, async (req, res) => {
  const result = await telegramService.sendTest();
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/admin/telegram");
});

router.get("/admin/facebook", requireAdmin, async (req, res) => {
  const facebook = await facebookService.getConfig();
  return renderAdminPage(res, "Facebook", "admin-facebook", {
    ...(await adminBase()),
    facebook,
    secretState: maskSecret(facebook.accessToken)
  });
});

router.post("/admin/facebook", requireAdmin, async (req, res) => {
  const current = (await db.getSetting("facebook", {})) || {};
  current.enabled = toBool(req.body.enabled);
  current.pageUrl = requiredText(req.body.pageUrl);
  current.pageId = requiredText(req.body.pageId);
  current.postTime1 = requiredText(req.body.postTime1) || "07:00";
  current.postTime2 = requiredText(req.body.postTime2) || "19:00";
  current.minHoursDistance = toInt(req.body.minHoursDistance, 12);
  if (requiredText(req.body.accessToken)) {
    current.accessToken = requiredText(req.body.accessToken);
  }
  await db.setSetting("facebook", current);
  req.session.flash = { type: "success", message: "Configurazione Facebook salvata." };
  return res.redirect("/admin/facebook");
});

router.post("/admin/facebook/test", requireAdmin, async (req, res) => {
  const result = await facebookService.sendTest();
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/admin/facebook");
});

router.get("/admin/amazon", requireAdmin, async (req, res) => {
  const amazon = await amazonService.getConfig();
  return renderAdminPage(res, "Amazon", "admin-amazon", {
    ...(await adminBase()),
    amazon,
    secretState: maskSecret(amazon.credentialSecret || amazon.credentialId)
  });
});

router.post("/admin/amazon", requireAdmin, async (req, res) => {
  const current = (await db.getSetting("amazon", {})) || {};
  current.provider = requiredText(req.body.provider) || "demo";
  current.associateTag = requiredText(req.body.associateTag);
  current.trackingId = requiredText(req.body.trackingId);
  current.marketplace = requiredText(req.body.marketplace) || "IT";
  current.region = requiredText(req.body.region) || "EU";
  if (requiredText(req.body.credentialId)) {
    current.credentialId = requiredText(req.body.credentialId);
  }
  if (requiredText(req.body.credentialSecret)) {
    current.credentialSecret = requiredText(req.body.credentialSecret);
  }
  await db.setSetting("amazon", current);
  req.session.flash = { type: "success", message: "Configurazione Amazon salvata." };
  return res.redirect("/admin/amazon");
});

router.post("/admin/amazon/test", requireAdmin, async (req, res) => {
  const result = await amazonService.testConnection();
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/admin/amazon");
});

router.get("/admin/settings", requireAdmin, async (req, res) => {
  const site = await db.getSetting("site", {});
  const bank = await db.getSetting("bank", {});
  const legal = (await db.getSetting("legal", {})) || {};
  const operations = await db.getSetting("operations", {});
  const growth = await db.getSetting("growth_strategy", []);
  const notifications = await db.all("SELECT * FROM notifications_log ORDER BY created_at DESC LIMIT 20");
  const cmsSettingsRows = await db.all("SELECT key, value FROM site_settings");
  const cmsSettings = cmsSettingsRows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
  const infoEmail =
    (operations && operations.officialInfoEmail) ||
    process.env.CONTACT_EMAIL_INFO ||
    "info@creatorspeakertv.it";
  return renderAdminPage(res, "Impostazioni", "admin-settings", {
    ...(await adminBase()),
    site,
    bank,
    legal: {
      privacy:
        legal.privacy ||
        `CreatorSpeaker TV tratta i dati raccolti tramite registrazione, contatto, area riservata, richieste operative e sicurezza della piattaforma. Per richieste privacy puoi scrivere a ${infoEmail}\n\nGestione dei dati tecnici degli accessi\nI dati tecnici e riservati relativi agli accessi digitali vengono gestiti con misure di sicurezza e cifratura lato server. Gli utenti autorizzati possono visualizzare le credenziali solo dopo attivazione manuale dell admin. Ogni visualizzazione delle credenziali puo essere registrata per ragioni di sicurezza e gestione degli accessi`,
      cookie:
        legal.cookie ||
        "Il sito utilizza cookie tecnici e di sessione necessari a sicurezza, autenticazione, continuita di navigazione e protezione dei form. Strumenti non tecnici restano inattivi fino a configurazione dedicata",
      terms:
        legal.terms ||
        `I servizi vengono erogati previa verifica amministrativa, uso lecito della piattaforma e rispetto delle condizioni operative. Per chiarimenti puoi contattare ${infoEmail}\n\nAccessi digitali condivisi\nCreatorSpeaker puo mettere a disposizione degli utenti autorizzati accessi digitali collegati a strumenti, servizi o piattaforme esterne. L attivazione avviene solo dopo richiesta, verifica e approvazione manuale da parte dell admin. Gli accessi sono personali, temporanei e revocabili in caso di uso improprio, condivisione non autorizzata, mancato rispetto delle istruzioni o violazione delle condizioni previste. L utente si impegna a non condividere credenziali, accessi, link o materiali riservati con terzi`
    },
    operations,
    cmsSettings,
    growth,
    notifications
  });
});

router.post("/admin/settings", requireAdmin, async (req, res) => {
  await db.setSetting("site", {
    name: requiredText(req.body.siteName) || "creatorspeaker TV",
    claim: requiredText(req.body.siteClaim) || "Creator & Speaker Network",
    logo: requiredText(req.body.siteLogo) || "/assets/brand/creatorspeaker-brand-emblem.jpg",
    colors: {
      bg: requiredText(req.body.colorBg) || "#070812",
      panel: requiredText(req.body.colorPanel) || "#101322",
      accent: requiredText(req.body.colorAccent) || "#7C3AED",
      accent2: requiredText(req.body.colorAccent2) || "#E50914",
      gold: requiredText(req.body.colorGold) || "#FFD166",
      cyan: requiredText(req.body.colorCyan) || "#23D5FF"
    }
  });
  await db.setSetting("bank", {
    holder: requiredText(req.body.bankHolder) || "CreatorSpeaker TV",
    iban: requiredText(req.body.bankIban) || "INSERIRE-IBAN-REALE-DA-PANNELLO-ADMIN",
    causalPrefix: requiredText(req.body.bankCausalPrefix) || "Ordine creatorspeaker TV",
    adminNote: requiredText(req.body.bankAdminNote)
  });
  await db.setSetting("legal", {
    privacy: requiredText(req.body.privacyText),
    cookie: requiredText(req.body.cookieText),
    terms: requiredText(req.body.termsText)
  });
  await db.setSetting("operations", {
    officialInfoEmail: requiredText(req.body.officialInfoEmail) || "info@creatorspeakertv.it",
    officialServiceEmail: requiredText(req.body.officialServiceEmail) || "service@creatorspeakertv.it",
    officialNetworkEmail: requiredText(req.body.officialNetworkEmail) || "netwrok@creatorspeakertv.it",
    paypalMerchantEmail: requiredText(req.body.paypalMerchantEmail),
    stripePublishableKey: requiredText(req.body.stripePublishableKey),
    smtpHost: requiredText(req.body.smtpHost),
    smtpPort: requiredText(req.body.smtpPort),
    smtpUser: requiredText(req.body.smtpUser),
    smtpFrom: requiredText(req.body.smtpFrom),
    smtpSecure: toBool(req.body.smtpSecure),
    enableBankTransfer: toBool(req.body.enableBankTransfer),
    enablePaypal: toBool(req.body.enablePaypal),
    enableStripe: toBool(req.body.enableStripe)
  });
  req.session.flash = { type: "success", message: "Impostazioni sito salvate." };
  return res.redirect("/admin/settings");
});

router.post("/admin/settings/test-email", requireAdmin, async (req, res) => {
  const target = requiredText(req.body.test_email) || requiredText(req.body.smtpFrom) || "info@creatorspeakertv.it";
  const result = await mailService.testConnection();
  if (!result.ok) {
    req.session.flash = { type: "error", message: result.message };
    return res.redirect("/admin/settings");
  }
  try {
    await mailService.sendMail({
      to: target,
      subject: "Test email CreatorSpeaker TV",
      text: "Test SMTP completato. Le email di recupero password e benvenuto sono pronte."
    });
    req.session.flash = { type: "success", message: `Email test inviata a ${target}` };
  } catch (error) {
    req.session.flash = { type: "error", message: `Invio test non riuscito: ${error.message}` };
  }
  return res.redirect("/admin/settings");
});

router.get("/admin/files/:fileId", requireAdmin, async (req, res) => {
  return sendStoredFile(res, req.params.fileId, true);
});

router.get("/admin/video-jobs/:id/output", requireAdmin, async (req, res) => {
  return res.redirect(`/admin/videos/${req.params.id}/download`);
});

router.get("/admin/videos/:id/download", requireAdmin, async (req, res) => {
  const job = await db.get("SELECT output_file_id FROM video_jobs WHERE id = ?", [req.params.id]);
  if (!job || !job.output_file_id) {
    return res.redirect("/admin/videos");
  }
  return sendStoredFile(res, job.output_file_id, false);
});

router.get("/admin/password", requireAdmin, async (req, res) => {
  return renderAdminPage(res, "Password admin", "admin-login", {
    ...(await adminBase()),
    passwordMode: true,
    accessMode: req.panelType === "staff" ? "staff" : "admin"
  });
});

router.post("/admin/password", requireAdmin, async (req, res) => {
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const confirmPassword = String(req.body.confirm_password || "");
  const admin = await db.get("SELECT * FROM admins WHERE id = ?", [req.session.adminId]);

  if (!admin || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
    req.session.flash = { type: "error", message: "Password attuale non valida." };
    return res.redirect("/admin/password");
  }

  if (newPassword.length < 10 || newPassword !== confirmPassword) {
    req.session.flash = { type: "error", message: "Nuova password non valida o non coincidente." };
    return res.redirect("/admin/password");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.run(
    "UPDATE admins SET password_hash = ?, must_change_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [passwordHash, db.meta.driver === "pg" ? false : 0, admin.id]
  );
  req.session.flash = { type: "success", message: "Password aggiornata." };
  return res.redirect(panelHome(req, res.locals.currentAdmin));
});

module.exports = router;
