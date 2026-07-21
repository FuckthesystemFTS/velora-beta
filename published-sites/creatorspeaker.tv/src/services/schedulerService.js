const cron = require("node-cron");

const db = require("../db");
const amazonService = require("./amazonService");
const telegramService = require("./telegramService");
const facebookService = require("./facebookService");
const subscriptionService = require("./subscriptionService");

const state = {
  started: false,
  lastCycleAt: null,
  task: null
};

function minutesSince(dateString) {
  if (!dateString) {
    return Number.POSITIVE_INFINITY;
  }
  return (Date.now() - new Date(dateString).getTime()) / 60000;
}

function sameDay(dateString) {
  if (!dateString) {
    return false;
  }
  const date = new Date(dateString);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function timeMatches(targetTime) {
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return current === targetTime;
}

async function publishBestOfferToTelegram() {
  const settings = (await db.getSetting("offer_settings", {})) || {};
  const offer = await db.get(
    "SELECT * FROM offers WHERE score >= ? AND status IN ('approved', 'discovered') ORDER BY score DESC, created_at DESC LIMIT 1",
    [Number(settings.minScore || 55)]
  );
  if (!offer) {
    return { ok: true, message: "Nessuna offerta disponibile per Telegram" };
  }

  const result = await telegramService.publishOffer(offer);
  if (result.ok) {
    await db.run(
      "UPDATE offers SET status = 'published_telegram', published_telegram_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [offer.id]
    );
  }
  return result;
}

async function runOfferSearchNow() {
  const result = await amazonService.syncOffers();
  const settings = (await db.getSetting("offer_settings", {})) || {};
  settings.lastSearchAt = new Date().toISOString();
  await db.setSetting("offer_settings", settings);
  return result;
}

async function runDailyOfferNow() {
  const fbConfig = await facebookService.getConfig();
  const best = await db.get("SELECT * FROM offers ORDER BY score DESC, created_at DESC LIMIT 1");
  if (!best) {
    return { ok: true, message: "Nessuna offerta disponibile." };
  }

  const fbResult = await facebookService.publishOffer(best, "🔥 SUPER OFFERTA DEL GIORNO 🔥");
  if (fbResult.ok) {
    await db.run(
      "UPDATE offers SET status = 'published_facebook', published_facebook_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [best.id]
    );
  }

  const teaser = {
    ...best,
    title: "L'offerta del giorno e online. Scoprila sulla nostra pagina Facebook.",
    affiliate_url: fbConfig.pageUrl || "#",
    image_url: ""
  };
  await telegramService.publishOffer(teaser);

  const settings = (await db.getSetting("offer_settings", {})) || {};
  settings.lastDailyOfferAt = new Date().toISOString();
  settings.lastFacebookOfferAt = new Date().toISOString();
  await db.setSetting("offer_settings", settings);
  return fbResult;
}

async function runCycle() {
  state.lastCycleAt = new Date().toISOString();
  await subscriptionService.expireAssignments();
  if (String(process.env.RUN_AUTOMATIONS || "true") !== "true") {
    return;
  }

  const settings = (await db.getSetting("offer_settings", {})) || {};
  const telegram = (await db.getSetting("telegram", {})) || {};
  const facebook = (await db.getSetting("facebook", {})) || {};
  if (settings.schedulerEnabled !== false && minutesSince(settings.lastSearchAt) >= Number(settings.searchFrequencyMinutes || 60)) {
    await runOfferSearchNow();
  }

  if (minutesSince(settings.lastTelegramAt) >= Number(telegram.frequencyMinutes || settings.telegramFrequencyMinutes || 120)) {
    const result = await publishBestOfferToTelegram();
    if (result.ok) {
      settings.lastTelegramAt = new Date().toISOString();
      await db.setSetting("offer_settings", settings);
    }
  }

  if (!sameDay(settings.lastDailyOfferAt) && timeMatches(facebook.postTime1 || "07:00")) {
    await runDailyOfferNow();
  }

  if (
    timeMatches(facebook.postTime2 || "19:00") &&
    minutesSince(settings.lastFacebookOfferAt) >= Number(facebook.minHoursDistance || 12) * 60
  ) {
    const secondary = await db.get(
      "SELECT * FROM offers WHERE status IN ('approved', 'published_telegram') ORDER BY score DESC, created_at DESC LIMIT 1 OFFSET 1"
    );
    if (secondary) {
      const result = await facebookService.publishOffer(secondary, "📣 OFFERTA EXTRA DELLA GIORNATA");
      if (result.ok) {
        settings.lastFacebookOfferAt = new Date().toISOString();
        await db.setSetting("offer_settings", settings);
      }
    }
  }
}

async function start() {
  if (state.started) {
    return state;
  }
  await subscriptionService.expireAssignments();
  state.task = cron.schedule("*/30 * * * *", () => {
    runCycle().catch((error) => {
      console.error("Scheduler cycle failed:", error.message);
    });
  });
  state.started = true;
  return state;
}

async function getStatus() {
  const offerSettings = (await db.getSetting("offer_settings", {})) || {};
  return {
    started: state.started,
    lastCycleAt: state.lastCycleAt,
    nextSearchApprox: offerSettings.lastSearchAt
      ? new Date(
          new Date(offerSettings.lastSearchAt).getTime() +
            Number(offerSettings.searchFrequencyMinutes || 60) * 60000
        ).toISOString()
      : "alla prossima finestra scheduler",
    frequencyMinutes: Number(offerSettings.searchFrequencyMinutes || 60)
  };
}

module.exports = {
  start,
  getStatus,
  runOfferSearchNow,
  runDailyOfferNow,
  publishBestOfferToTelegram
};
