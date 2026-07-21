const nodemailer = require("nodemailer");

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getFromAddress() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || "info@happymeter.it";
}

function getSiteUrl() {
  return process.env.SITE_URL || process.env.APP_URL || process.env.CANONICAL_URL || "https://www.happymeter.it";
}

function createTransporter() {
  if (!isMailConfigured()) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendMail(message) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[HappyMeter Mail] SMTP non configurato, email non inviata");
    return { skipped: true };
  }

  try {
    return await transporter.sendMail({
      from: `"HappyMeter" <${getFromAddress()}>`,
      replyTo: process.env.MAIL_REPLY_TO || getFromAddress(),
      ...message
    });
  } catch (error) {
    console.error("[HappyMeter Mail]", error.message);
    return { failed: true, error: error.message };
  }
}

function buildBaseMail(title, bodyHtml, action) {
  const actionHtml = action
    ? `<p style="margin:28px 0"><a href="${action.url}" style="background:#ffb22e;color:#063b45;padding:14px 20px;border-radius:14px;text-decoration:none;font-weight:800;display:inline-block">${action.label}</a></p>`
    : "";

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f3fff8;color:#063b45;font-family:Arial,sans-serif">
      <div style="max-width:620px;margin:0 auto;padding:32px 20px">
        <div style="background:#ffffff;border-radius:24px;padding:28px;border:1px solid rgba(6,59,69,.12)">
          <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">${title}</h1>
          ${bodyHtml}
          ${actionHtml}
          <p style="margin:24px 0 0;color:#5c7378;font-size:13px;line-height:1.5">HappyMeter non e uno strumento medico e non formula diagnosi. Ti aiuta a osservare meglio abitudini, emozioni e benessere quotidiano.</p>
        </div>
      </div>
    </body>
  </html>`;
}

async function sendWelcomeEmail(user, lang = "it") {
  const subject =
    lang === "de"
      ? "Willkommen bei HappyMeter"
      : lang === "en"
        ? "Welcome to HappyMeter"
        : "Benvenuto su HappyMeter";
  const siteUrl = getSiteUrl();
  const body =
    lang === "de"
      ? `<p>Hallo ${user.name}, dein HappyMeter Bereich ist bereit.</p><p>Du kannst jetzt deinen Tagestest ausfuellen, dein Tagebuch nutzen und deine persoenlichen Einblicke wachsen lassen.</p>`
      : lang === "en"
        ? `<p>Hi ${user.name}, your HappyMeter space is ready.</p><p>You can now complete your daily test, use your diary and let your personal insights grow over time.</p>`
        : `<p>Ciao ${user.name}, il tuo spazio HappyMeter e pronto.</p><p>Da ora puoi compilare il test quotidiano, usare il diario e far crescere i tuoi insight personali giorno dopo giorno.</p>`;

  return sendMail({
    to: user.email,
    subject,
    text:
      lang === "de"
        ? `Hallo ${user.name}, dein HappyMeter Bereich ist bereit. ${siteUrl}/app`
        : lang === "en"
          ? `Hi ${user.name}, your HappyMeter space is ready. ${siteUrl}/app`
          : `Ciao ${user.name}, il tuo spazio HappyMeter e pronto. ${siteUrl}/app`,
    html: buildBaseMail(subject, body, {
      label: lang === "de" ? "Deinen Bereich oeffnen" : lang === "en" ? "Open your area" : "Apri la tua area",
      url: `${siteUrl}/app`
    })
  });
}

async function sendPasswordResetEmail(user, resetUrl, lang = "it") {
  const subject =
    lang === "de"
      ? "HappyMeter Passwort zuruecksetzen"
      : lang === "en"
        ? "Reset your HappyMeter password"
        : "Reimposta la password di HappyMeter";
  const body =
    lang === "de"
      ? `<p>Abbiamo ricevuto una richiesta per reimpostare la password del tuo account HappyMeter.</p><p>Il link resta valido per 60 minuti. Se non hai richiesto tu questa modifica, puoi ignorare questa email.</p>`
      : lang === "en"
        ? `<p>We received a request to reset your HappyMeter account password.</p><p>The link is valid for 60 minutes. If you did not request this change, you can ignore this email.</p>`
        : `<p>Abbiamo ricevuto una richiesta per reimpostare la password del tuo account HappyMeter.</p><p>Il link resta valido per 60 minuti. Se non hai richiesto tu questa modifica, puoi ignorare questa email.</p>`;

  return sendMail({
    to: user.email,
    subject,
    text: `${subject}\n\n${resetUrl}\n\nIl link resta valido per 60 minuti.`,
    html: buildBaseMail(subject, body, {
      label: lang === "en" ? "Reset password" : lang === "de" ? "Passwort zuruecksetzen" : "Reimposta password",
      url: resetUrl
    })
  });
}

module.exports = {
  getFromAddress,
  getSiteUrl,
  isMailConfigured,
  sendMail,
  sendPasswordResetEmail,
  sendWelcomeEmail
};
