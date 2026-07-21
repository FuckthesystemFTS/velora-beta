const db = require("../db");
const { parseJson } = require("./safeJson");

async function getSiteSettings() {
  const [siteSetting, legalSetting, bankSetting, cmsRows] = await Promise.all([
    db.getSetting("site", {}),
    db.getSetting("legal", {}),
    db.getSetting("bank", {}),
    db.all("SELECT key, value FROM site_settings")
  ]);
  const site = siteSetting || {};
  const legal = legalSetting || {};
  const bank = bankSetting || {};
  const cmsSettings = cmsRows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
  if (!site.logo || site.logo === "/assets/logo-placeholder.svg") {
    site.logo = "/assets/brand/creatorspeaker-brand-emblem.jpg";
  }
  if (cmsSettings.logo_url) {
    site.logo = cmsSettings.logo_url;
  }
  if (cmsSettings.og_image) {
    site.heroImage = cmsSettings.og_image;
  }
  site.colors = site.colors || {};
  site.colors.bg = site.colors.bg || "#070812";
  site.colors.panel = site.colors.panel || "#101322";
  site.colors.accent = site.colors.accent || "#7C3AED";
  site.colors.accent2 = site.colors.accent2 || "#E50914";
  site.colors.gold = site.colors.gold || "#FFD166";
  site.colors.cyan = site.colors.cyan || "#23D5FF";
  site.heroImage = site.heroImage || "/assets/brand/creatorspeaker-brand-hero.jpg";
  site.emblemImage = site.emblemImage || "/assets/brand/creatorspeaker-brand-emblem.jpg";
  return { site, legal, bank, cmsSettings };
}

async function getPackagesByArea() {
  const rows = await db.all("SELECT * FROM packages WHERE active = ? ORDER BY sort_order ASC, id ASC", [
    db.meta.driver === "pg" ? true : 1
  ]);
  const mapped = rows.map((row) => ({
    ...row,
    active: Boolean(row.active),
    features: parseJson(row.features_json, [])
  }));
  return mapped.reduce((acc, row) => {
    acc[row.area] = acc[row.area] || [];
    acc[row.area].push(row);
    return acc;
  }, {});
}

function maskSecret(value) {
  return value ? "configurato" : "non configurato";
}

function renderPage(res, title, bodyTemplate, data = {}, page = {}, layout = "layout-public") {
  return res.render(layout, {
    title,
    bodyTemplate,
    data,
    page
  });
}

function renderPublicPage(res, title, bodyTemplate, data = {}, page = {}) {
  return renderPage(res, title, bodyTemplate, data, page, "layout-public");
}

function renderUserPage(res, title, bodyTemplate, data = {}, page = {}) {
  return renderPage(res, title, bodyTemplate, data, page, "layout-user");
}

function renderAdminPage(res, title, bodyTemplate, data = {}, page = {}) {
  return renderPage(res, title, bodyTemplate, data, page, "layout-admin");
}

module.exports = {
  getSiteSettings,
  getPackagesByArea,
  maskSecret,
  renderPage,
  renderPublicPage,
  renderUserPage,
  renderAdminPage
};
