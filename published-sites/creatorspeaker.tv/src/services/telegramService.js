const db = require("../db");
const { DISCLOSURE } = require("./amazonService");
const { createNotification } = require("./orderService");

async function getConfig() {
  const stored = (await db.getSetting("telegram", {})) || {};
  return {
    enabled: String(stored.enabled || false) === "true",
    botToken: process.env.TELEGRAM_BOT_TOKEN || stored.botToken || "",
    channelId: process.env.TELEGRAM_CHANNEL_ID || stored.channelId || "",
    channelLogo: stored.channelLogo || "/assets/brand/creatorspeaker-brand-emblem.jpg",
    frequencyMinutes: Number(stored.frequencyMinutes || 120),
    dailyLimit: Number(stored.dailyLimit || 4),
    messageFormat: stored.messageFormat || "standard"
  };
}

function buildMessage(offer) {
  return [
    `📱 ${offer.title}`,
    "",
    `💰 Prezzo: ${Number(offer.current_price_cents / 100).toFixed(2).replace(".", ",")} €`,
    offer.normal_price_cents
      ? `❌ Prezzo precedente: ${Number(offer.normal_price_cents / 100).toFixed(2).replace(".", ",")} €`
      : null,
    offer.discount_percent ? `🔥 Sconto: -${offer.discount_percent}%` : null,
    "",
    offer.prime_available ? "✅ Spedizione Prime" : "Disponibilita standard",
    "",
    `👉 Link Offerta: ${offer.affiliate_url}`,
    "",
    DISCLOSURE
  ]
    .filter(Boolean)
    .join("\n");
}

async function publishOffer(offer) {
  const config = await getConfig();
  const message = buildMessage(offer);

  if (!config.enabled || !config.botToken || !config.channelId) {
    await createNotification("telegram", "telegram", `Post non inviato: ${offer.title}`, message, "skipped");
    return {
      ok: false,
      skipped: true,
      message: "Telegram non configurato"
    };
  }

  const endpoint = offer.image_url
    ? `https://api.telegram.org/bot${config.botToken}/sendPhoto`
    : `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  const body = offer.image_url
    ? {
        chat_id: config.channelId,
        photo: offer.image_url,
        caption: message
      }
    : {
        chat_id: config.channelId,
        text: message
      };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    await createNotification("telegram", "telegram", `Errore Telegram: ${offer.title}`, error, "failed");
    return {
      ok: false,
      message: "Invio Telegram fallito"
    };
  }

  await createNotification("telegram", "telegram", `Pubblicata offerta ${offer.title}`, message, "sent");
  return {
    ok: true,
    message: "Offerta pubblicata su Telegram"
  };
}

async function sendTest() {
  return publishOffer({
    title: "Offerta test CreatorSpeaker TV",
    current_price_cents: 2999,
    normal_price_cents: 4999,
    discount_percent: 40,
    prime_available: true,
    affiliate_url: "https://www.amazon.it/?tag=test-creatorspeaker-21",
    image_url: ""
  });
}

module.exports = {
  getConfig,
  buildMessage,
  publishOffer,
  sendTest
};
