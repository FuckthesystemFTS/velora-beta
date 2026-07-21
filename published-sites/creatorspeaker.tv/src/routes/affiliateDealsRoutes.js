const express = require("express");

const { requirePermission } = require("../middleware/adminOnly");
const { renderAdminPage } = require("../utils/viewHelpers");
const { requiredText, toBool } = require("../utils/validators");
const affiliateDeals = require("../services/affiliateDealsService");
const amazonCreatorsApi = require("../services/amazonCreatorsApiService");

const router = express.Router();

function panelPath(req, path) {
  return typeof req.panelBasePath === "string" && req.panelBasePath === "/staff" && path.startsWith("/admin/")
    ? `/staff${path.slice("/admin".length)}`
    : path;
}

function requireAffiliate(permission) {
  return requirePermission(permission);
}

async function pageData(section, req, extra = {}) {
  const [dashboard, settingsMap] = await Promise.all([
    affiliateDeals.dashboard(),
    affiliateDeals.getSettingsMap()
  ]);

  const data = {
    ...dashboard,
    settingsMap,
    section,
    tabs: [
      ["overview", "Panoramica", "/admin/affiliate-deals", "affiliate_deals.view"],
      ["telegram", "Bot Telegram", "/admin/affiliate-deals/telegram", "affiliate_deals.telegram_manage"],
      ["offers", "Contenuti", "/admin/affiliate-deals/offers", "affiliate_deals.view"],
      ["queue", "Coda", "/admin/affiliate-deals/queue", "affiliate_deals.publish"],
      ["settings", "Impostazioni", "/admin/affiliate-deals/settings", "affiliate_deals.settings_manage"],
      ["logs", "Log", "/admin/affiliate-deals/logs", "affiliate_deals.logs_view"]
    ],
    offers: [],
    approvedOffers: [],
    queue: [],
    publications: [],
    categoriesList: [],
    templates: [],
    latestSpecial: dashboard.latestSpecial,
    recentRuns: [],
    logs: [],
    amazonTest: null,
    telegramTest: null,
    facebookTest: null,
    ...extra
  };

  if (["offers", "approved"].includes(section)) {
    data.offers = await affiliateDeals.listOffers({ status: section === "approved" ? "approved" : null });
  }
  if (section === "telegram") {
    const [telegramOffers, telegramQueue] = await Promise.all([
      affiliateDeals.listOffers(),
      affiliateDeals.listPublicationJobs()
    ]);
    data.telegramOffers = telegramOffers
      .filter((item) => ["candidate", "approved", "detected"].includes(item.status))
      .slice(0, 8);
    data.telegramQueue = telegramQueue
      .filter((item) => item.channel_type === "telegram")
      .slice(0, 6);
  }
  if (["queue", "publications"].includes(section)) {
    data.queue = await affiliateDeals.listPublicationJobs({ status: section === "queue" ? null : "published" });
    data.publications = data.queue;
  }
  if (section === "daily-special") {
    data.latestSpecial = dashboard.latestSpecial;
    data.offers = await affiliateDeals.listOffers({ status: "approved" });
  }
  if (section === "categories") {
    data.categoriesList = await affiliateDeals.listCategories();
  }
  if (section === "templates") {
    data.templates = await affiliateDeals.listTemplates();
    data.categoriesList = await affiliateDeals.listCategories();
  }
  if (section === "schedule") {
    data.recentRuns = await affiliateDeals.listRecentRuns();
  }
  if (section === "logs") {
    data.logs = await affiliateDeals.listAuditLogs();
    data.recentRuns = await affiliateDeals.listRecentRuns();
  }
  return data;
}

async function renderSection(req, res, section, title, extra = {}) {
  return renderAdminPage(res, title, "admin-affiliate-deals", await pageData(section, req, extra));
}

router.get("/admin/affiliate-deals", requireAffiliate("affiliate_deals.view"), async (req, res) =>
  renderSection(req, res, "overview", "Offerte Affiliate")
);

router.get("/admin/affiliate-deals/offers", requireAffiliate("affiliate_deals.view"), async (req, res) =>
  renderSection(req, res, "offers", "Offerte trovate")
);

router.get("/admin/affiliate-deals/approved", requireAffiliate("affiliate_deals.approve"), async (req, res) =>
  renderSection(req, res, "approved", "Offerte approvate")
);

router.get("/admin/affiliate-deals/queue", requireAffiliate("affiliate_deals.publish"), async (req, res) =>
  renderSection(req, res, "queue", "Coda pubblicazioni")
);

router.get("/admin/affiliate-deals/publications", requireAffiliate("affiliate_deals.publish"), async (req, res) =>
  renderSection(req, res, "publications", "Archivio pubblicazioni")
);

router.get("/admin/affiliate-deals/daily-special", requireAffiliate("affiliate_deals.publish"), async (req, res) =>
  renderSection(req, res, "daily-special", "Offerta del giorno")
);

router.get("/admin/affiliate-deals/categories", requireAffiliate("affiliate_deals.categories_manage"), async (req, res) =>
  renderSection(req, res, "categories", "Categorie affiliate")
);

router.get("/admin/affiliate-deals/templates", requireAffiliate("affiliate_deals.templates_manage"), async (req, res) =>
  renderSection(req, res, "templates", "Template post")
);

router.get("/admin/affiliate-deals/telegram", requireAffiliate("affiliate_deals.telegram_manage"), async (req, res) =>
  renderSection(req, res, "telegram", "Telegram affiliate")
);

router.get("/admin/affiliate-deals/facebook", requireAffiliate("affiliate_deals.facebook_manage"), async (req, res) =>
  renderSection(req, res, "facebook", "Facebook affiliate")
);

router.get("/admin/affiliate-deals/amazon", requireAffiliate("affiliate_deals.amazon_manage"), async (req, res) =>
  renderSection(req, res, "amazon", "Amazon affiliate")
);

router.get("/admin/affiliate-deals/schedule", requireAffiliate("affiliate_deals.scheduler_manage"), async (req, res) =>
  renderSection(req, res, "schedule", "Programmazione affiliate")
);

router.get("/admin/affiliate-deals/stats", requireAffiliate("affiliate_deals.view"), async (req, res) =>
  renderSection(req, res, "stats", "Statistiche affiliate")
);

router.get("/admin/affiliate-deals/settings", requireAffiliate("affiliate_deals.settings_manage"), async (req, res) =>
  renderSection(req, res, "settings", "Configurazione affiliate")
);

router.get("/admin/affiliate-deals/logs", requireAffiliate("affiliate_deals.logs_view"), async (req, res) =>
  renderSection(req, res, "logs", "Log affiliate")
);

router.get("/admin/affiliate-deals/offers/:id", requireAffiliate("affiliate_deals.view"), async (req, res) => {
  const offerId = Number(req.params.id);
  const [telegramPreview, facebookPreview] = await Promise.all([
    affiliateDeals.buildOfferPreview(offerId, "telegram", "standard_offer"),
    affiliateDeals.buildOfferPreview(offerId, "facebook", "facebook_second_offer")
  ]);
  return renderSection(req, res, "offer-detail", "Anteprima offerta", {
    detailOfferId: offerId,
    telegramPreview,
    facebookPreview
  });
});

router.post("/admin/affiliate-deals/search-now", requireAffiliate("affiliate_deals.search"), async (req, res) => {
  const settings = await affiliateDeals.getSettingsMap();
  const sourceMode = requiredText(settings.affiliate_source_mode || "facebook_page");
  const jobType = sourceMode === "facebook_page" ? "facebook_page_import" : "amazon_search";
  await affiliateDeals.enqueueBackgroundJob(jobType, {}, new Date().toISOString(), `affiliate:manual-search:${sourceMode}:${Date.now()}`);
  req.session.flash = {
    type: "success",
    message: sourceMode === "facebook_page" ? "Import contenuti Facebook inserito in coda" : "Ricerca Amazon inserita in coda"
  };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/offers"));
});

router.post("/admin/affiliate-deals/telegram/quick-save", requireAffiliate("affiliate_deals.telegram_manage"), async (req, res) => {
  const mappings = [
    ["affiliate_source_mode", "facebook_page", "text", "automation"],
    ["affiliate_facebook_source_enabled", req.body.affiliate_facebook_source_enabled ? "true" : "false", "boolean", "automation"],
    ["affiliate_amazon_search_enabled", "false", "boolean", "automation"],
    ["affiliate_automation_enabled", req.body.affiliate_automation_enabled ? "true" : "false", "boolean", "automation"],
    ["affiliate_telegram_enabled", req.body.affiliate_telegram_enabled ? "true" : "false", "boolean", "telegram"],
    ["affiliate_telegram_interval_minutes", req.body.affiliate_telegram_interval_minutes || "60", "number", "telegram"],
    ["affiliate_telegram_max_posts_per_day", req.body.affiliate_telegram_max_posts_per_day || "16", "number", "telegram"],
    ["affiliate_telegram_active_start_time", req.body.affiliate_telegram_active_start_time || "07:00", "text", "telegram"],
    ["affiliate_telegram_active_end_time", req.body.affiliate_telegram_active_end_time || "23:00", "text", "telegram"]
  ];
  for (const [key, value, type, groupName] of mappings) {
    await affiliateDeals.setSetting(key, value, type, groupName, req.session.adminId);
  }
  req.session.flash = { type: "success", message: "Bot Telegram aggiornato" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/telegram"));
});

router.post("/admin/affiliate-deals/telegram/import-now", requireAffiliate("affiliate_deals.search"), async (req, res) => {
  try {
    const result = await affiliateDeals.importFacebookPagePosts(req.session.adminId, { limit: 12 });
    req.session.flash = {
      type: "success",
      message: `Import completato: ${result.itemsScanned} post letti, ${result.offersFound} contenuti pronti`
    };
  } catch (error) {
    req.session.flash = { type: "error", message: `Import Facebook non riuscito: ${error.message}` };
  }
  return res.redirect(panelPath(req, "/admin/affiliate-deals/telegram"));
});

router.post("/admin/affiliate-deals/telegram/publish-next", requireAffiliate("affiliate_deals.publish"), async (req, res) => {
  try {
    const result = await affiliateDeals.queueBestTelegramOffer(req.session.adminId, {
      manualOverride: true,
      publishNow: true
    });
    req.session.flash = result
      ? { type: "success", message: "Post pubblicato su Telegram" }
      : { type: "error", message: "Nessun contenuto disponibile da pubblicare" };
  } catch (error) {
    req.session.flash = { type: "error", message: `Pubblicazione Telegram non riuscita: ${error.message}` };
  }
  return res.redirect(panelPath(req, "/admin/affiliate-deals/telegram"));
});

router.post("/admin/affiliate-deals/offers/:id/approve", requireAffiliate("affiliate_deals.approve"), async (req, res) => {
  await affiliateDeals.approveOffer(Number(req.params.id), req.session.adminId);
  req.session.flash = { type: "success", message: "Offerta approvata" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/offers"));
});

router.post("/admin/affiliate-deals/offers/:id/reject", requireAffiliate("affiliate_deals.approve"), async (req, res) => {
  await affiliateDeals.rejectOffer(Number(req.params.id), req.body.reason, req.session.adminId);
  req.session.flash = { type: "success", message: "Offerta rifiutata" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/offers"));
});

router.post("/admin/affiliate-deals/offers/:id/publish-telegram", requireAffiliate("affiliate_deals.publish"), async (req, res) => {
  await affiliateDeals.queuePublication({
    offerId: Number(req.params.id),
    channelType: "telegram",
    postType: "standard_offer",
    scheduledAt: new Date().toISOString(),
    textOverride: requiredText(req.body.text_override),
    userId: req.session.adminId,
    manualOverride: toBool(req.body.manual_override)
  });
  req.session.flash = { type: "success", message: "Pubblicazione Telegram messa in coda" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/queue"));
});

router.post("/admin/affiliate-deals/offers/:id/publish-telegram-now", requireAffiliate("affiliate_deals.publish"), async (req, res) => {
  try {
    await affiliateDeals.publishOfferToTelegramNow(Number(req.params.id), req.session.adminId);
    req.session.flash = { type: "success", message: "Post pubblicato subito su Telegram" };
  } catch (error) {
    req.session.flash = { type: "error", message: `Invio Telegram non riuscito: ${error.message}` };
  }
  return res.redirect(panelPath(req, "/admin/affiliate-deals/telegram"));
});

router.post("/admin/affiliate-deals/offers/:id/publish-facebook", requireAffiliate("affiliate_deals.publish"), async (req, res) => {
  await affiliateDeals.queuePublication({
    offerId: Number(req.params.id),
    channelType: "facebook",
    postType: "facebook_second_offer",
    scheduledAt: new Date().toISOString(),
    textOverride: requiredText(req.body.text_override),
    userId: req.session.adminId,
    manualOverride: toBool(req.body.manual_override)
  });
  req.session.flash = { type: "success", message: "Pubblicazione Facebook messa in coda" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/queue"));
});

router.post("/admin/affiliate-deals/daily-special/select", requireAffiliate("affiliate_deals.publish"), async (req, res) => {
  const special = await affiliateDeals.selectDailySpecial(req.session.adminId);
  if (special) {
    await affiliateDeals.queuePublication({
      offerId: special.offer_id,
      dailySpecialId: special.id,
      channelType: "facebook",
      postType: "daily_special",
      scheduledAt: new Date().toISOString(),
      userId: req.session.adminId,
      manualOverride: true
    });
    req.session.flash = { type: "success", message: "Offerta del giorno selezionata e messa in coda" };
  } else {
    req.session.flash = { type: "error", message: "Nessuna offerta valida per l offerta del giorno" };
  }
  return res.redirect(panelPath(req, "/admin/affiliate-deals/daily-special"));
});

router.post("/admin/affiliate-deals/categories", requireAffiliate("affiliate_deals.categories_manage"), async (req, res) => {
  await affiliateDeals.upsertCategory(req.body, req.session.adminId);
  req.session.flash = { type: "success", message: "Categoria salvata" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/categories"));
});

router.post("/admin/affiliate-deals/templates", requireAffiliate("affiliate_deals.templates_manage"), async (req, res) => {
  await affiliateDeals.upsertTemplate(req.body, req.session.adminId);
  req.session.flash = { type: "success", message: "Template salvato" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/templates"));
});

router.post("/admin/affiliate-deals/settings", requireAffiliate("affiliate_deals.settings_manage"), async (req, res) => {
  const mappings = [
    ["affiliate_mode", req.body.affiliate_mode, "text", "amazon"],
    ["affiliate_source_mode", req.body.affiliate_source_mode, "text", "automation"],
    ["affiliate_search_interval_minutes", req.body.affiliate_search_interval_minutes, "number", "automation"],
    ["affiliate_telegram_interval_minutes", req.body.affiliate_telegram_interval_minutes, "number", "telegram"],
    ["affiliate_telegram_max_posts_per_day", req.body.affiliate_telegram_max_posts_per_day, "number", "telegram"],
    ["affiliate_telegram_active_start_time", req.body.affiliate_telegram_active_start_time, "text", "telegram"],
    ["affiliate_telegram_active_end_time", req.body.affiliate_telegram_active_end_time, "text", "telegram"],
    ["affiliate_facebook_post_1_time", req.body.affiliate_facebook_post_1_time, "text", "facebook"],
    ["affiliate_facebook_post_2_time", req.body.affiliate_facebook_post_2_time, "text", "facebook"],
    ["affiliate_daily_special_selection_time", req.body.affiliate_daily_special_selection_time, "text", "facebook"],
    ["affiliate_min_discount_percent", req.body.affiliate_min_discount_percent, "number", "filters"],
    ["affiliate_min_deal_score", req.body.affiliate_min_deal_score, "number", "filters"],
    ["affiliate_min_rating", req.body.affiliate_min_rating, "number", "filters"],
    ["affiliate_min_review_count", req.body.affiliate_min_review_count, "number", "filters"],
    ["affiliate_automation_enabled", req.body.affiliate_automation_enabled ? "true" : "false", "boolean", "automation"],
    ["affiliate_amazon_search_enabled", req.body.affiliate_amazon_search_enabled ? "true" : "false", "boolean", "automation"],
    ["affiliate_facebook_source_enabled", req.body.affiliate_facebook_source_enabled ? "true" : "false", "boolean", "automation"],
    ["affiliate_telegram_enabled", req.body.affiliate_telegram_enabled ? "true" : "false", "boolean", "telegram"],
    ["affiliate_facebook_enabled", req.body.affiliate_facebook_enabled ? "true" : "false", "boolean", "facebook"],
    ["affiliate_daily_special_enabled", req.body.affiliate_daily_special_enabled ? "true" : "false", "boolean", "facebook"],
    ["affiliate_allow_facebook_text_fallback", req.body.affiliate_allow_facebook_text_fallback ? "true" : "false", "boolean", "facebook"],
    ["affiliate_disclosure_text", req.body.affiliate_disclosure_text, "text", "copy"],
    ["affiliate_price_disclaimer", req.body.affiliate_price_disclaimer, "text", "copy"]
  ];
  for (const [key, value, type, groupName] of mappings) {
    await affiliateDeals.setSetting(key, value, type, groupName, req.session.adminId);
  }
  req.session.flash = { type: "success", message: "Configurazione affiliate aggiornata" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/settings"));
});

router.post("/admin/affiliate-deals/schedule/run", requireAffiliate("affiliate_deals.scheduler_manage"), async (req, res) => {
  await affiliateDeals.runSchedulerTick(req.session.adminId);
  req.session.flash = { type: "success", message: "Scheduler eseguito" };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/schedule"));
});

router.post("/admin/affiliate-deals/telegram/test", requireAffiliate("affiliate_deals.telegram_manage"), async (req, res) => {
  const result = await affiliateDeals.verifyTelegramConnection(toBool(req.body.send_test));
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/telegram"));
});

router.post("/admin/affiliate-deals/facebook/test", requireAffiliate("affiliate_deals.facebook_manage"), async (req, res) => {
  const result = await affiliateDeals.verifyFacebookConnection(toBool(req.body.send_test));
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/facebook"));
});

router.post("/admin/affiliate-deals/amazon/test", requireAffiliate("affiliate_deals.amazon_manage"), async (req, res) => {
  const result = await amazonCreatorsApi.testConnection();
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect(panelPath(req, "/admin/affiliate-deals/amazon"));
});

module.exports = router;
