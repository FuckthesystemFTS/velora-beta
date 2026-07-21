const db = require("../db");
const { parseJson, stringifyJson } = require("../utils/safeJson");
const { slugify } = require("../utils/slug");
const { requiredText, toBool, toInt } = require("../utils/validators");

function moneyToCents(value) {
  const normalized = String(value || "0").replace(",", ".");
  return Math.max(0, Math.round(Number(normalized || 0) * 100));
}

function featuresFromText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolValue(value) {
  return db.meta.driver === "pg" ? toBool(value) : Number(toBool(value));
}

async function getMediaOptions() {
  return db.all("SELECT id, title, type, cloudinary_secure_url FROM media_assets WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 200");
}

async function getPublishedSections(pageKey) {
  return db.all(
    `SELECT content_sections.*, media_assets.cloudinary_secure_url AS media_url, media_assets.alt_text AS media_alt
     FROM content_sections
     LEFT JOIN media_assets ON media_assets.id = content_sections.media_asset_id AND media_assets.status != 'deleted'
     WHERE content_sections.page_key = ? AND content_sections.status = 'published'
     ORDER BY content_sections.sort_order ASC, content_sections.id ASC`,
    [pageKey]
  );
}

async function getSections(pageKey = "") {
  const params = [];
  let where = "";
  if (pageKey) {
    where = "WHERE content_sections.page_key = ?";
    params.push(pageKey);
  }
  return db.all(
    `SELECT content_sections.*, media_assets.title AS media_title, media_assets.cloudinary_secure_url AS media_url
     FROM content_sections
     LEFT JOIN media_assets ON media_assets.id = content_sections.media_asset_id
     ${where}
     ORDER BY page_key ASC, sort_order ASC, id ASC`,
    params
  );
}

function sectionPayload(body) {
  return {
    section_key: requiredText(body.section_key || slugify(body.title || "sezione")),
    page_key: requiredText(body.page_key || "home"),
    title: requiredText(body.title),
    subtitle: requiredText(body.subtitle),
    body: requiredText(body.body),
    cta_label: requiredText(body.cta_label),
    cta_url: requiredText(body.cta_url),
    media_asset_id: toInt(body.media_asset_id, 0) || null,
    status: requiredText(body.status || "draft"),
    sort_order: toInt(body.sort_order, 0),
    layout_type: requiredText(body.layout_type || "text"),
    seo_title: requiredText(body.seo_title),
    seo_description: requiredText(body.seo_description)
  };
}

async function upsertSection(body, id = null) {
  const payload = sectionPayload(body);
  if (id) {
    await db.run(
      `UPDATE content_sections SET section_key = ?, page_key = ?, title = ?, subtitle = ?, body = ?, cta_label = ?, cta_url = ?, media_asset_id = ?, status = ?, sort_order = ?, layout_type = ?, seo_title = ?, seo_description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        payload.section_key,
        payload.page_key,
        payload.title,
        payload.subtitle,
        payload.body,
        payload.cta_label,
        payload.cta_url,
        payload.media_asset_id,
        payload.status,
        payload.sort_order,
        payload.layout_type,
        payload.seo_title,
        payload.seo_description,
        id
      ]
    );
    return id;
  }
  return db.insert("content_sections", payload);
}

async function listServicePackages(category = "") {
  const params = [];
  let where = "WHERE service_packages.status != 'deleted'";
  if (category) {
    where += " AND service_packages.category = ?";
    params.push(category);
  }
  const rows = await db.all(
    `SELECT service_packages.*, media_assets.cloudinary_secure_url AS media_url, media_assets.alt_text AS media_alt
     FROM service_packages
     LEFT JOIN media_assets ON media_assets.id = service_packages.media_asset_id AND media_assets.status != 'deleted'
     ${where}
     ORDER BY service_packages.sort_order ASC, service_packages.id ASC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    features: parseJson(row.features_json, []),
    price_cents: Number(row.price || 0),
    active: row.status === "active",
    billing_type: row.billing_type || "one_time",
    description: row.short_description,
    name: row.title,
    ctaLabel: row.cta_label || "Richiedi attivazione"
  }));
}

function packagePayload(body) {
  const title = requiredText(body.title);
  return {
    title,
    slug: requiredText(body.slug) || slugify(title),
    category: requiredText(body.category || "custom"),
    short_description: requiredText(body.short_description),
    long_description: requiredText(body.long_description),
    price: moneyToCents(body.price),
    currency: requiredText(body.currency || "EUR").toUpperCase(),
    billing_type: requiredText(body.billing_type || "one_time"),
    features_json: stringifyJson(featuresFromText(body.features)),
    media_asset_id: toInt(body.media_asset_id, 0) || null,
    status: requiredText(body.status || "draft"),
    is_featured: boolValue(body.is_featured),
    sort_order: toInt(body.sort_order, 0),
    cta_label: requiredText(body.cta_label || "Richiedi attivazione")
  };
}

async function upsertServicePackage(body, id = null) {
  const payload = packagePayload(body);
  if (id) {
    await db.run(
      `UPDATE service_packages SET title = ?, slug = ?, category = ?, short_description = ?, long_description = ?, price = ?, currency = ?, billing_type = ?, features_json = ?, media_asset_id = ?, status = ?, is_featured = ?, sort_order = ?, cta_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        payload.title,
        payload.slug,
        payload.category,
        payload.short_description,
        payload.long_description,
        payload.price,
        payload.currency,
        payload.billing_type,
        payload.features_json,
        payload.media_asset_id,
        payload.status,
        payload.is_featured,
        payload.sort_order,
        payload.cta_label,
        id
      ]
    );
    return id;
  }
  return db.insert("service_packages", payload);
}

async function listProfiles(type) {
  const table = type === "speaker" ? "speaker_profiles" : "creator_profiles";
  const mediaColumn = type === "speaker" ? "video_media_id" : "cover_media_id";
  return db.all(
    `SELECT ${table}.*, avatar.cloudinary_secure_url AS avatar_url, cover.cloudinary_secure_url AS cover_url, video.cloudinary_secure_url AS video_url
     FROM ${table}
     LEFT JOIN media_assets AS avatar ON avatar.id = ${table}.avatar_media_id AND avatar.status != 'deleted'
     LEFT JOIN media_assets AS cover ON cover.id = ${table}.cover_media_id AND cover.status != 'deleted'
     LEFT JOIN media_assets AS video ON video.id = ${table}.${mediaColumn} AND video.status != 'deleted'
     WHERE ${table}.status != 'deleted'
     ORDER BY ${table}.sort_order ASC, ${table}.id ASC`
  );
}

function profilePayload(body, type) {
  const name = requiredText(body.name);
  const payload = {
    name,
    slug: requiredText(body.slug) || slugify(name),
    bio: requiredText(body.bio),
    description: requiredText(body.description),
    avatar_media_id: toInt(body.avatar_media_id, 0) || null,
    cover_media_id: toInt(body.cover_media_id, 0) || null,
    status: requiredText(body.status || "draft"),
    is_featured: boolValue(body.is_featured),
    sort_order: toInt(body.sort_order, 0)
  };
  if (type === "speaker") {
    payload.topic = requiredText(body.topic);
    payload.video_media_id = toInt(body.video_media_id, 0) || null;
  } else {
    payload.role = requiredText(body.role);
  }
  return payload;
}

async function upsertProfile(type, body, id = null) {
  const table = type === "speaker" ? "speaker_profiles" : "creator_profiles";
  const payload = profilePayload(body, type);
  if (id) {
    const sql =
      type === "speaker"
        ? `UPDATE speaker_profiles SET name = ?, slug = ?, topic = ?, bio = ?, description = ?, avatar_media_id = ?, cover_media_id = ?, video_media_id = ?, status = ?, is_featured = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        : `UPDATE creator_profiles SET name = ?, slug = ?, role = ?, bio = ?, description = ?, avatar_media_id = ?, cover_media_id = ?, status = ?, is_featured = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    const values =
      type === "speaker"
        ? [payload.name, payload.slug, payload.topic, payload.bio, payload.description, payload.avatar_media_id, payload.cover_media_id, payload.video_media_id, payload.status, payload.is_featured, payload.sort_order, id]
        : [payload.name, payload.slug, payload.role, payload.bio, payload.description, payload.avatar_media_id, payload.cover_media_id, payload.status, payload.is_featured, payload.sort_order, id];
    await db.run(sql, values);
    return id;
  }
  return db.insert(table, payload);
}

async function listBrandServices(publicOnly = false) {
  const rows = await db.all(
    `SELECT brand_services.*, media_assets.cloudinary_secure_url AS media_url, media_assets.alt_text AS media_alt
     FROM brand_services
     LEFT JOIN media_assets ON media_assets.id = brand_services.media_asset_id AND media_assets.status != 'deleted'
     WHERE brand_services.status ${publicOnly ? "= 'active'" : "!= 'deleted'"}
     ORDER BY brand_services.sort_order ASC, brand_services.id ASC`
  );
  return rows.map((row) => ({ ...row, benefits: parseJson(row.benefits_json, []) }));
}

async function upsertBrandService(body, id = null) {
  const title = requiredText(body.title);
  const payload = {
    title,
    slug: requiredText(body.slug) || slugify(title),
    description: requiredText(body.description),
    benefits_json: stringifyJson(featuresFromText(body.benefits)),
    cta_label: requiredText(body.cta_label || "Richiedi informazioni"),
    cta_url: requiredText(body.cta_url || "/richiedi-informazioni"),
    media_asset_id: toInt(body.media_asset_id, 0) || null,
    status: requiredText(body.status || "draft"),
    sort_order: toInt(body.sort_order, 0)
  };
  if (id) {
    await db.run(
      "UPDATE brand_services SET title = ?, slug = ?, description = ?, benefits_json = ?, cta_label = ?, cta_url = ?, media_asset_id = ?, status = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [payload.title, payload.slug, payload.description, payload.benefits_json, payload.cta_label, payload.cta_url, payload.media_asset_id, payload.status, payload.sort_order, id]
    );
    return id;
  }
  return db.insert("brand_services", payload);
}

async function getSiteSettingsMap() {
  const rows = await db.all("SELECT * FROM site_settings ORDER BY group_name ASC, key ASC");
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

async function setSiteSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    const existing = await db.get("SELECT id FROM site_settings WHERE key = ?", [key]);
    if (existing) {
      await db.run("UPDATE site_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?", [requiredText(value), key]);
    } else {
      await db.insert("site_settings", {
        key,
        value: requiredText(value),
        type: "text",
        group_name: key.startsWith("seo_") ? "seo" : "general"
      });
    }
  }
}

module.exports = {
  getMediaOptions,
  getPublishedSections,
  getSections,
  upsertSection,
  listServicePackages,
  upsertServicePackage,
  listProfiles,
  upsertProfile,
  listBrandServices,
  upsertBrandService,
  getSiteSettingsMap,
  setSiteSettings,
  featuresFromText
};
