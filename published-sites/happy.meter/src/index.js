const path = require("path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const expressLayouts = require("express-ejs-layouts");

const { initDatabase, getDb } = require("../db");
const { ensureSeedData } = require("../db/seed");
const { DEFAULT_LANGUAGE, resolveLanguage, translate, SUPPORTED_LANGUAGES } = require("./services/languageService");
const publicRoutes = require("./routes/publicRoutes");
const authRoutes = require("./routes/authRoutes");
const appRoutes = require("./routes/appRoutes");
const adminRoutes = require("./routes/adminRoutes");
const apiRoutes = require("./routes/apiRoutes");

function buildFlash(req) {
  const flash = req.session.flash || null;
  delete req.session.flash;
  return flash;
}

function buildLocalizedUrl(siteUrl, pathname, lang) {
  const normalizedPath = pathname === "/" ? "/" : pathname;
  return `${siteUrl}${normalizedPath}${lang && lang !== DEFAULT_LANGUAGE ? `?lang=${lang}` : ""}`;
}

function isUserBanned(user) {
  if (!user) {
    return false;
  }

  if (user.ban_status === "permanent") {
    return true;
  }

  if (user.ban_status === "temporary" && user.banned_until) {
    return new Date(user.banned_until).getTime() > Date.now();
  }

  return false;
}

async function start() {
  await initDatabase();
  await ensureSeedData(getDb());

  const app = express();
  const port = Number(process.env.PORT || 3000);
  const siteUrl = process.env.SITE_URL || process.env.APP_URL || process.env.CANONICAL_URL || "https://www.happymeter.it";

  app.set("trust proxy", 1);

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));
  app.use(expressLayouts);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "change-me-in-production",
      proxy: true,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 14
      }
    })
  );
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300
    })
  );
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use(async (req, res, next) => {
    try {
      const db = getDb();
      const user = req.session.userId
        ? await db.get("SELECT * FROM users WHERE id = ?", [req.session.userId])
        : null;
      const admin = req.session.adminId
        ? await db.get("SELECT id, username FROM admin_users WHERE id = ?", [req.session.adminId])
        : null;
      const lang = resolveLanguage(req, user);

      if (user && !isUserBanned(user) && user.ban_status && user.ban_status !== "active") {
        await db.update(
          "users",
          {
            ban_status: "active",
            ban_reason: null,
            banned_until: null,
            banned_at: null,
            banned_by_admin_id: null,
            updated_at: new Date().toISOString()
          },
          "id = ?",
          [user.id]
        );
        user.ban_status = "active";
        user.ban_reason = null;
        user.banned_until = null;
      }

      if (user && isUserBanned(user) && !req.path.startsWith("/admin")) {
        req.session.userId = null;
        req.session.redirectTo = "/";
        req.session.flash = {
          type: "error",
          text:
            lang === "de"
              ? "Dein Konto ist derzeit gesperrt"
              : lang === "en"
                ? "Your account is currently suspended"
                : "Il tuo account e attualmente sospeso"
        };
        return res.redirect("/login");
      }

      res.locals.siteName = process.env.SITE_NAME || "HappyMeter";
      res.locals.user = user;
      res.locals.admin = admin;
      res.locals.lang = lang;
      res.locals.languages = SUPPORTED_LANGUAGES;
      res.locals.flash = buildFlash(req);
      res.locals.path = req.path;
      res.locals.t = (key) => translate(lang, key);
      res.locals.copy = (it, en, de) => {
        if (lang === "de") {
          return de || en || it;
        }
        if (lang === "en") {
          return en || it;
        }
        return it;
      };
      res.locals.isEnglish = lang === "en";
      res.locals.siteUrl = siteUrl;
      res.locals.privacyEmail = process.env.PRIVACY_EMAIL || "info@happymeter.it";
      res.locals.canonicalUrl = buildLocalizedUrl(siteUrl, req.path, lang);
      res.locals.localizedUrls = Object.fromEntries(
        SUPPORTED_LANGUAGES.map((item) => [item, buildLocalizedUrl(siteUrl, req.path, item)])
      );
      res.locals.seo = {
        title: "",
        description:
          lang === "de"
            ? "HappyMeter, auch als Happy Meter gesucht, hilft dir, taegliches Wohlbefinden, positive Gewohnheiten und deinen persoenlichen Happy Score zu beobachten"
            : lang === "en"
              ? "HappyMeter, also searched as Happy Meter, helps you track daily wellbeing, positive habits and your personal Happy Score"
              : "HappyMeter, anche cercato come Happy Meter, e il Feliciometro digitale che ti aiuta a osservare benessere quotidiano, abitudini positive e Happy Score personale",
        robots: "index,follow",
        image: `${siteUrl}/images/logo-happy.png`,
        type: "website"
      };

      if (
        req.path.startsWith("/app") ||
        req.path.startsWith("/admin") ||
        req.path.startsWith("/api") ||
        req.path.startsWith("/reset-password") ||
        ["/login", "/register", "/forgot-password", "/health", "/splash", "/welcome", "/welcome/2", "/daily-test"].includes(req.path)
      ) {
        res.locals.seo.robots = "noindex,nofollow";
      }

      res.locals.seoImage = res.locals.seo.image;

      next();
    } catch (error) {
      next(error);
    }
  });

  app.use(publicRoutes);
  app.use(authRoutes);
  app.use(appRoutes);
  app.use(adminRoutes);
  app.use(apiRoutes);

  app.use((req, res) => {
    res.status(404).render("404", {
      layout: "layout-public",
      pageTitle: "Pagina non trovata"
    });
  });

  app.use((error, req, res, next) => {
    console.error("[HappyMeter Error]", error.message, error.stack);
    const status = error.status || 500;
    if (res.headersSent) {
      return next(error);
    }

    return res.status(status).render("500", {
      layout: req.path.startsWith("/app") ? "layout-app" : "layout-public",
      pageTitle: "Errore",
      status
    });
  });

  app.listen(port, () => {
    console.log(`HappyMeter listening on http://localhost:${port}`);
  });
}

module.exports = {
  start
};
