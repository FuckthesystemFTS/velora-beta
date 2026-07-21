const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const PgSession = require("connect-pg-simple")(session);

const db = require("./db");
const { attachUser } = require("./middleware/auth");
const { authLimiter, adminLimiter } = require("./middleware/rateLimit");
const { createPanelContext } = require("./middleware/adminOnly");
const publicRoutes = require("./routes/publicRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const adminCmsRoutes = require("./routes/adminCmsRoutes");
const outreachRoutes = require("./routes/outreachRoutes");
const affiliateDealsRoutes = require("./routes/affiliateDealsRoutes");
const apiRoutes = require("./routes/apiRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const { ensureCsrfToken, verifyCsrf, sanitizeRequest } = require("./middleware/formSecurity");
const schedulerService = require("./services/schedulerService");
const videoService = require("./services/videoService");
const { analyticsMiddleware } = require("./services/analyticsService");
const { formatMoney } = require("./utils/money");

function buildSessionStore() {
  if (db.meta.driver !== "pg") {
    return undefined;
  }

  return new PgSession({
    pool: db.meta.pool,
    tableName: "session",
    createTableIfMissing: true
  });
}

function createApp() {
  const app = express();
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  const canonicalHost = (process.env.CANONICAL_HOST || "").toLowerCase();
  const rootDomain = (process.env.ROOT_DOMAIN || "").toLowerCase();
  const fallbackSiteUrl = canonicalHost ? `https://${canonicalHost}` : "";

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "..", "views"));
  app.locals.appVersion = "1.0.0";
  app.locals.formatMoney = formatMoney;

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(express.json({ limit: "10mb" }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "change-me",
      resave: false,
      saveUninitialized: false,
      store: buildSessionStore(),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7
      }
    })
  );

  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production" || !canonicalHost) {
      return next();
    }

    const host = String(req.headers.host || "")
      .split(":")[0]
      .toLowerCase();
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    const shouldRedirect =
      host &&
      !isLocalHost &&
      host !== canonicalHost &&
      (host === rootDomain || host.endsWith(".herokuapp.com"));

    if (!shouldRedirect || !["GET", "HEAD"].includes(req.method)) {
      return next();
    }

    return res.redirect(301, `https://${canonicalHost}${req.originalUrl || "/"}`);
  });

  app.use(async (req, res, next) => {
    const requestHost = String(req.headers.host || "")
      .split(":")[0]
      .toLowerCase();
    const siteUrl = process.env.SITE_URL || fallbackSiteUrl || `${req.protocol}://${requestHost || "localhost"}`;
    const operations = (await db.getSetting("operations", {})) || {};

    res.locals.siteUrl = siteUrl.replace(/\/$/, "");
    res.locals.canonicalUrl = new URL(req.originalUrl || "/", `${res.locals.siteUrl}/`).toString();
    res.locals.contactEmails = {
      info:
        operations.officialInfoEmail ||
        process.env.CONTACT_EMAIL_INFO ||
        "info@creatorspeakertv.it",
      service:
        operations.officialServiceEmail ||
        process.env.CONTACT_EMAIL_SERVICE ||
        "service@creatorspeakertv.it",
      network:
        operations.officialNetworkEmail ||
        process.env.CONTACT_EMAIL_NETWORK ||
        "netwrok@creatorspeakertv.it"
    };
    next();
  });

  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.panelType = "admin";
    res.locals.panelBasePath = "/admin";
    res.locals.panelPath = (path = "") => path;
    res.locals.canPanelPermission = () => false;
    res.locals.session = req.session;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
  });
  app.use(ensureCsrfToken);
  app.use(sanitizeRequest);
  app.use(verifyCsrf);
  app.use(attachUser);
  app.use(analyticsMiddleware);

  app.use((req, res, next) => {
    const isStaffPanelRequest =
      req.path === "/staff/dashboard" ||
      (req.path.startsWith("/staff/") && !req.path.startsWith("/staff/login"));
    if (!isStaffPanelRequest) {
      return next();
    }

    return createPanelContext("staff")(req, res, () => {
      req.url = req.url.replace(/^\/staff(\/|$)/, "/admin$1");
      next();
    });
  });

  app.use("/public", express.static(path.join(__dirname, "..", "public")));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use("/", publicRoutes);
  app.use("/", authLimiter, authRoutes);
  app.use("/", userRoutes);
  app.use("/", subscriptionRoutes);
  app.use("/", adminLimiter, affiliateDealsRoutes);
  app.use("/", adminLimiter, outreachRoutes);
  app.use("/", adminLimiter, adminCmsRoutes);
  app.use("/", adminLimiter, adminRoutes);
  app.use("/", apiRoutes);

  app.use((req, res) => {
    res.status(404).render("layout-public", {
      title: "Pagina non trovata",
      bodyTemplate: "404",
      page: {},
      data: {}
    });
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      return res.status(400).json({
        ok: false,
        error: "invalid_json",
        message: "JSON non valido"
      });
    }

    console.error(error.message);
    if (req.path.startsWith("/api/")) {
      return res.status(500).json({
        ok: false,
        error: "server_error",
        message: "Errore temporaneo del server"
      });
    }

    res.status(500).render("layout-public", {
      title: "Errore server",
      bodyTemplate: "404",
      page: {},
      data: {
        message: "Errore temporaneo del server"
      }
    });
  });

  return app;
}

async function startServer() {
  await db.initialize();
  await schedulerService.start();
  videoService.resumeProcessingJobs().catch((error) => {
    console.error("Video job resume startup failed:", error.message);
  });

  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`creatorspeaker-tv listening on ${port}`);
  });
}

module.exports = {
  createApp,
  startServer
};
