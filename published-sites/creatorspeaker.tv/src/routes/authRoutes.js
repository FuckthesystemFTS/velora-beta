const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const db = require("../db");
const { requireGuest } = require("../middleware/auth");
const { isEmail, requiredText } = require("../utils/validators");
const { getSiteSettings, renderPublicPage } = require("../utils/viewHelpers");
const mailService = require("../services/mailService");

const router = express.Router();

function safeReturnTo(value, fallback = "/") {
  const normalized = requiredText(value);
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  return normalized;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert("password_reset_tokens", {
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    used_at: null
  });
  return token;
}

async function sendWelcomeSafely(user) {
  try {
    await mailService.sendWelcomeEmail(user);
  } catch (error) {
    console.error(`Welcome email failed for ${user.email}: ${error.message}`);
  }
}

async function sendResetSafely(user, resetUrl) {
  try {
    await mailService.sendPasswordResetEmail(user, resetUrl);
  } catch (error) {
    console.error(`Password reset email failed for ${user.email}: ${error.message}`);
  }
}

router.get("/login", requireGuest, async (req, res) => {
  const shell = await getSiteSettings();
  return renderPublicPage(res, "Accesso utenti", "login", shell);
});

router.post("/login", requireGuest, async (req, res) => {
  const email = requiredText(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    req.session.flash = { type: "error", message: "Credenziali non valide." };
    return res.redirect("/login");
  }

  req.session.userId = user.id;
  req.session.flash = { type: "success", message: "Accesso eseguito." };
  return res.redirect("/dashboard");
});

router.get("/password-dimenticata", requireGuest, async (req, res) => {
  const shell = await getSiteSettings();
  return renderPublicPage(res, "Recupero password", "forgot-password", shell);
});

router.post("/password-dimenticata", requireGuest, async (req, res) => {
  const email = requiredText(req.body.email).toLowerCase();
  if (isEmail(email)) {
    const user = await db.get("SELECT id, name, email FROM users WHERE email = ?", [email]);
    if (user) {
      const token = await createPasswordReset(user.id);
      const resetUrl = new URL(`/reset-password/${token}`, `${res.locals.siteUrl}/`).toString();
      await sendResetSafely(user, resetUrl);
    }
  }

  req.session.flash = {
    type: "success",
    message: "Se l email e registrata riceverai un link per creare una nuova password"
  };
  return res.redirect("/login");
});

router.get("/reset-password/:token", requireGuest, async (req, res) => {
  const tokenHash = hashToken(String(req.params.token || ""));
  const row = await db.get("SELECT * FROM password_reset_tokens WHERE token_hash = ?", [tokenHash]);
  const valid = row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();
  if (!valid) {
    req.session.flash = { type: "error", message: "Link di recupero scaduto o non valido" };
    return res.redirect("/password-dimenticata");
  }
  const shell = await getSiteSettings();
  return renderPublicPage(res, "Nuova password", "reset-password", {
    ...shell,
    token: req.params.token
  });
});

router.post("/reset-password/:token", requireGuest, async (req, res) => {
  const tokenHash = hashToken(String(req.params.token || ""));
  const row = await db.get("SELECT * FROM password_reset_tokens WHERE token_hash = ?", [tokenHash]);
  const valid = row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();
  if (!valid) {
    req.session.flash = { type: "error", message: "Link di recupero scaduto o non valido" };
    return res.redirect("/password-dimenticata");
  }

  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirm_password || "");
  if (password.length < 8 || password !== confirmPassword) {
    req.session.flash = { type: "error", message: "Inserisci due volte una password di almeno 8 caratteri" };
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.run("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [passwordHash, row.user_id]);
  await db.run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
  req.session.flash = { type: "success", message: "Password aggiornata. Ora puoi accedere" };
  return res.redirect("/login");
});

router.get("/register", requireGuest, async (req, res) => {
  const shell = await getSiteSettings();
  return renderPublicPage(res, "Registrazione", "register", shell);
});

router.post("/register", requireGuest, async (req, res) => {
  const name = requiredText(req.body.name);
  const email = requiredText(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirm_password || "");
  const accepted = Boolean(req.body.accept_legal);

  if (!name || !isEmail(email) || password.length < 8 || password !== confirmPassword || !accepted) {
    req.session.flash = {
      type: "error",
      message: "Controlla nome, email, password e accettazione privacy/termini."
    };
    return res.redirect("/register");
  }

  const existing = await db.get("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    req.session.flash = { type: "error", message: "Email già registrata." };
    return res.redirect("/login");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = await db.insert("users", {
    name,
    email,
    password_hash: passwordHash,
    status: "pending",
    credits: 0
  });
  await sendWelcomeSafely({ id: userId, name, email });

  req.session.userId = userId;
  req.session.flash = {
    type: "success",
    message: "Account creato. Stato iniziale pending fino ad attivazione."
  };
  return res.redirect("/dashboard");
});

router.post("/logout", async (req, res) => {
  const returnTo = safeReturnTo(req.body.return_to, "/");
  req.session.destroy(() => {
    res.redirect(returnTo);
  });
});

module.exports = router;
