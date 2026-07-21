const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { getDb } = require("../../db");
const guestOnly = require("../middleware/guestOnly");
const { normalizeLanguage } = require("../services/languageService");
const { getSiteUrl, sendPasswordResetEmail, sendWelcomeEmail } = require("../services/mailService");
const { normalizeText, validateRegistration } = require("../utils/validators");

const router = express.Router();

function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

function copy(lang, it, en, de) {
  if (lang === "de") {
    return de || en || it;
  }
  if (lang === "en") {
    return en || it;
  }
  return it;
}

function buildSeo(lang, titleIt, titleEn, titleDe, descriptionIt, descriptionEn, descriptionDe) {
  return {
    title: copy(lang, titleIt, titleEn, titleDe),
    description: copy(lang, descriptionIt, descriptionEn, descriptionDe),
    robots: "noindex,nofollow"
  };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveRedirectTarget(req) {
  const candidate = req.query.redirect || req.body.redirect || req.session.redirectTo || "/app";
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/app";
  }
  return candidate;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildAuthRenderData(res, view, values = {}, errors = []) {
  const lang = res.locals.lang;
  const isLogin = view === "login";
  return {
    layout: "layout-public",
    pageTitle: isLogin ? copy(lang, "Accedi", "Log in", "Anmelden") : copy(lang, "Registrati", "Sign up", "Registrieren"),
    seo: buildSeo(
      lang,
      isLogin ? "HappyMeter | Accedi" : "HappyMeter | Registrati",
      isLogin ? "HappyMeter | Log in" : "HappyMeter | Sign up",
      isLogin ? "HappyMeter | Anmelden" : "HappyMeter | Registrieren",
      isLogin
        ? "Accedi a HappyMeter per continuare con il tuo diario e il test quotidiano"
        : "Crea il tuo account HappyMeter per salvare test, diario e progressi",
      isLogin
        ? "Log in to HappyMeter to continue with your journal and daily test"
        : "Create your HappyMeter account to save tests, journal entries and progress",
      isLogin
        ? "Melde dich bei HappyMeter an, um mit deinem Tagebuch und dem taeglichen Test fortzufahren"
        : "Erstelle dein HappyMeter Konto, um Tests, Tagebuch und Fortschritte zu speichern"
    ),
    errors,
    values
  };
}

async function createPasswordReset(db, user) {
  await db.run("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", [
    new Date().toISOString(),
    user.id
  ]);

  const token = crypto.randomBytes(32).toString("hex");
  await db.insert("password_reset_tokens", {
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  return token;
}

router.get("/register", guestOnly, (req, res) => {
  res.render(
    "register",
    buildAuthRenderData(res, "register", {
      preferred_language: req.session.language || "it",
      redirect: req.query.redirect || req.session.redirectTo || ""
    })
  );
});

router.post("/register", guestOnly, async (req, res) => {
  const db = getDb();
  const errors = validateRegistration(req.body);

  if (errors.length) {
    return res.status(422).render("register", buildAuthRenderData(res, "register", req.body, errors));
  }

  const existing = await db.get("SELECT id FROM users WHERE email = ?", [
    normalizeText(req.body.email).toLowerCase()
  ]);

  if (existing) {
    return res.status(422).render(
      "register",
      buildAuthRenderData(res, "register", req.body, [
        copy(res.locals.lang, "C e gia un account con questa email", "An account with this email already exists", "Mit dieser E Mail gibt es bereits ein Konto")
      ])
    );
  }

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  const user = await db.insert("users", {
    name: normalizeText(req.body.name),
    email: normalizeText(req.body.email).toLowerCase(),
    password_hash: passwordHash,
    preferred_language: normalizeLanguage(req.body.preferred_language),
    points: 0,
    level: 1,
    current_streak: 0,
    happy_gesture_streak: 0,
    premium_status: "coming-soon",
    updated_at: new Date().toISOString()
  });

  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.language = normalizeLanguage(req.body.preferred_language);
  await sendWelcomeEmail(user, req.session.language);
  const redirectTo = resolveRedirectTarget(req);
  delete req.session.redirectTo;
  setFlash(
    req,
    "success",
    copy(
      res.locals.lang,
      "Account creato, il tuo Feliciometro e pronto",
      "Account created, your HappyMeter is ready",
      "Konto erstellt, dein HappyMeter ist bereit"
    )
  );
  return res.redirect(redirectTo);
});

router.get("/login", guestOnly, (req, res) => {
  if (req.query.redirect && String(req.query.redirect).startsWith("/")) {
    req.session.redirectTo = req.query.redirect;
  }

  res.render(
    "login",
    buildAuthRenderData(res, "login", {
      redirect: req.query.redirect || req.session.redirectTo || ""
    })
  );
});

router.post("/login", guestOnly, async (req, res) => {
  const db = getDb();
  const email = normalizeText(req.body.email).toLowerCase();
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

  if (!user || !(await bcrypt.compare(req.body.password || "", user.password_hash))) {
    return res.status(401).render(
      "login",
      buildAuthRenderData(res, "login", req.body, [
        copy(res.locals.lang, "Email o password non corretti", "Incorrect email or password", "E Mail oder Passwort sind nicht korrekt")
      ])
    );
  }

  if (user.ban_status === "permanent" || (user.ban_status === "temporary" && user.banned_until && new Date(user.banned_until).getTime() > Date.now())) {
    return res.status(403).render(
      "login",
      buildAuthRenderData(res, "login", { email, redirect: req.body.redirect || "" }, [
        copy(
          res.locals.lang,
          "Questo account e sospeso. Contatta il supporto se pensi sia un errore",
          "This account is suspended. Contact support if you think this is a mistake",
          "Dieses Konto ist gesperrt. Kontaktiere den Support, wenn du glaubst, dass das ein Fehler ist"
        )
      ])
    );
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.language = user.preferred_language;
  const redirectTo = resolveRedirectTarget(req);
  delete req.session.redirectTo;
  setFlash(
    req,
    "success",
    copy(
      res.locals.lang,
      "Bentornato, riprendiamo da qui",
      "Welcome back, let's pick up from here",
      "Willkommen zurueck, wir machen hier weiter"
    )
  );
  return res.redirect(redirectTo);
});

router.get("/forgot-password", guestOnly, (req, res) => {
  res.render("forgot-password", {
    layout: "layout-public",
    pageTitle: copy(res.locals.lang, "Recupera password", "Reset password", "Passwort zuruecksetzen"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Recupera password",
      "HappyMeter | Reset password",
      "HappyMeter | Passwort zuruecksetzen",
      "Richiedi un link sicuro per reimpostare la password HappyMeter",
      "Request a secure link to reset your HappyMeter password",
      "Fordere einen sicheren Link an, um dein HappyMeter Passwort zurueckzusetzen"
    ),
    errors: [],
    values: {}
  });
});

router.post("/forgot-password", guestOnly, async (req, res) => {
  const db = getDb();
  const email = normalizeText(req.body.email).toLowerCase();
  const user = await db.get("SELECT id, name, email, preferred_language FROM users WHERE email = ?", [email]);

  if (user) {
    const token = await createPasswordReset(db, user);
    const resetUrl = `${getSiteUrl()}/reset-password/${token}`;
    await sendPasswordResetEmail(user, resetUrl, user.preferred_language || res.locals.lang);
  }

  setFlash(
    req,
    "success",
    copy(
      res.locals.lang,
      "Se l email e registrata, riceverai un link per reimpostare la password",
      "If the email is registered, you will receive a password reset link",
      "Wenn die E Mail registriert ist, erhaeltst du einen Link zum Zuruecksetzen des Passworts"
    )
  );
  return res.redirect("/login");
});

router.get("/reset-password/:token", guestOnly, async (req, res) => {
  const db = getDb();
  const tokenHash = hashToken(req.params.token || "");
  const record = await db.get(
    `SELECT prt.*, u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = ?`,
    [tokenHash]
  );
  const valid = record && !record.used_at && new Date(record.expires_at).getTime() > Date.now();

  res.render("reset-password", {
    layout: "layout-public",
    pageTitle: copy(res.locals.lang, "Nuova password", "New password", "Neues Passwort"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Nuova password",
      "HappyMeter | New password",
      "HappyMeter | Neues Passwort",
      "Scegli una nuova password per il tuo account HappyMeter",
      "Choose a new password for your HappyMeter account",
      "Waehle ein neues Passwort fuer dein HappyMeter Konto"
    ),
    token: req.params.token,
    valid,
    errors: []
  });
});

router.post("/reset-password/:token", guestOnly, async (req, res) => {
  const db = getDb();
  const tokenHash = hashToken(req.params.token || "");
  const record = await db.get("SELECT * FROM password_reset_tokens WHERE token_hash = ?", [tokenHash]);
  const valid = record && !record.used_at && new Date(record.expires_at).getTime() > Date.now();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (!valid || password.length < 8 || password !== confirmPassword) {
    return res.status(422).render("reset-password", {
      layout: "layout-public",
      pageTitle: copy(res.locals.lang, "Nuova password", "New password", "Neues Passwort"),
      seo: buildSeo(
        res.locals.lang,
        "HappyMeter | Nuova password",
        "HappyMeter | New password",
        "HappyMeter | Neues Passwort",
        "Scegli una nuova password per il tuo account HappyMeter",
        "Choose a new password for your HappyMeter account",
        "Waehle ein neues Passwort fuer dein HappyMeter Konto"
      ),
      token: req.params.token,
      valid,
      errors: [
        !valid
          ? copy(res.locals.lang, "Il link non e valido o e scaduto", "The link is invalid or expired", "Der Link ist ungueltig oder abgelaufen")
          : copy(res.locals.lang, "Le password devono coincidere e avere almeno 8 caratteri", "Passwords must match and be at least 8 characters long", "Die Passwoerter muessen uebereinstimmen und mindestens 8 Zeichen lang sein")
      ]
    });
  }

  await db.update(
    "users",
    {
      password_hash: await bcrypt.hash(password, 10),
      updated_at: new Date().toISOString()
    },
    "id = ?",
    [record.user_id]
  );
  await db.update("password_reset_tokens", { used_at: new Date().toISOString() }, "id = ?", [record.id]);

  setFlash(
    req,
    "success",
    copy(res.locals.lang, "Password aggiornata, ora puoi accedere", "Password updated, you can now log in", "Passwort aktualisiert, du kannst dich jetzt anmelden")
  );
  return res.redirect("/login");
});

router.post("/logout", async (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

module.exports = router;
