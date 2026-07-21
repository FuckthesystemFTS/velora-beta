const crypto = require("crypto");

const db = require("../db");
const amazonCreatorsApi = require("./amazonCreatorsApiService");
const { parseJson, stringifyJson } = require("../utils/safeJson");
const { slugify } = require("../utils/slug");
const { requiredText, toInt, toBool } = require("../utils/validators");

const FACEBOOK_REQUIRED_PERMISSIONS = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"];

function nowIso() {
  return new Date().toISOString();
}

function boolValue(value) {
  return db.meta.driver === "pg" ? Boolean(value) : value ? 1 : 0;
}

function parseBool(value, fallback = false) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maskSecret(value) {
  if (!value) {
    return "non configurato";
  }
  const text = String(value);
  if (text.length <= 4) {
    return "••••";
  }
  return `${"•".repeat(Math.max(8, text.length - 4))}${text.slice(-4)}`;
}

function euroFromCents(cents) {
  if (!Number.isFinite(Number(cents))) {
    return "";
  }
  return `EUR ${(Number(cents) / 100).toFixed(2).replace(".", ",")}`;
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function sanitizeText(value, limit = 4000) {
  return requiredText(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?[^>]+>/g, "")
    .slice(0, limit);
}

function renderTemplate(template, variables) {
  let output = String(template || "");
  output = output.replace(/\{\{#if ([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
    variables[key] ? content : ""
  );
  output = output.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => requiredText(variables[key]));
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, rows) => !(line === "" && rows[index - 1] === ""))
    .join("\n")
    .trim();
}

function isSafeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function isAmazonUrl(value) {
  if (!isSafeUrl(value)) {
    return false;
  }
  return /(^|\.)amazon\./i.test(new URL(value).hostname);
}

function extractUrlsFromText(value) {
  const matches = String(value || "").match(/https?:\/\/[^\s<>"']+/gi) || [];
  return matches.map((item) => item.replace(/[),.;!?]+$/g, ""));
}

function parseEuroCents(value) {
  if (!value) {
    return 0;
  }
  const normalized = String(value)
    .replace(/[^\d,.\s]/g, "")
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

function parseFacebookPostDetails(message) {
  const text = requiredText(message);
  const titleLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const urls = extractUrlsFromText(text);
  const currentMatch =
    text.match(/(?:prezzo(?: offerta)?|ora a|a)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{2})?)\s*€/i) ||
    text.match(/([0-9]+(?:[.,][0-9]{2})?)\s*€/i);
  const previousMatch =
    text.match(/(?:prezzo precedente|prima|invece che a)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{2})?)\s*€/i) ||
    text.match(/([0-9]+(?:[.,][0-9]{2})?)\s*€\s*(?:anziche|invece)/i);
  const discountMatch = text.match(/(?:sconto[^0-9-]*-?|-\s*)(\d{1,2})\s*%/i);
  const currentPrice = parseEuroCents(currentMatch && currentMatch[1]);
  const previousPrice = parseEuroCents(previousMatch && previousMatch[1]);
  const discountPercent = discountMatch
    ? Number(discountMatch[1])
    : currentPrice > 0 && previousPrice > currentPrice
      ? Math.round(((previousPrice - currentPrice) / previousPrice) * 100)
      : 0;
  return {
    title: requiredText(titleLine).slice(0, 180) || "Contenuto Facebook",
    currentPrice,
    previousPrice,
    discountPercent,
    linkCandidates: urls
  };
}

async function audit(userId, action, entityType, entityId, details = {}) {
  await db.insert("affiliate_audit_logs", {
    user_id: userId || null,
    action,
    entity_type: entityType || "",
    entity_id: entityId || null,
    details_json: stringifyJson(details, "{}")
  });
}

async function getSettingsRows() {
  return db.all("SELECT * FROM affiliate_settings ORDER BY group_name ASC, key ASC");
}

async function getSettingsMap() {
  const rows = await getSettingsRows();
  return rows.reduce((acc, row) => {
    if (row.type === "boolean") {
      acc[row.key] = parseBool(row.value);
    } else if (row.type === "number") {
      acc[row.key] = parseNumber(row.value);
    } else {
      acc[row.key] = row.value;
    }
    return acc;
  }, {});
}

async function setSetting(key, value, type, groupName, userId) {
  const existing = await db.get("SELECT id FROM affiliate_settings WHERE key = ?", [key]);
  const payload = {
    value: String(value),
    type,
    group_name: groupName,
    updated_by_user_id: userId || null,
    updated_at: nowIso()
  };
  if (existing) {
    await db.run(
      "UPDATE affiliate_settings SET value = ?, type = ?, group_name = ?, updated_by_user_id = ?, updated_at = ? WHERE key = ?",
      [payload.value, payload.type, payload.group_name, payload.updated_by_user_id, payload.updated_at, key]
    );
  } else {
    await db.insert("affiliate_settings", { key, ...payload });
  }
}

async function moduleConfig() {
  const settings = await getSettingsMap();
  const amazon = await amazonCreatorsApi.getConfig();
  return {
    settings,
    amazon,
    automationEnabled: settings.affiliate_automation_enabled === true,
    sourceMode: requiredText(settings.affiliate_source_mode || "facebook_page"),
    facebookSourceEnabled: settings.affiliate_facebook_source_enabled !== false,
    timezone: requiredText(process.env.AFFILIATE_TIMEZONE || settings.affiliate_timezone || "Europe/Rome"),
    telegramEnabled: settings.affiliate_telegram_enabled === true,
    facebookEnabled: settings.affiliate_facebook_enabled === true,
    dailySpecialEnabled: settings.affiliate_daily_special_enabled === true,
    disclosureText:
      requiredText(process.env.AFFILIATE_DISCLOSURE_TEXT) ||
      requiredText(settings.affiliate_disclosure_text) ||
      "In qualita di affiliato Amazon, CreatorSpeaker TV puo ricevere una commissione dagli acquisti idonei",
    priceDisclaimer:
      requiredText(process.env.AFFILIATE_PRICE_DISCLAIMER) ||
      requiredText(settings.affiliate_price_disclaimer) ||
      "Prezzo e disponibilita possono cambiare dopo la pubblicazione",
    secretsMasked: {
      amazonCredentialId: maskSecret(amazon.credentialId),
      amazonCredentialSecret: maskSecret(amazon.credentialSecret),
      amazonAssociateTag: maskSecret(amazon.associateTag),
      telegramBotToken: maskSecret(process.env.TELEGRAM_BOT_TOKEN),
      facebookPageToken: maskSecret(process.env.META_PAGE_ACCESS_TOKEN)
    }
  };
}

async function listCategories() {
  const rows = await db.all("SELECT * FROM affiliate_categories ORDER BY sort_order ASC, priority DESC, id ASC");
  return rows.map((row) => ({
    ...row,
    amazon_keywords: parseJson(row.amazon_keywords_json, []),
    telegram_enabled: Boolean(row.telegram_enabled),
    facebook_enabled: Boolean(row.facebook_enabled),
    daily_special_enabled: Boolean(row.daily_special_enabled)
  }));
}

async function upsertCategory(body, userId) {
  const name = requiredText(body.name);
  if (!name) {
    throw new Error("Nome categoria obbligatorio");
  }
  const id = body.id ? Number(body.id) : null;
  const payload = {
    name,
    slug: requiredText(body.slug) || slugify(name),
    description: sanitizeText(body.description, 300),
    emoji: requiredText(body.emoji),
    amazon_keywords_json: stringifyJson(
      String(body.amazon_keywords || "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
    amazon_category_reference: sanitizeText(body.amazon_category_reference, 120),
    status: toBool(body.active) ? "active" : "inactive",
    priority: clamp(toInt(body.priority, 50), 0, 100),
    minimum_discount_percent: clamp(toInt(body.minimum_discount_percent, 20), 0, 95),
    minimum_deal_score: clamp(toInt(body.minimum_deal_score, 65), 0, 100),
    max_results_per_search: clamp(toInt(body.max_results_per_search, 20), 1, 100),
    search_frequency_minutes: clamp(toInt(body.search_frequency_minutes, 60), 30, 240),
    telegram_enabled: boolValue(toBool(body.telegram_enabled)),
    facebook_enabled: boolValue(toBool(body.facebook_enabled)),
    daily_special_enabled: boolValue(toBool(body.daily_special_enabled)),
    sort_order: clamp(toInt(body.sort_order, 0), 0, 999),
    created_by_user_id: userId || null
  };

  if (id) {
    await db.run(
      `UPDATE affiliate_categories
       SET name = ?, slug = ?, description = ?, emoji = ?, amazon_keywords_json = ?, amazon_category_reference = ?,
           status = ?, priority = ?, minimum_discount_percent = ?, minimum_deal_score = ?, max_results_per_search = ?,
           search_frequency_minutes = ?, telegram_enabled = ?, facebook_enabled = ?, daily_special_enabled = ?,
           sort_order = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.name,
        payload.slug,
        payload.description,
        payload.emoji,
        payload.amazon_keywords_json,
        payload.amazon_category_reference,
        payload.status,
        payload.priority,
        payload.minimum_discount_percent,
        payload.minimum_deal_score,
        payload.max_results_per_search,
        payload.search_frequency_minutes,
        payload.telegram_enabled,
        payload.facebook_enabled,
        payload.daily_special_enabled,
        payload.sort_order,
        id
      ]
    );
    await audit(userId, "affiliate.category.updated", "affiliate_category", id, { slug: payload.slug });
    return id;
  }

  const createdId = await db.insert("affiliate_categories", payload);
  await audit(userId, "affiliate.category.created", "affiliate_category", createdId, { slug: payload.slug });
  return createdId;
}

async function listTemplates() {
  return db.all(
    `SELECT affiliate_post_templates.*, affiliate_categories.name AS category_name
     FROM affiliate_post_templates
     LEFT JOIN affiliate_categories ON affiliate_categories.id = affiliate_post_templates.category_id
     WHERE affiliate_post_templates.status != 'archived'
     ORDER BY affiliate_post_templates.channel_type ASC, affiliate_post_templates.post_type ASC, affiliate_post_templates.created_at DESC`
  );
}

async function upsertTemplate(body, userId) {
  const payload = {
    name: requiredText(body.name),
    channel_type: requiredText(body.channel_type),
    post_type: requiredText(body.post_type),
    category_id: body.category_id ? Number(body.category_id) : null,
    text_template: sanitizeText(body.text_template, 5000),
    button_label: sanitizeText(body.button_label, 80),
    include_product_image: boolValue(toBool(body.include_product_image)),
    include_channel_logo: boolValue(toBool(body.include_channel_logo)),
    include_price_disclaimer: boolValue(toBool(body.include_price_disclaimer)),
    include_affiliate_disclosure: boolValue(toBool(body.include_affiliate_disclosure)),
    status: requiredText(body.status || "active"),
    is_default: boolValue(toBool(body.is_default)),
    created_by_user_id: userId || null
  };

  if (!payload.name || !payload.channel_type || !payload.post_type || !payload.text_template) {
    throw new Error("Compila nome, canale, tipo e template");
  }

  if (body.id) {
    await db.run(
      `UPDATE affiliate_post_templates
       SET name = ?, channel_type = ?, post_type = ?, category_id = ?, text_template = ?, button_label = ?,
           include_product_image = ?, include_channel_logo = ?, include_price_disclaimer = ?,
           include_affiliate_disclosure = ?, status = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.name,
        payload.channel_type,
        payload.post_type,
        payload.category_id,
        payload.text_template,
        payload.button_label,
        payload.include_product_image,
        payload.include_channel_logo,
        payload.include_price_disclaimer,
        payload.include_affiliate_disclosure,
        payload.status,
        payload.is_default,
        Number(body.id)
      ]
    );
    await audit(userId, "affiliate.template.updated", "affiliate_post_template", Number(body.id), {
      postType: payload.post_type
    });
    return Number(body.id);
  }

  const id = await db.insert("affiliate_post_templates", payload);
  await audit(userId, "affiliate.template.created", "affiliate_post_template", id, { postType: payload.post_type });
  return id;
}

async function getHistorySummary(productId, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await db.all(
    "SELECT current_price FROM affiliate_price_observations WHERE product_id = ? AND observed_at >= ? ORDER BY observed_at ASC",
    [productId, since]
  );
  if (!rows.length) {
    return null;
  }
  const prices = rows.map((row) => Number(row.current_price || 0)).filter((value) => value > 0);
  if (!prices.length) {
    return null;
  }
  const total = prices.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...prices),
    avg: Math.round(total / prices.length),
    count: prices.length
  };
}

async function getInternalHistory(productId) {
  const [history7, history30, history90, latest] = await Promise.all([
    getHistorySummary(productId, 7),
    getHistorySummary(productId, 30),
    getHistorySummary(productId, 90),
    db.get(
      "SELECT current_price, observed_at FROM affiliate_price_observations WHERE product_id = ? ORDER BY observed_at DESC LIMIT 2",
      [productId]
    )
  ]);

  const rows = await db.all(
    "SELECT current_price, observed_at FROM affiliate_price_observations WHERE product_id = ? ORDER BY observed_at DESC LIMIT 2",
    [productId]
  );
  const lastChange = rows.length >= 2 ? Number(rows[0].current_price || 0) - Number(rows[1].current_price || 0) : 0;
  return {
    history7,
    history30,
    history90,
    observationsCount: history90 ? history90.count : 0,
    latestObservedAt: latest ? latest.observed_at : null,
    lastChange
  };
}

function computeScores({ currentPrice, referencePrice, discountPercent, primeEligible, rating, reviewCount, category, history }) {
  const discountScore =
    discountPercent >= 40 ? 40 :
    discountPercent >= 30 ? 32 :
    discountPercent >= 20 ? 24 :
    discountPercent >= 10 ? 10 : 0;

  let priceHistoryScore = 0;
  if (history.history30 && currentPrice > 0) {
    if (currentPrice <= history.history30.min) {
      priceHistoryScore = 25;
    } else if (currentPrice <= history.history30.avg * 0.92) {
      priceHistoryScore = 18;
    } else if (currentPrice <= history.history30.avg) {
      priceHistoryScore = 10;
    }
  }

  let popularityScore = 0;
  if (rating && reviewCount) {
    popularityScore += clamp((Number(rating) - 3.5) * 6, 0, 8);
    popularityScore += clamp(Math.log10(Number(reviewCount) + 1) * 4, 0, 7);
  }
  popularityScore = clamp(popularityScore, 0, 15);

  const primeScore = primeEligible ? 5 : 0;
  const categoryPriorityScore = clamp((Number(category.priority || 0) / 100) * 10, 0, 10);
  const freshnessScore = history.observationsCount <= 1 ? 5 : history.lastChange < 0 ? 3 : 1;
  const categoryScore = clamp(categoryPriorityScore + freshnessScore, 0, 15);

  return {
    discountScore,
    priceHistoryScore,
    popularityScore,
    categoryScore,
    dealScore: clamp(discountScore + priceHistoryScore + popularityScore + primeScore + categoryScore, 0, 100)
  };
}

async function pickCategoryForContent(message) {
  const categories = (await listCategories()).filter((item) => item.status === "active");
  const haystack = requiredText(message).toLowerCase();
  let best = categories[0] || null;
  let bestScore = -1;
  for (const category of categories) {
    let score = Number(category.priority || 0) / 10;
    const name = requiredText(category.name).toLowerCase();
    if (name && haystack.includes(name)) {
      score += 12;
    }
    for (const keyword of category.amazon_keywords || []) {
      const cleaned = requiredText(keyword).toLowerCase();
      if (cleaned && haystack.includes(cleaned)) {
        score += 6;
      }
    }
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

function computeFacebookSourceScores({ category, currentPrice, previousPrice, discountPercent, hasImage, publishedAt }) {
  const freshnessHours = publishedAt ? Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3600000) : 999;
  const freshnessScore = freshnessHours <= 12 ? 18 : freshnessHours <= 48 ? 12 : freshnessHours <= 120 ? 8 : 3;
  const discountScore =
    discountPercent >= 40 ? 38 :
    discountPercent >= 30 ? 30 :
    discountPercent >= 20 ? 22 :
    discountPercent >= 10 ? 12 : 6;
  const priceSignalScore = currentPrice > 0 ? 8 : 2;
  const previousPriceScore = previousPrice > currentPrice ? 10 : 2;
  const imageScore = hasImage ? 10 : 0;
  const categoryScore = clamp((Number(category && category.priority ? category.priority : 50) / 100) * 12, 0, 12);
  return {
    discountScore,
    priceHistoryScore: 0,
    popularityScore: 0,
    categoryScore,
    dealScore: clamp(discountScore + freshnessScore + priceSignalScore + previousPriceScore + imageScore + categoryScore, 0, 100)
  };
}

function buildOfferVariables(row, config, extra = {}) {
  return {
    product_title: row.title,
    brand: row.brand || "",
    category_name: row.category_name || "",
    category_emoji: row.emoji || "🛒",
    current_price: euroFromCents(row.current_price),
    previous_price: row.previous_price ? euroFromCents(row.previous_price) : "",
    reference_price: row.reference_price ? euroFromCents(row.reference_price) : "",
    discount_percent: row.discount_percent ? String(row.discount_percent) : "",
    prime_eligible: row.prime_eligible ? "1" : "",
    rating: row.rating ? String(row.rating) : "",
    review_count: row.review_count ? String(row.review_count) : "",
    affiliate_url: row.affiliate_url || "",
    facebook_post_url: extra.facebook_post_url || "",
    affiliate_disclosure: config.disclosureText,
    price_disclaimer: config.priceDisclaimer
  };
}

function buildSourceDrivenText(row, channelType, config, extra = {}) {
  const originalText = sanitizeText(row.source_text || row.title || "", channelType === "telegram" ? 2800 : 3800);
  const parts = [originalText];
  const destinationUrl = requiredText(row.affiliate_url || row.source_post_url || extra.facebook_post_url);
  if (destinationUrl && !originalText.includes(destinationUrl)) {
    parts.push(`Link diretto: ${destinationUrl}`);
  }
  if (channelType === "telegram" && row.source_post_url && !originalText.includes(row.source_post_url)) {
    parts.push(`Post originale Facebook: ${row.source_post_url}`);
  }
  if (isAmazonUrl(row.affiliate_url)) {
    parts.push(config.disclosureText);
  }
  if (row.current_price) {
    parts.push(config.priceDisclaimer);
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

async function getTemplate(channelType, postType) {
  return (
    (await db.get(
      "SELECT * FROM affiliate_post_templates WHERE channel_type = ? AND post_type = ? AND status = 'active' ORDER BY is_default DESC, id ASC LIMIT 1",
      [channelType, postType]
    )) ||
    null
  );
}

async function upsertProduct(normalized, categoryId) {
  const existing = await db.get(
    "SELECT * FROM affiliate_products WHERE amazon_asin = ? AND marketplace = ?",
    [normalized.amazonAsin, normalized.marketplace]
  );
  if (existing) {
    await db.run(
      `UPDATE affiliate_products
       SET source_type = ?, source_text = ?, source_post_url = ?, title = ?, brand = ?, category_id = ?, product_url = ?, affiliate_url = ?, image_url = ?, detail_page_url = ?,
           currency = ?, availability = ?, prime_eligible = ?, rating = ?, review_count = ?, last_seen_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        normalized.sourceType || "amazon",
        normalized.sourceText || "",
        normalized.sourcePostUrl || "",
        normalized.title,
        normalized.brand,
        categoryId,
        normalized.productUrl,
        normalized.affiliateUrl,
        normalized.imageUrl,
        normalized.detailPageUrl,
        normalized.currency,
        normalized.availability,
        boolValue(normalized.primeEligible),
        normalized.rating,
        normalized.reviewCount,
        normalized.observedAt,
        existing.id
      ]
    );
    return existing.id;
  }

  return db.insert("affiliate_products", {
    amazon_asin: normalized.amazonAsin,
    marketplace: normalized.marketplace,
    source_type: normalized.sourceType || "amazon",
    source_text: normalized.sourceText || "",
    source_post_url: normalized.sourcePostUrl || "",
    title: normalized.title,
    brand: normalized.brand,
    category_id: categoryId,
    product_url: normalized.productUrl,
    affiliate_url: normalized.affiliateUrl,
    image_url: normalized.imageUrl,
    detail_page_url: normalized.detailPageUrl,
    currency: normalized.currency,
    availability: normalized.availability,
    prime_eligible: boolValue(normalized.primeEligible),
    rating: normalized.rating,
    review_count: normalized.reviewCount,
    last_seen_at: normalized.observedAt
  });
}

async function insertPriceObservation(productId, normalized) {
  return db.insert("affiliate_price_observations", {
    product_id: productId,
    current_price: normalized.currentPrice,
    reference_price: normalized.referencePrice,
    list_price: normalized.referencePrice,
    saving_amount:
      normalized.referencePrice && normalized.referencePrice > normalized.currentPrice
        ? normalized.referencePrice - normalized.currentPrice
        : null,
    saving_percent: normalized.discountPercent,
    currency: normalized.currency,
    availability: normalized.availability,
    source: normalized.source,
    observed_at: normalized.observedAt
  });
}

async function upsertOffer(productId, category, normalized, scores) {
  const existing = await db.get("SELECT * FROM affiliate_offers WHERE product_id = ? ORDER BY id DESC LIMIT 1", [productId]);
  const filters = await moduleConfig();
  const minDiscount = Number(category.minimum_discount_percent || filters.settings.affiliate_min_discount_percent || 20);
  const minScore = Number(category.minimum_deal_score || filters.settings.affiliate_min_deal_score || 65);
  const minRating = Number(filters.settings.affiliate_min_rating || 3.8);
  const minReviewCount = Number(filters.settings.affiliate_min_review_count || 20);

  let status = "detected";
  let rejectionReason = "";
  const isFacebookSource = normalized.sourceType === "facebook_page";
  const hasPrimaryLink = normalized.affiliateUrl ? isSafeUrl(normalized.affiliateUrl) : isSafeUrl(normalized.sourcePostUrl);
  if (
    !normalized.title ||
    (!isFacebookSource && (!normalized.imageUrl || !normalized.affiliateUrl || !isAmazonUrl(normalized.affiliateUrl))) ||
    (isFacebookSource && !hasPrimaryLink)
  ) {
    status = "rejected";
    rejectionReason = "Dati essenziali mancanti";
  } else if (!isFacebookSource && normalized.currency !== (filters.amazon.defaultCurrency || "EUR")) {
    status = "rejected";
    rejectionReason = "Valuta non attesa";
  } else if (isFacebookSource) {
    status = "candidate";
  } else if (!normalized.currentPrice || !normalized.referencePrice || normalized.referencePrice <= normalized.currentPrice) {
    status = "detected";
    rejectionReason = "Sconto non verificabile";
  } else if (!/stock|available|disponibile|in_stock/i.test(normalized.availability)) {
    status = "unavailable";
    rejectionReason = "Prodotto non disponibile";
  } else if (normalized.discountPercent < minDiscount) {
    status = "rejected";
    rejectionReason = "Sconto sotto soglia";
  } else if (scores.dealScore < minScore) {
    status = "rejected";
    rejectionReason = "Deal score sotto soglia";
  } else if (normalized.rating && normalized.rating < minRating) {
    status = "detected";
    rejectionReason = "Rating sotto soglia";
  } else if (normalized.reviewCount && normalized.reviewCount < minReviewCount) {
    status = "detected";
    rejectionReason = "Recensioni insufficienti";
  } else {
    status = "candidate";
  }

  if (existing && ["published", "queued"].includes(existing.status)) {
    status = existing.status;
    rejectionReason = existing.rejection_reason || "";
  }

  const payload = {
    product_id: productId,
    category_id: category.id,
    current_price: normalized.currentPrice,
    previous_price: existing ? existing.current_price : normalized.referencePrice,
    reference_price: normalized.referencePrice,
    discount_percent: normalized.discountPercent,
    deal_score: scores.dealScore,
    price_history_score: scores.priceHistoryScore,
    discount_score: scores.discountScore,
    popularity_score: scores.popularityScore,
    category_score: scores.categoryScore,
    prime_eligible: boolValue(normalized.primeEligible),
    status,
    rejection_reason: rejectionReason,
    first_detected_at: existing ? existing.first_detected_at : normalized.observedAt,
    last_detected_at: normalized.observedAt,
    expires_at: null
  };

  if (existing) {
    await db.run(
      `UPDATE affiliate_offers
       SET current_price = ?, previous_price = ?, reference_price = ?, discount_percent = ?, deal_score = ?,
           price_history_score = ?, discount_score = ?, popularity_score = ?, category_score = ?, prime_eligible = ?,
           status = ?, rejection_reason = ?, last_detected_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.current_price,
        payload.previous_price,
        payload.reference_price,
        payload.discount_percent,
        payload.deal_score,
        payload.price_history_score,
        payload.discount_score,
        payload.popularity_score,
        payload.category_score,
        payload.prime_eligible,
        payload.status,
        payload.rejection_reason,
        payload.last_detected_at,
        existing.id
      ]
    );
    return { id: existing.id, status, rejectionReason };
  }

  const id = await db.insert("affiliate_offers", payload);
  return { id, status, rejectionReason };
}

async function listOffers(filters = {}) {
  const where = [];
  const params = [];
  if (filters.status) {
    where.push("affiliate_offers.status = ?");
    params.push(filters.status);
  }
  const sql = `SELECT affiliate_offers.*, affiliate_products.title, affiliate_products.brand, affiliate_products.amazon_asin,
      affiliate_products.marketplace, affiliate_products.source_type, affiliate_products.source_text, affiliate_products.source_post_url,
      affiliate_products.affiliate_url, affiliate_products.image_url,
      affiliate_products.rating, affiliate_products.review_count, affiliate_products.availability,
      affiliate_categories.name AS category_name, affiliate_categories.emoji
    FROM affiliate_offers
    JOIN affiliate_products ON affiliate_products.id = affiliate_offers.product_id
    LEFT JOIN affiliate_categories ON affiliate_categories.id = affiliate_offers.category_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY affiliate_offers.deal_score DESC, affiliate_offers.updated_at DESC
    LIMIT 200`;
  return db.all(sql, params);
}

async function listPublicationJobs(filters = {}) {
  const where = [];
  const params = [];
  if (filters.status) {
    where.push("affiliate_publication_jobs.status = ?");
    params.push(filters.status);
  }
  return db.all(
    `SELECT affiliate_publication_jobs.*, affiliate_products.title, affiliate_products.amazon_asin
     FROM affiliate_publication_jobs
     LEFT JOIN affiliate_offers ON affiliate_offers.id = affiliate_publication_jobs.offer_id
     LEFT JOIN affiliate_products ON affiliate_products.id = affiliate_offers.product_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY affiliate_publication_jobs.created_at DESC LIMIT 200`,
    params
  );
}

async function listRecentRuns() {
  return db.all("SELECT * FROM affiliate_scheduler_runs ORDER BY created_at DESC LIMIT 60");
}

async function listAuditLogs() {
  return db.all("SELECT * FROM affiliate_audit_logs ORDER BY created_at DESC LIMIT 100");
}

async function dashboard() {
  const [config, categories, statsRows, nextJobs, latestSpecial] = await Promise.all([
    moduleConfig(),
    listCategories(),
    Promise.all([
      db.get("SELECT COUNT(*) AS total FROM affiliate_products"),
      db.get("SELECT COUNT(*) AS total FROM affiliate_offers WHERE status IN ('candidate','approved','queued')"),
      db.get("SELECT COUNT(*) AS total FROM affiliate_offers WHERE status = 'approved'"),
      db.get("SELECT COUNT(*) AS total FROM affiliate_publication_jobs WHERE status IN ('draft','queued','processing')"),
      db.get("SELECT COUNT(*) AS total FROM affiliate_publication_jobs WHERE status = 'published' AND channel_type = 'telegram' AND created_at >= ?", [new Date(Date.now() - 86400000).toISOString()]),
      db.get("SELECT COUNT(*) AS total FROM affiliate_publication_jobs WHERE status = 'published' AND channel_type = 'facebook' AND created_at >= ?", [new Date(Date.now() - 86400000).toISOString()]),
      db.get("SELECT COUNT(*) AS total FROM affiliate_offers WHERE created_at >= ?", [new Date(Date.now() - 86400000).toISOString()])
    ]),
    db.all("SELECT * FROM affiliate_background_jobs WHERE status IN ('queued','processing') ORDER BY run_at ASC LIMIT 8"),
    db.get(
      `SELECT affiliate_daily_specials.*, affiliate_products.title
       FROM affiliate_daily_specials
       JOIN affiliate_offers ON affiliate_offers.id = affiliate_daily_specials.offer_id
       JOIN affiliate_products ON affiliate_products.id = affiliate_offers.product_id
       ORDER BY affiliate_daily_specials.selection_date DESC LIMIT 1`
    )
  ]);
  return {
    config,
    categories,
    summary: {
      activeCategories: categories.filter((item) => item.status === "active").length,
      productsAnalyzedToday: Number(statsRows[0].total || 0),
      offersFoundToday: Number(statsRows[6].total || 0),
      offersApproved: Number(statsRows[2].total || 0),
      queueOpen: Number(statsRows[3].total || 0),
      telegramPublishedToday: Number(statsRows[4].total || 0),
      facebookPublishedToday: Number(statsRows[5].total || 0),
      trackedProducts: Number(statsRows[0].total || 0),
      candidateOffers: Number(statsRows[1].total || 0)
    },
    nextJobs,
    latestSpecial
  };
}

async function buildOfferPreview(offerId, channelType, postType, extra = {}) {
  const config = await moduleConfig();
  const row = await db.get(
    `SELECT affiliate_offers.*, affiliate_products.title, affiliate_products.brand, affiliate_products.affiliate_url,
            affiliate_products.source_type, affiliate_products.source_text, affiliate_products.source_post_url,
            affiliate_products.image_url, affiliate_products.rating, affiliate_products.review_count,
            affiliate_categories.name AS category_name, affiliate_categories.emoji
     FROM affiliate_offers
     JOIN affiliate_products ON affiliate_products.id = affiliate_offers.product_id
     LEFT JOIN affiliate_categories ON affiliate_categories.id = affiliate_offers.category_id
     WHERE affiliate_offers.id = ?`,
    [offerId]
  );
  if (!row) {
    throw new Error("Offerta non trovata");
  }
  const template = await getTemplate(channelType, postType);
  if (!template) {
    throw new Error("Template non trovato");
  }
  const variables = buildOfferVariables(row, config, extra);
  const rendered =
    row.source_type === "facebook_page"
      ? buildSourceDrivenText(row, channelType, config, extra)
      : renderTemplate(template.text_template, variables);
  return {
    template,
    row,
    renderedText: rendered,
    imageUrl: row.image_url,
    variables
  };
}

async function approveOffer(offerId, userId) {
  await db.run(
    "UPDATE affiliate_offers SET status = 'approved', approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [userId || null, offerId]
  );
  await audit(userId, "affiliate.offer.approved", "affiliate_offer", offerId, {});
}

async function rejectOffer(offerId, reason, userId) {
  await db.run(
    "UPDATE affiliate_offers SET status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [sanitizeText(reason, 180), offerId]
  );
  await audit(userId, "affiliate.offer.rejected", "affiliate_offer", offerId, { reason: sanitizeText(reason, 180) });
}

async function countPublishedForProduct(productId, channelType, hours) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM affiliate_publication_jobs
     JOIN affiliate_offers ON affiliate_offers.id = affiliate_publication_jobs.offer_id
     WHERE affiliate_offers.product_id = ? AND affiliate_publication_jobs.channel_type = ?
       AND affiliate_publication_jobs.status = 'published' AND affiliate_publication_jobs.published_at >= ?`,
    [productId, channelType, since]
  );
  return Number(row && row.total ? row.total : 0);
}

async function queuePublication({ offerId, dailySpecialId = null, channelType, postType, scheduledAt = null, textOverride = "", userId = null, manualOverride = false, publishNow = false }) {
  const config = await moduleConfig();
  const offer = await db.get("SELECT * FROM affiliate_offers WHERE id = ?", [offerId]);
  if (!offer) {
    throw new Error("Offerta non trovata");
  }

  const product = await db.get("SELECT * FROM affiliate_products WHERE id = ?", [offer.product_id]);
  const publicationUrl = requiredText(product && (product.affiliate_url || product.source_post_url || product.product_url));
  if (!product || !publicationUrl || !isSafeUrl(publicationUrl)) {
    throw new Error("Link di pubblicazione non valido");
  }

  const cooldown =
    channelType === "telegram"
      ? Number(config.settings.affiliate_telegram_cooldown_hours || 72)
      : Number(config.settings.affiliate_facebook_cooldown_hours || 168);
  if (!manualOverride && (await countPublishedForProduct(product.id, channelType, cooldown)) > 0) {
    throw new Error("Cooldown attivo per questo prodotto");
  }

  const preview = await buildOfferPreview(
    offerId,
    channelType,
    postType,
    channelType === "telegram" && dailySpecialId ? { facebook_post_url: "" } : {}
  );

  const renderedText = sanitizeText(textOverride || preview.renderedText, channelType === "telegram" ? 3500 : 5000);
  const jobId = await db.insert("affiliate_publication_jobs", {
    offer_id: offerId,
    daily_special_id: dailySpecialId,
    channel_type: channelType,
    post_type: postType,
    scheduled_at: scheduledAt || nowIso(),
    status: "queued",
    attempt_count: 0,
    external_post_id: "",
    external_post_url: "",
    rendered_text: renderedText,
    image_url: preview.imageUrl || "",
    error_code: "",
    error_message: ""
  });

  const uniqueKey = `affiliate:${channelType}:${postType}:${offerId}:${scheduledAt || "now"}`;
  const backgroundJobId = await enqueueBackgroundJob(
    channelType === "telegram" ? "publish_telegram" : postType === "daily_special" ? "publish_daily_special_facebook" : "publish_second_facebook_offer",
    { publicationJobId: jobId },
    scheduledAt || nowIso(),
    uniqueKey
  );

  await db.run(
    "UPDATE affiliate_offers SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('candidate','approved')",
    [offerId]
  );
  await audit(userId, "affiliate.publication.queued", "affiliate_publication_job", jobId, { channelType, postType });
  if (publishNow && channelType === "telegram") {
    const result = await publishTelegram(jobId);
    await completeBackgroundJob(backgroundJobId);
    await audit(userId, "affiliate.publication.published_now", "affiliate_publication_job", jobId, result);
    return { jobId, published: true, ...result };
  }
  return jobId;
}

async function getTelegramConfig() {
  const settings = await getSettingsMap();
  return {
    enabled: settings.affiliate_telegram_enabled === true,
    botToken: requiredText(process.env.TELEGRAM_BOT_TOKEN),
    channelId: requiredText(process.env.TELEGRAM_CHANNEL_ID),
    channelUsername: requiredText(process.env.TELEGRAM_CHANNEL_USERNAME),
    intervalMinutes: Number(settings.affiliate_telegram_interval_minutes || 60),
    dailyLimit: Number(settings.affiliate_telegram_max_posts_per_day || 16),
    activeStart: requiredText(settings.affiliate_telegram_active_start_time || "07:00"),
    activeEnd: requiredText(settings.affiliate_telegram_active_end_time || "23:00")
  };
}

async function getFacebookConfig() {
  const settings = await getSettingsMap();
  return {
    enabled: settings.affiliate_facebook_enabled === true,
    pageId: requiredText(process.env.META_PAGE_ID),
    pageAccessToken: requiredText(process.env.META_PAGE_ACCESS_TOKEN),
    graphApiVersion: requiredText(process.env.META_GRAPH_API_VERSION || "v25.0"),
    pageUrl: requiredText(process.env.META_FACEBOOK_PAGE_URL),
    postTime1: requiredText(settings.affiliate_facebook_post_1_time || "07:00"),
    postTime2: requiredText(settings.affiliate_facebook_post_2_time || "19:00"),
    allowTextFallback: parseBool(settings.affiliate_allow_facebook_text_fallback, true)
  };
}

async function verifyTelegramConnection(sendTest = false) {
  const config = await getTelegramConfig();
  if (!config.botToken || !config.channelId) {
    return { ok: false, message: "Token o canale Telegram mancanti" };
  }
  const meResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
  const me = await meResponse.json();
  if (!me.ok) {
    return { ok: false, message: "Token Telegram non valido" };
  }
  const chatResponse = await fetch(
    `https://api.telegram.org/bot${config.botToken}/getChat?chat_id=${encodeURIComponent(config.channelId)}`
  );
  const chat = await chatResponse.json();
  if (!chat.ok) {
    return { ok: false, message: "Canale Telegram non accessibile al bot" };
  }
  if (sendTest) {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.channelId,
        text: "Test Telegram offerte affiliate CreatorSpeaker TV"
      })
    });
  }
  return {
    ok: true,
    message: "Connessione Telegram valida",
    botUsername: me.result && me.result.username,
    channelTitle: chat.result && chat.result.title
  };
}

async function verifyFacebookConnection(sendTest = false) {
  const config = await getFacebookConfig();
  if (!config.pageId || !config.pageAccessToken) {
    return { ok: false, message: "Page ID o Page Access Token mancanti" };
  }
  const infoResponse = await fetch(
    `https://graph.facebook.com/${config.graphApiVersion}/${config.pageId}?fields=id,name,link&access_token=${encodeURIComponent(config.pageAccessToken)}`
  );
  const info = await infoResponse.json();
  if (!infoResponse.ok || info.error) {
    return { ok: false, message: info.error ? info.error.message : "Token Facebook non valido" };
  }
  if (sendTest) {
    await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${config.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: "Test Facebook offerte affiliate CreatorSpeaker TV",
        access_token: config.pageAccessToken
      })
    });
  }
  return {
    ok: true,
    message: "Connessione Facebook valida",
    pageName: info.name,
    pageUrl: info.link,
    requiredPermissions: FACEBOOK_REQUIRED_PERMISSIONS
  };
}

async function fetchFacebookSourcePosts(limit = 12) {
  const config = await getFacebookConfig();
  if (!config.pageId || !config.pageAccessToken) {
    throw new Error("Pagina Facebook non configurata");
  }
  const fields = [
    "id",
    "message",
    "full_picture",
    "permalink_url",
    "created_time",
    "attachments{media_type,media,url,target,subattachments}",
    "link"
  ].join(",");
  const response = await fetch(
    `https://graph.facebook.com/${config.graphApiVersion}/${config.pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${Number(limit || 12)}&access_token=${encodeURIComponent(config.pageAccessToken)}`
  );
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload && payload.error ? payload.error.message : "Import Facebook non disponibile");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

function pickFacebookImage(post) {
  if (isSafeUrl(post.full_picture)) {
    return post.full_picture;
  }
  const attachment = post.attachments && Array.isArray(post.attachments.data) ? post.attachments.data[0] : null;
  if (attachment && attachment.media && attachment.media.image && isSafeUrl(attachment.media.image.src)) {
    return attachment.media.image.src;
  }
  const subattachments = attachment && attachment.subattachments && Array.isArray(attachment.subattachments.data)
    ? attachment.subattachments.data
    : [];
  for (const item of subattachments) {
    if (item && item.media && item.media.image && isSafeUrl(item.media.image.src)) {
      return item.media.image.src;
    }
  }
  return "";
}

function pickFacebookDestinationUrl(post, parsed) {
  const attachment = post.attachments && Array.isArray(post.attachments.data) ? post.attachments.data[0] : null;
  const attachmentUrl = requiredText(
    attachment && attachment.target && attachment.target.url
      ? attachment.target.url
      : attachment && attachment.url
        ? attachment.url
        : ""
  );
  const candidates = [post.link, attachmentUrl, ...(parsed.linkCandidates || [])].filter((item) => isSafeUrl(item));
  for (const candidate of candidates) {
    const hostname = new URL(candidate).hostname;
    if (!/facebook\.com/i.test(hostname)) {
      return candidate;
    }
  }
  return requiredText(post.permalink_url);
}

async function importFacebookPagePosts(userId = null, options = {}) {
  const runId = await createSchedulerRun("facebook_page_import");
  let itemsScanned = 0;
  let offersFound = 0;
  try {
    const posts = await fetchFacebookSourcePosts(options.limit || 12);
    for (const post of posts) {
      const message = requiredText(post.message);
      if (!message) {
        continue;
      }
      itemsScanned += 1;
      const parsed = parseFacebookPostDetails(message);
      const category = await pickCategoryForContent(message);
      if (!category) {
        continue;
      }
      const normalized = {
        amazonAsin: `fbpost:${post.id}`,
        marketplace: "facebook_page",
        sourceType: "facebook_page",
        sourceText: message,
        sourcePostUrl: requiredText(post.permalink_url),
        title: parsed.title,
        brand: "Facebook Page",
        productUrl: requiredText(post.permalink_url),
        affiliateUrl: pickFacebookDestinationUrl(post, parsed),
        imageUrl: pickFacebookImage(post),
        detailPageUrl: requiredText(post.permalink_url),
        currency: "EUR",
        availability: "available",
        primeEligible: /prime/i.test(message),
        rating: null,
        reviewCount: 0,
        currentPrice: parsed.currentPrice,
        referencePrice: parsed.previousPrice || parsed.currentPrice,
        discountPercent: parsed.discountPercent,
        source: "facebook_page",
        observedAt: requiredText(post.created_time) || nowIso()
      };
      const productId = await upsertProduct(normalized, category.id);
      await insertPriceObservation(productId, normalized);
      const scores = computeFacebookSourceScores({
        category,
        currentPrice: normalized.currentPrice,
        previousPrice: normalized.referencePrice,
        discountPercent: normalized.discountPercent,
        hasImage: Boolean(normalized.imageUrl),
        publishedAt: normalized.observedAt
      });
      const offer = await upsertOffer(productId, category, normalized, scores);
      if (["candidate", "approved"].includes(offer.status)) {
        offersFound += 1;
      }
    }
    await setSetting("affiliate_last_search_at", nowIso(), "text", "runtime", userId);
    await closeSchedulerRun(runId, { status: "completed", itemsScanned, offersFound, jobsCreated: 0 });
    await audit(userId, "affiliate.facebook_import.completed", "affiliate_scheduler_run", runId, { itemsScanned, offersFound });
    return { ok: true, itemsScanned, offersFound };
  } catch (error) {
    await closeSchedulerRun(runId, {
      status: "failed",
      itemsScanned,
      offersFound,
      jobsCreated: 0,
      errorMessage: error.message
    });
    await audit(userId, "affiliate.facebook_import.failed", "affiliate_scheduler_run", runId, { error: error.message });
    throw error;
  }
}

async function publishTelegram(publicationJobId) {
  const config = await moduleConfig();
  const tg = await getTelegramConfig();
  const row = await db.get(
    `SELECT affiliate_publication_jobs.*, affiliate_products.affiliate_url, affiliate_products.source_type, affiliate_products.source_post_url
     FROM affiliate_publication_jobs
     JOIN affiliate_offers ON affiliate_offers.id = affiliate_publication_jobs.offer_id
     JOIN affiliate_products ON affiliate_products.id = affiliate_offers.product_id
     WHERE affiliate_publication_jobs.id = ?`,
    [publicationJobId]
  );
  if (!row) {
    throw new Error("Publication job Telegram non trovato");
  }
  if (!tg.enabled || !tg.botToken || !tg.channelId) {
    throw new Error("Telegram non configurato");
  }
  const targetUrl = requiredText(row.affiliate_url || row.source_post_url);
  const replyMarkup = {
    inline_keyboard: targetUrl
      ? [[{ text: row.source_type === "facebook_page" ? "Apri contenuto" : "Vedi offerta su Amazon", url: targetUrl }]]
      : []
  };
  const caption = sanitizeText(row.rendered_text, 1000);
  const imageUrl = row.image_url;

  let response;
  if (imageUrl && isSafeUrl(imageUrl)) {
    response = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: tg.channelId,
        photo: imageUrl,
        caption,
        reply_markup: replyMarkup
      })
    });
    if (!response.ok) {
      response = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tg.channelId,
          text: sanitizeText(row.rendered_text, 3500),
          reply_markup: replyMarkup
        })
      });
    }
  } else {
    response = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: tg.channelId,
        text: sanitizeText(row.rendered_text, 3500),
        reply_markup: replyMarkup
      })
    });
  }
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || "Pubblicazione Telegram fallita");
  }

  const externalId = String(payload.result && payload.result.message_id ? payload.result.message_id : "");
  const externalUrl = tg.channelUsername && externalId
    ? `https://t.me/${tg.channelUsername.replace(/^@/, "")}/${externalId}`
    : "";
  await db.run(
    `UPDATE affiliate_publication_jobs
     SET status = 'published', external_post_id = ?, external_post_url = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [externalId, externalUrl, publicationJobId]
  );
  await db.run(
    "UPDATE affiliate_offers SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [row.offer_id]
  );
  return { ok: true, externalPostId: externalId, externalPostUrl: externalUrl };
}

async function publishFacebook(publicationJobId) {
  const config = await moduleConfig();
  const fb = await getFacebookConfig();
  const row = await db.get(
    `SELECT affiliate_publication_jobs.*, affiliate_products.affiliate_url
     FROM affiliate_publication_jobs
     JOIN affiliate_offers ON affiliate_offers.id = affiliate_publication_jobs.offer_id
     JOIN affiliate_products ON affiliate_products.id = affiliate_offers.product_id
     WHERE affiliate_publication_jobs.id = ?`,
    [publicationJobId]
  );
  if (!row) {
    throw new Error("Publication job Facebook non trovato");
  }
  if (!fb.enabled || !fb.pageId || !fb.pageAccessToken) {
    throw new Error("Facebook non configurato");
  }

  let response;
  let payload;
  if (row.image_url && isSafeUrl(row.image_url)) {
    response = await fetch(`https://graph.facebook.com/${fb.graphApiVersion}/${fb.pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        url: row.image_url,
        caption: sanitizeText(row.rendered_text, 2000),
        published: "true",
        access_token: fb.pageAccessToken
      })
    });
    payload = await response.json();
  }

  if ((!response || !response.ok || payload.error) && fb.allowTextFallback) {
    response = await fetch(`https://graph.facebook.com/${fb.graphApiVersion}/${fb.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: sanitizeText(row.rendered_text, 4000),
        link: row.affiliate_url,
        access_token: fb.pageAccessToken
      })
    });
    payload = await response.json();
  }

  if (!response || !response.ok || (payload && payload.error)) {
    throw new Error(payload && payload.error ? payload.error.message : "Pubblicazione Facebook fallita");
  }

  const externalId = String(payload.id || payload.post_id || "");
  const externalUrl = externalId ? `https://www.facebook.com/${externalId}` : fb.pageUrl || "";
  await db.run(
    `UPDATE affiliate_publication_jobs
     SET status = 'published', external_post_id = ?, external_post_url = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [externalId, externalUrl, publicationJobId]
  );
  await db.run(
    "UPDATE affiliate_offers SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [row.offer_id]
  );
  if (row.post_type === "daily_special" && row.daily_special_id) {
    await db.run(
      "UPDATE affiliate_daily_specials SET status = 'published', facebook_publication_id = ?, facebook_post_url = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [publicationJobId, externalUrl, row.daily_special_id]
    );
    const teaserTemplate = await getTemplate("telegram", "daily_special_teaser");
    if (teaserTemplate) {
      const teaserText = renderTemplate(teaserTemplate.text_template, { facebook_post_url: externalUrl });
      const teaserJobId = await db.insert("affiliate_publication_jobs", {
        offer_id: row.offer_id,
        daily_special_id: row.daily_special_id,
        channel_type: "telegram",
        post_type: "daily_special_teaser",
        scheduled_at: nowIso(),
        status: "queued",
        attempt_count: 0,
        external_post_id: "",
        external_post_url: "",
        rendered_text: teaserText,
        image_url: "",
        error_code: "",
        error_message: ""
      });
      await db.run(
        "UPDATE affiliate_daily_specials SET telegram_teaser_publication_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [teaserJobId, row.daily_special_id]
      );
      await enqueueBackgroundJob(
        "publish_daily_special_teaser",
        { publicationJobId: teaserJobId },
        nowIso(),
        `affiliate:telegram:daily_special_teaser:${row.daily_special_id}`
      );
    }
  }
  return { ok: true, externalPostId: externalId, externalPostUrl: externalUrl };
}

async function enqueueBackgroundJob(jobType, payload = {}, runAt = null, uniqueKey = "") {
  const key = requiredText(uniqueKey) || `${jobType}:${crypto.randomUUID()}`;
  const existing = await db.get(
    "SELECT id, status FROM affiliate_background_jobs WHERE unique_key = ?",
    [key]
  );
  if (existing && ["queued", "processing", "completed"].includes(existing.status)) {
    return existing.id;
  }
  return db.insert("affiliate_background_jobs", {
    job_type: jobType,
    status: "queued",
    unique_key: key,
    payload_json: stringifyJson(payload, "{}"),
    run_at: runAt || nowIso(),
    locked_at: null,
    locked_by: "",
    attempt_count: 0,
    max_attempts: 3,
    error_message: "",
    completed_at: null
  });
}

async function claimBackgroundJob(workerName) {
  const job = await db.get(
    "SELECT * FROM affiliate_background_jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at ASC, id ASC LIMIT 1",
    [nowIso()]
  );
  if (!job) {
    return null;
  }
  const updated = await db.run(
    "UPDATE affiliate_background_jobs SET status = 'processing', locked_at = ?, locked_by = ?, attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'",
    [nowIso(), workerName, job.id]
  );
  if (!updated.changes) {
    return null;
  }
  return {
    ...job,
    attempt_count: Number(job.attempt_count || 0) + 1,
    payload: parseJson(job.payload_json, {})
  };
}

async function completeBackgroundJob(jobId) {
  await db.run(
    "UPDATE affiliate_background_jobs SET status = 'completed', completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nowIso(), jobId]
  );
}

async function failBackgroundJob(job, error) {
  const message = sanitizeText(error.message || String(error), 500);
  if (Number(job.attempt_count || 0) >= Number(job.max_attempts || 3)) {
    await db.run(
      "UPDATE affiliate_background_jobs SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [message, job.id]
    );
    return;
  }
  const nextRunAt = new Date(Date.now() + Number(job.attempt_count || 1) * 300000).toISOString();
  await db.run(
    "UPDATE affiliate_background_jobs SET status = 'queued', locked_at = NULL, locked_by = '', error_message = ?, run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [message, nextRunAt, job.id]
  );
}

async function createSchedulerRun(jobType) {
  return db.insert("affiliate_scheduler_runs", {
    job_type: jobType,
    started_at: nowIso(),
    completed_at: null,
    status: "processing",
    items_scanned: 0,
    offers_found: 0,
    jobs_created: 0,
    error_message: ""
  });
}

async function closeSchedulerRun(runId, payload) {
  await db.run(
    `UPDATE affiliate_scheduler_runs
     SET completed_at = ?, status = ?, items_scanned = ?, offers_found = ?, jobs_created = ?, error_message = ?
     WHERE id = ?`,
    [
      nowIso(),
      payload.status || "completed",
      Number(payload.itemsScanned || 0),
      Number(payload.offersFound || 0),
      Number(payload.jobsCreated || 0),
      sanitizeText(payload.errorMessage || "", 400),
      runId
    ]
  );
}

async function runAmazonSearch(userId = null) {
  const config = await moduleConfig();
  const categories = (await listCategories()).filter((item) => item.status === "active");
  const runId = await createSchedulerRun("amazon_search");
  let itemsScanned = 0;
  let offersFound = 0;
  try {
    for (const category of categories) {
      const keywords = category.amazon_keywords && category.amazon_keywords.length ? category.amazon_keywords : [category.name];
      const results = await amazonCreatorsApi.searchProducts(category, keywords, 1);
      for (const normalized of results.slice(0, Number(category.max_results_per_search || 20))) {
        itemsScanned += 1;
        if (!normalized.currentPrice || !normalized.affiliateUrl || !normalized.imageUrl) {
          continue;
        }
        const productId = await upsertProduct(normalized, category.id);
        await insertPriceObservation(productId, normalized);
        const history = await getInternalHistory(productId);
        const scores = computeScores({
          currentPrice: normalized.currentPrice,
          referencePrice: normalized.referencePrice,
          discountPercent: normalized.discountPercent,
          primeEligible: normalized.primeEligible,
          rating: normalized.rating,
          reviewCount: normalized.reviewCount,
          category,
          history
        });
        const offer = await upsertOffer(productId, category, normalized, scores);
        if (["candidate", "approved"].includes(offer.status)) {
          offersFound += 1;
        }
      }
    }
    await setSetting("affiliate_last_search_at", nowIso(), "text", "runtime", userId);
    await closeSchedulerRun(runId, { status: "completed", itemsScanned, offersFound, jobsCreated: 0 });
    await audit(userId, "affiliate.search.completed", "affiliate_scheduler_run", runId, { itemsScanned, offersFound });
    return { ok: true, itemsScanned, offersFound };
  } catch (error) {
    await closeSchedulerRun(runId, {
      status: "failed",
      itemsScanned,
      offersFound,
      jobsCreated: 0,
      errorMessage: error.message
    });
    await audit(userId, "affiliate.search.failed", "affiliate_scheduler_run", runId, { error: error.message });
    throw error;
  }
}

async function selectBestOfferForChannel(channelType) {
  const cooldownHours =
    channelType === "telegram"
      ? Number((await getSettingsMap()).affiliate_telegram_cooldown_hours || 72)
      : Number((await getSettingsMap()).affiliate_facebook_cooldown_hours || 168);
  const rows = await db.all(
    `SELECT affiliate_offers.*, affiliate_categories.telegram_enabled, affiliate_categories.facebook_enabled, affiliate_categories.daily_special_enabled
     FROM affiliate_offers
     LEFT JOIN affiliate_categories ON affiliate_categories.id = affiliate_offers.category_id
     WHERE affiliate_offers.status IN ('candidate','approved')
     ORDER BY affiliate_offers.deal_score DESC, affiliate_offers.updated_at DESC
     LIMIT 40`
  );
  for (const row of rows) {
    if (channelType === "telegram" && !Boolean(row.telegram_enabled)) {
      continue;
    }
    if (channelType === "facebook" && !Boolean(row.facebook_enabled)) {
      continue;
    }
    const offer = await db.get(
      "SELECT affiliate_products.id AS product_id FROM affiliate_products WHERE affiliate_products.id = ?",
      [row.product_id]
    );
    if (!offer) {
      continue;
    }
    const recentCount = await countPublishedForProduct(offer.product_id, channelType, cooldownHours);
    if (!recentCount) {
      return row;
    }
  }
  return null;
}

async function selectDailySpecial(userId = null, selectionDate = null) {
  const dateKey = selectionDate || new Date().toISOString().slice(0, 10);
  const existing = await db.get("SELECT * FROM affiliate_daily_specials WHERE selection_date = ?", [dateKey]);
  if (existing) {
    return existing;
  }
  const rows = await db.all(
    `SELECT affiliate_offers.*
     FROM affiliate_offers
     JOIN affiliate_categories ON affiliate_categories.id = affiliate_offers.category_id
     WHERE affiliate_offers.status IN ('candidate','approved')
       AND affiliate_categories.daily_special_enabled = ${db.meta.driver === "pg" ? "TRUE" : "1"}
     ORDER BY affiliate_offers.deal_score DESC, affiliate_offers.updated_at DESC
     LIMIT 20`
  );
  for (const row of rows) {
    if ((await countPublishedForProduct(row.product_id, "facebook", Number((await getSettingsMap()).affiliate_facebook_cooldown_hours || 168))) > 0) {
      continue;
    }
    const id = await db.insert("affiliate_daily_specials", {
      offer_id: row.id,
      selection_date: dateKey,
      score: row.deal_score,
      status: "selected",
      facebook_publication_id: null,
      facebook_post_url: "",
      telegram_teaser_publication_id: null,
      selected_at: nowIso(),
      published_at: null
    });
    await audit(userId, "affiliate.daily_special.selected", "affiliate_daily_special", id, { offerId: row.id });
    return db.get("SELECT * FROM affiliate_daily_specials WHERE id = ?", [id]);
  }
  return null;
}

function formatPartsInTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return parts;
}

function timeStringNow(timeZone) {
  const parts = formatPartsInTimezone(new Date(), timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function dateStringNow(timeZone) {
  const parts = formatPartsInTimezone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesFromHHMM(value) {
  const [hour, minute] = String(value || "00:00").split(":").map((item) => Number(item));
  return (hour * 60) + minute;
}

function isInsideTimeWindow(current, start, end) {
  const currentMinutes = minutesFromHHMM(current);
  const startMinutes = minutesFromHHMM(start);
  const endMinutes = minutesFromHHMM(end);
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

async function countPublishedToday(channelType, datePrefix) {
  const row = await db.get(
    "SELECT COUNT(*) AS total FROM affiliate_publication_jobs WHERE channel_type = ? AND status = 'published' AND published_at LIKE ?",
    [channelType, `${datePrefix}%`]
  );
  return Number(row && row.total ? row.total : 0);
}

async function queueBestTelegramOffer(userId = null, options = {}) {
  const best = await selectBestOfferForChannel("telegram");
  if (!best) {
    return null;
  }
  return queuePublication({
    offerId: best.id,
    channelType: "telegram",
    postType: "standard_offer",
    scheduledAt: nowIso(),
    userId,
    manualOverride: Boolean(options.manualOverride),
    publishNow: Boolean(options.publishNow)
  });
}

async function publishOfferToTelegramNow(offerId, userId = null) {
  return queuePublication({
    offerId,
    channelType: "telegram",
    postType: "standard_offer",
    scheduledAt: nowIso(),
    userId,
    manualOverride: true,
    publishNow: true
  });
}

async function queueSecondFacebookOffer(userId = null) {
  const best = await selectBestOfferForChannel("facebook");
  if (!best) {
    return null;
  }
  return queuePublication({
    offerId: best.id,
    channelType: "facebook",
    postType: "facebook_second_offer",
    scheduledAt: nowIso(),
    userId
  });
}

async function runSchedulerTick(userId = null) {
  const config = await moduleConfig();
  const settings = config.settings;
  const lockKey = "affiliate_clock_lock";
  const lockOwner = `clock-${process.pid}`;
  const lockRow = await db.get("SELECT value FROM affiliate_settings WHERE key = ?", [lockKey]);
  if (lockRow && lockRow.value) {
    const lockAge = Date.now() - new Date(lockRow.value).getTime();
    if (lockAge < 45000) {
      return { ok: true, skipped: true, reason: "scheduler lock attivo" };
    }
  }
  await setSetting(lockKey, nowIso(), "text", "runtime", userId);
  await setSetting("affiliate_clock_lock_owner", lockOwner, "text", "runtime", userId);
  const runId = await createSchedulerRun("scheduler_tick");
  let jobsCreated = 0;
  try {
    const today = dateStringNow(config.timezone);
    const currentTime = timeStringNow(config.timezone);
    if (config.automationEnabled && config.facebookSourceEnabled && config.sourceMode === "facebook_page") {
      const lastImportAt = requiredText(settings.affiliate_last_search_at);
      const elapsed = lastImportAt ? (Date.now() - new Date(lastImportAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
      const interval = Number(settings.affiliate_search_interval_minutes || 60);
      if (elapsed >= interval) {
        await enqueueBackgroundJob("facebook_page_import", {}, nowIso(), `affiliate:facebook-source:${Math.floor(Date.now() / (interval * 60000))}`);
        jobsCreated += 1;
      }
    } else if (config.automationEnabled && settings.affiliate_amazon_search_enabled) {
      const lastSearchAt = requiredText(settings.affiliate_last_search_at);
      const elapsed = lastSearchAt ? (Date.now() - new Date(lastSearchAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
      const interval = Number(settings.affiliate_search_interval_minutes || 60);
      if (elapsed >= interval) {
        await enqueueBackgroundJob("amazon_search", {}, nowIso(), `affiliate:search:${Math.floor(Date.now() / (interval * 60000))}`);
        jobsCreated += 1;
      }
    }

    if (config.automationEnabled && config.telegramEnabled) {
      const activeWindow = isInsideTimeWindow(
        currentTime,
        requiredText(settings.affiliate_telegram_active_start_time || "07:00"),
        requiredText(settings.affiliate_telegram_active_end_time || "23:00")
      );
      const telegramToday = await countPublishedToday("telegram", today);
      const maxDaily = Number(settings.affiliate_telegram_max_posts_per_day || 16);
      const lastTelegramAt = requiredText(settings.affiliate_last_telegram_at);
      const telegramElapsed = lastTelegramAt ? (Date.now() - new Date(lastTelegramAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
      const telegramInterval = Number(settings.affiliate_telegram_interval_minutes || 60);
      if (activeWindow && telegramToday < maxDaily && telegramElapsed >= telegramInterval) {
        await enqueueBackgroundJob("queue_telegram_offer", {}, nowIso(), `affiliate:telegram-slot:${today}:${currentTime.slice(0, 2)}:${Math.floor(minutesFromHHMM(currentTime) / Math.max(30, telegramInterval))}`);
        jobsCreated += 1;
      }
    }

    if (config.automationEnabled && config.facebookEnabled) {
      if (currentTime === requiredText(settings.affiliate_facebook_post_1_time || "07:00")) {
        await enqueueBackgroundJob("select_daily_special", {}, nowIso(), `affiliate:daily-special:${today}`);
        jobsCreated += 1;
      }
      if (currentTime === requiredText(settings.affiliate_facebook_post_2_time || "19:00")) {
        await enqueueBackgroundJob("select_second_facebook_offer", {}, nowIso(), `affiliate:facebook-second:${today}`);
        jobsCreated += 1;
      }
    }

    await enqueueBackgroundJob("expire_offers", {}, nowIso(), `affiliate:expire:${today}:${currentTime.slice(0, 2)}`);
    await closeSchedulerRun(runId, { status: "completed", jobsCreated });
    await setSetting(lockKey, "", "text", "runtime", userId);
    await setSetting("affiliate_clock_lock_owner", "", "text", "runtime", userId);
    return { ok: true, jobsCreated };
  } catch (error) {
    await closeSchedulerRun(runId, { status: "failed", jobsCreated, errorMessage: error.message });
    await setSetting(lockKey, "", "text", "runtime", userId);
    await setSetting("affiliate_clock_lock_owner", "", "text", "runtime", userId);
    throw error;
  }
}

async function processBackgroundJobOnce(workerName = "affiliate-worker") {
  const job = await claimBackgroundJob(workerName);
  if (!job) {
    return { processed: false };
  }
  try {
    switch (job.job_type) {
      case "facebook_page_import":
        await importFacebookPagePosts();
        break;
      case "amazon_search":
      case "refresh_prices":
        await runAmazonSearch();
        break;
      case "queue_telegram_offer":
        await queueBestTelegramOffer();
        await setSetting("affiliate_last_telegram_at", nowIso(), "text", "runtime", null);
        break;
      case "publish_telegram":
      case "publish_daily_special_teaser":
        await publishTelegram(Number(job.payload.publicationJobId));
        break;
      case "select_daily_special": {
        const special = await selectDailySpecial();
        if (special) {
          await queuePublication({
            offerId: special.offer_id,
            dailySpecialId: special.id,
            channelType: "facebook",
            postType: "daily_special",
            scheduledAt: nowIso(),
            userId: null
          });
        }
        break;
      }
      case "publish_daily_special_facebook":
      case "publish_second_facebook_offer":
        await publishFacebook(Number(job.payload.publicationJobId));
        break;
      case "select_second_facebook_offer":
        await queueSecondFacebookOffer();
        break;
      case "score_offers":
        await runAmazonSearch();
        break;
      case "expire_offers":
        await db.run(
          "UPDATE affiliate_offers SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status IN ('candidate','approved') AND last_detected_at < ?",
          [new Date(Date.now() - 72 * 3600000).toISOString()]
        );
        break;
      default:
        throw new Error(`Job type non supportato: ${job.job_type}`);
    }
    await completeBackgroundJob(job.id);
    return { processed: true, jobType: job.job_type };
  } catch (error) {
    await failBackgroundJob(job, error);
    return { processed: true, jobType: job.job_type, error: error.message };
  }
}

module.exports = {
  maskSecret,
  moduleConfig,
  getSettingsMap,
  setSetting,
  dashboard,
  listCategories,
  upsertCategory,
  listTemplates,
  upsertTemplate,
  listOffers,
  listPublicationJobs,
  listRecentRuns,
  listAuditLogs,
  buildOfferPreview,
  approveOffer,
  rejectOffer,
  queuePublication,
  selectDailySpecial,
  verifyTelegramConnection,
  verifyFacebookConnection,
  importFacebookPagePosts,
  runAmazonSearch,
  queueBestTelegramOffer,
  publishOfferToTelegramNow,
  runSchedulerTick,
  processBackgroundJobOnce,
  enqueueBackgroundJob
};
