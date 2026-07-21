const { slugify } = require("./slug");

function requiredText(value, fallback = "") {
  return String(value || fallback).trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());
}

function toInt(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function toBool(value) {
  return ["1", "true", "on", "yes"].includes(String(value || "").toLowerCase());
}

function sanitizeFeatures(input) {
  return String(input || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePackagePayload(body) {
  const name = requiredText(body.name);
  return {
    area: requiredText(body.area || "extra"),
    name,
    slug: requiredText(body.slug) || slugify(name),
    price_cents: toInt(body.price_cents),
    billing_type: requiredText(body.billing_type || "one_time"),
    description: requiredText(body.description),
    features: sanitizeFeatures(body.features),
    active: toBool(body.active),
    sort_order: toInt(body.sort_order, 0)
  };
}

module.exports = {
  requiredText,
  isEmail,
  toInt,
  toBool,
  sanitizeFeatures,
  normalizePackagePayload
};
