const nodemailer = require("nodemailer");

const db = require("../db");
const { requiredText } = require("../utils/validators");

function readEnv(name) {
  return requiredText(process.env[name]);
}

async function getMailConfig() {
  const operations = (await db.getSetting("operations", {})) || {};
  const host = readEnv("SMTP_HOST") || requiredText(operations.smtpHost);
  const port = Number(readEnv("SMTP_PORT") || operations.smtpPort || 587);
  const user = readEnv("SMTP_USER") || requiredText(operations.smtpUser);
  const pass = readEnv("SMTP_PASS");
  const from = readEnv("SMTP_FROM") || requiredText(operations.smtpFrom) || user;
  const secureValue = readEnv("SMTP_SECURE");
  const secure =
    secureValue ? ["true", "1", "yes"].includes(secureValue.toLowerCase()) : Boolean(operations.smtpSecure);

  return {
    host,
    port,
    user,
    pass,
    from,
    secure,
    configured: Boolean(host && port && user && pass && from)
  };
}

async function getStatus() {
  const config = await getMailConfig();
  const missing = [];
  if (!config.host) missing.push("SMTP_HOST");
  if (!config.port) missing.push("SMTP_PORT");
  if (!config.user) missing.push("SMTP_USER");
  if (!config.pass) missing.push("SMTP_PASS");
  if (!config.from) missing.push("SMTP_FROM");
  return {
    configured: config.configured,
    missing,
    from: config.from,
    user: config.user,
    host: config.host,
    message: config.configured
      ? `SMTP pronto con mittente ${config.from}`
      : `SMTP incompleto: ${missing.join(", ")}`
  };
}

async function createTransport() {
  const config = await getMailConfig();
  if (!config.configured) {
    const error = new Error("SMTP non configurato");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

async function sendMail({ to, subject, text, html }) {
  const config = await getMailConfig();
  const transport = await createTransport();
  try {
    const result = await transport.sendMail({
      from: config.from,
      to,
      subject,
      text,
      html
    });
    await db.insert("notifications_log", {
      type: "email_sent",
      target: to,
      subject,
      body: text || subject,
      status: "sent"
    });
    return result;
  } catch (error) {
    console.error(`SMTP send failed to ${to}: ${error.message}`);
    await db.insert("notifications_log", {
      type: "email_failed",
      target: to,
      subject,
      body: error.message,
      status: "failed"
    });
    throw error;
  }
}

async function sendWelcomeEmail(user) {
  const name = requiredText(user.name) || "Creator";
  return sendMail({
    to: user.email,
    subject: "Benvenuto su CreatorSpeaker TV",
    text: `Ciao ${name}, il tuo account CreatorSpeaker TV e stato creato. Ora puoi accedere all area riservata e seguire contenuti, richieste e attivazioni.`,
    html: `<p>Ciao ${name},</p><p>il tuo account CreatorSpeaker TV e stato creato</p><p>Ora puoi accedere all area riservata e seguire contenuti, richieste e attivazioni</p>`
  });
}

async function sendPasswordResetEmail(user, resetUrl) {
  return sendMail({
    to: user.email,
    subject: "Recupero password CreatorSpeaker TV",
    text: `Hai richiesto il recupero password. Apri questo link entro 60 minuti: ${resetUrl}`,
    html: `<p>Hai richiesto il recupero password</p><p><a href="${resetUrl}">Crea una nuova password</a></p><p>Il link scade tra 60 minuti</p>`
  });
}

async function testConnection() {
  try {
    const transport = await createTransport();
    await transport.verify();
    return { ok: true, message: "SMTP connesso correttamente" };
  } catch (error) {
    return {
      ok: false,
      message: error.code === "SMTP_NOT_CONFIGURED" ? "SMTP non configurato" : `Test SMTP non riuscito: ${error.message}`
    };
  }
}

module.exports = {
  getMailConfig,
  getStatus,
  sendMail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  testConnection
};
