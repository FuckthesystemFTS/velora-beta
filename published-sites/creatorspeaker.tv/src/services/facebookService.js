const db = require("../db");
const { DISCLOSURE } = require("./amazonService");
const { createNotification } = require("./orderService");

async function getConfig() {
  const stored = (await db.getSetting("facebook", {})) || {};
  return {
    enabled: String(stored.enabled || false) === "true",
    pageUrl: process.env.FACEBOOK_PAGE_URL || stored.pageUrl || "",
    pageId: process.env.FACEBOOK_PAGE_ID || stored.pageId || "",
    accessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || stored.accessToken || "",
    postTime1: stored.postTime1 || "07:00",
    postTime2: stored.postTime2 || "19:00",
    minHoursDistance: Number(stored.minHoursDistance || 12)
  };
}

function buildMessage(offer, headline = "🔥 SUPER OFFERTA DEL GIORNO 🔥") {
  return [
    headline,
    "",
    offer.title,
    "",
    offer.normal_price_cents
      ? `Prezzo precedente: ${Number(offer.normal_price_cents / 100).toFixed(2).replace(".", ",")} €`
      : null,
    `Prezzo offerta: ${Number(offer.current_price_cents / 100).toFixed(2).replace(".", ",")} €`,
    offer.discount_percent ? `Sconto: -${offer.discount_percent}%` : null,
    "",
    `👉 Link offerta: ${offer.affiliate_url}`,
    "",
    "Link affiliato: potremmo ricevere una commissione sugli acquisti idonei.",
    DISCLOSURE
  ]
    .filter(Boolean)
    .join("\n");
}

async function publishOffer(offer, headline) {
  const config = await getConfig();
  const message = buildMessage(offer, headline);
  if (!config.enabled || !config.pageId || !config.accessToken) {
    await createNotification("facebook", "facebook", `Post non inviato: ${offer.title}`, message, "skipped");
    return {
      ok: false,
      skipped: true,
      message: "Facebook non configurato"
    };
  }

  const body = new URLSearchParams({
    message,
    access_token: config.accessToken
  });

  const response = await fetch(`https://graph.facebook.com/v20.0/${config.pageId}/feed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const error = await response.text();
    await createNotification("facebook", "facebook", `Errore Facebook: ${offer.title}`, error, "failed");
    return {
      ok: false,
      message: "Invio Facebook fallito"
    };
  }

  await createNotification("facebook", "facebook", `Pubblicata offerta ${offer.title}`, message, "sent");
  return {
    ok: true,
    message: "Offerta pubblicata su Facebook"
  };
}

async function sendTest() {
  return publishOffer(
    {
      title: "Offerta test CreatorSpeaker TV",
      current_price_cents: 2999,
      normal_price_cents: 4999,
      discount_percent: 40,
      affiliate_url: "https://www.amazon.it/?tag=test-creatorspeaker-21"
    },
    "🔥 TEST POST FACEBOOK 🔥"
  );
}

module.exports = {
  getConfig,
  buildMessage,
  publishOffer,
  sendTest
};
