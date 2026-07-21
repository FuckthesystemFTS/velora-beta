import nodemailer from "nodemailer";

import { env } from "@/lib/env";

const smtpConfigured = Boolean(env.SMTP_USER && env.SMTP_PASS);

const transporter =
  smtpConfigured
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      })
    : null;

export function isMailConfigured() {
  return smtpConfigured;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (!transporter) {
    console.warn("SMTP not configured. Mail skipped:", input.subject, input.to);
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

export async function sendWelcomeEmail(email: string, username: string) {
  await sendMail({
    to: email,
    subject: "Benvenuto su V",
    text: `Ciao ${username}, il tuo account su V per Verita e attivo.`,
    html: `<p>Ciao <strong>${username}</strong>, il tuo account su <strong>V per Verita</strong> e attivo.</p>`,
  });
}

export async function sendPasswordResetEmail(email: string, username: string, resetLink: string) {
  await sendMail({
    to: email,
    subject: "Reimposta la password di V",
    text: `Ciao ${username}, usa questo link per reimpostare la password: ${resetLink}`,
    html: `<p>Ciao <strong>${username}</strong>, usa questo link per reimpostare la password:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
  });
}
