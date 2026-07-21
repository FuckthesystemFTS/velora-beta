const { parseJson } = require("../utils/safeJson");

const STAFF_PERMISSION_KEYS = [
  "dashboard",
  "analytics",
  "media",
  "cms_sections",
  "cms_packages",
  "creators",
  "speakers",
  "brands",
  "smart_tv",
  "requests",
  "orders",
  "users",
  "database",
  "content",
  "video_jobs",
  "credits",
  "offers",
  "affiliate_deals.view",
  "affiliate_deals.search",
  "affiliate_deals.approve",
  "affiliate_deals.publish",
  "affiliate_deals.categories_manage",
  "affiliate_deals.templates_manage",
  "affiliate_deals.scheduler_manage",
  "affiliate_deals.settings_manage",
  "affiliate_deals.logs_view",
  "affiliate_deals.facebook_manage",
  "affiliate_deals.telegram_manage",
  "affiliate_deals.amazon_manage",
  "subscriptions",
  "integrations",
  "settings",
  "logs",
  "outreach.view",
  "outreach.search",
  "outreach.contacts.manage",
  "outreach.lists.manage",
  "outreach.templates.manage",
  "outreach.campaigns.create",
  "outreach.campaigns.send",
  "outreach.settings.manage",
  "outreach.logs.view"
];

const DEFAULT_STAFF_PERMISSIONS = {
  dashboard: true,
  analytics: true,
  media: true,
  cms_sections: true,
  cms_packages: true,
  creators: true,
  speakers: true,
  brands: true,
  smart_tv: true,
  requests: true,
  orders: false,
  users: false,
  database: false,
  content: true,
  video_jobs: true,
  credits: false,
  offers: false,
  "affiliate_deals.view": false,
  "affiliate_deals.search": false,
  "affiliate_deals.approve": false,
  "affiliate_deals.publish": false,
  "affiliate_deals.categories_manage": false,
  "affiliate_deals.templates_manage": false,
  "affiliate_deals.scheduler_manage": false,
  "affiliate_deals.settings_manage": false,
  "affiliate_deals.logs_view": false,
  "affiliate_deals.facebook_manage": false,
  "affiliate_deals.telegram_manage": false,
  "affiliate_deals.amazon_manage": false,
  subscriptions: false,
  integrations: false,
  settings: false,
  logs: false,
  "outreach.view": true,
  "outreach.search": true,
  "outreach.contacts.manage": true,
  "outreach.lists.manage": true,
  "outreach.templates.manage": true,
  "outreach.campaigns.create": true,
  "outreach.campaigns.send": false,
  "outreach.settings.manage": false,
  "outreach.logs.view": false
};

function normalizePermissions(input) {
  const parsed =
    typeof input === "string"
      ? parseJson(input, {})
      : input && typeof input === "object"
        ? input
        : {};
  return STAFF_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(parsed[key] ?? DEFAULT_STAFF_PERMISSIONS[key]);
    return acc;
  }, {});
}

function hasPermission(account, permission) {
  if (!account || account.status !== "active") {
    return false;
  }
  if (account.role === "admin") {
    return true;
  }
  const permissions = normalizePermissions(account.permissions || account.permissions_json);
  return Boolean(permissions[permission]);
}

function currentPanelBasePath(req) {
  return req.panelBasePath || "/admin";
}

function currentLoginPath(req) {
  return currentPanelBasePath(req) === "/staff" ? "/staff/login" : "/admin/login";
}

function normalizePanelPath(basePath, path) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return path;
  }
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

function createPanelContext(panelType = "admin") {
  const basePath = panelType === "staff" ? "/staff" : "/admin";
  return (req, res, next) => {
    req.panelType = panelType;
    req.panelBasePath = basePath;
    res.locals.panelType = panelType;
    res.locals.panelBasePath = basePath;
    res.locals.currentPath = `${basePath}${req.path === "/" ? "" : req.path}`;
    res.locals.panelPath = (path = "") => normalizePanelPath(basePath, path || "");
    res.locals.canPanelPermission = (permission) => hasPermission(res.locals.currentAdmin, permission);

    const originalRedirect = res.redirect.bind(res);
    res.redirect = (statusOrPath, maybePath) => {
      if (typeof statusOrPath === "number") {
        return originalRedirect(statusOrPath, normalizePanelPath(basePath, maybePath));
      }
      return originalRedirect(normalizePanelPath(basePath, statusOrPath));
    };

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (panelType === "staff" && typeof body === "string") {
        let output = body;
        output = output.replace(/"\/admin(?=\/|")/g, `"/staff`);
        output = output.replace(/'\/admin(?=\/|')/g, `'/staff`);
        output = output.replace(/`\/admin(?=\/|`)/g, "`/staff");
        body = output;
      }
      return originalSend(body);
    };

    next();
  };
}

function requireAdmin(req, res, next) {
  const account = res.locals.currentAdmin;
  if (!req.session.adminId || !account) {
    req.session.flash = { type: "error", message: "Accesso richiesto." };
    return res.redirect(currentLoginPath(req));
  }
  if (account.status !== "active") {
    delete req.session.adminId;
    req.session.flash = { type: "error", message: "Account non attivo. Contatta l admin principale." };
    return res.redirect(currentLoginPath(req));
  }
  if (account.role === "staff" && currentPanelBasePath(req) !== "/staff" && req.path.startsWith("/admin")) {
    return res.redirect(req.path.replace(/^\/admin/, "/staff"));
  }
  if (req.panelType === "staff" && account.role !== "staff") {
    req.session.flash = { type: "error", message: "Questa area e riservata allo staff." };
    return res.redirect("/admin/dashboard");
  }
  if (req.panelType !== "staff" && account.role === "staff" && req.path === "/admin/login") {
    return res.redirect("/staff/dashboard");
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  const account = res.locals.currentAdmin;
  if (!req.session.adminId || !account) {
    req.session.flash = { type: "error", message: "Accesso richiesto." };
    return res.redirect(currentLoginPath(req));
  }
  if (account.role !== "admin") {
    req.session.flash = { type: "error", message: "Funzione riservata all admin principale." };
    return res.redirect(currentPanelBasePath(req) === "/staff" ? "/staff/dashboard" : "/admin/dashboard");
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const account = res.locals.currentAdmin;
    if (!req.session.adminId || !account) {
      req.session.flash = { type: "error", message: "Accesso richiesto." };
      return res.redirect(currentLoginPath(req));
    }
    if (hasPermission(account, permission)) {
      return next();
    }
    req.session.flash = { type: "error", message: "Non hai i permessi per questa sezione." };
    return res.redirect(currentPanelBasePath(req) === "/staff" ? "/staff/dashboard" : "/admin/dashboard");
  };
}

module.exports = {
  STAFF_PERMISSION_KEYS,
  DEFAULT_STAFF_PERMISSIONS,
  normalizePermissions,
  hasPermission,
  createPanelContext,
  requireAdmin,
  requireSuperAdmin,
  requirePermission
};
