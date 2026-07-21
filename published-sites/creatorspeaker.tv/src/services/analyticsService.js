const crypto = require("crypto");

const db = require("../db");
const { requiredText, toInt } = require("../utils/validators");

const EXCLUDED_PREFIXES = ["/admin", "/dashboard", "/api", "/public", "/css", "/js", "/assets"];
const EXCLUDED_PATHS = new Set([
  "/favicon.ico",
  "/favicon.png",
  "/robots.txt",
  "/sitemap.xml",
  "/logout"
]);

function shouldTrackRequest(req) {
  if (!req || !["GET", "HEAD"].includes(req.method || "")) {
    return false;
  }

  const path = requiredText(req.path || "/");
  if (!path || EXCLUDED_PATHS.has(path)) {
    return false;
  }

  return !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function getClientIp(req) {
  return requiredText(req.headers["x-forwarded-for"]).split(",")[0].trim() || requiredText(req.ip);
}

function detectDeviceType(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) {
    return "unknown";
  }
  if (/ipad|tablet/.test(ua)) {
    return "tablet";
  }
  if (/mobile|iphone|android/.test(ua)) {
    return "mobile";
  }
  if (/bot|crawl|spider|slurp|preview/.test(ua)) {
    return "bot";
  }
  return "desktop";
}

function getReferrerHost(referrerUrl) {
  const normalized = requiredText(referrerUrl);
  if (!normalized) {
    return "";
  }
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch (error) {
    return "";
  }
}

function buildVisitorHash(req, userAgent) {
  const raw = [
    getClientIp(req),
    requiredText(userAgent),
    requiredText(process.env.SESSION_SECRET || "change-me")
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function normalizePath(pathname) {
  const path = requiredText(pathname || "/");
  return path === "/" ? "/" : path.replace(/\/+$/, "") || "/";
}

function pageTypeFromPath(pathname) {
  const path = normalizePath(pathname);
  if (path === "/") {
    return "home";
  }
  const firstSegment = path.split("/").filter(Boolean)[0];
  return firstSegment || "public";
}

async function trackVisit(req, res) {
  if (!shouldTrackRequest(req)) {
    return;
  }

  const contentType = String(res.getHeader("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html")) {
    return;
  }

  const statusCode = toInt(res.statusCode, 0);
  if (!statusCode || statusCode >= 400) {
    return;
  }

  const userAgent = requiredText(req.headers["user-agent"]).slice(0, 500);
  const path = normalizePath(req.path || "/");
  const referrerUrl = requiredText(req.headers.referer || req.headers.referrer).slice(0, 500);

  await db.insert("site_visit_events", {
    path,
    page_type: pageTypeFromPath(path),
    referrer_host: getReferrerHost(referrerUrl),
    referrer_url: referrerUrl,
    device_type: detectDeviceType(userAgent),
    visitor_hash: buildVisitorHash(req, userAgent),
    session_id: requiredText(req.sessionID).slice(0, 200),
    user_id: req.session && req.session.userId ? req.session.userId : null,
    is_authenticated: db.meta.driver === "pg" ? Boolean(req.session && req.session.userId) : Number(Boolean(req.session && req.session.userId)),
    status_code: statusCode,
    user_agent: userAgent
  });
}

function analyticsMiddleware(req, res, next) {
  if (!shouldTrackRequest(req)) {
    return next();
  }

  res.on("finish", () => {
    trackVisit(req, res).catch((error) => {
      console.error("Analytics tracking failed:", error.message);
    });
  });

  return next();
}

function formatDateLabel(value) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildCutoff(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - Math.max(0, days - 1));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function rangeDaysFromQuery(value) {
  const allowed = [7, 14, 30, 90];
  const days = toInt(value, 30);
  return allowed.includes(days) ? days : 30;
}

async function getSummary(rangeDays = 30) {
  const days = rangeDaysFromQuery(rangeDays);
  const cutoff = buildCutoff(days);
  const todayCutoff = buildCutoff(1);
  const priorCutoff = buildCutoff(days * 2);

  const [totals, topPages, referrers, devices, dailyRows, recentEvents] = await Promise.all([
    Promise.all([
      db.get("SELECT COUNT(*) AS total FROM site_visit_events WHERE created_at >= ?", [cutoff]),
      db.get("SELECT COUNT(DISTINCT visitor_hash) AS total FROM site_visit_events WHERE created_at >= ?", [cutoff]),
      db.get("SELECT COUNT(*) AS total FROM site_visit_events WHERE created_at >= ?", [todayCutoff]),
      db.get("SELECT COUNT(DISTINCT visitor_hash) AS total FROM site_visit_events WHERE created_at >= ?", [todayCutoff]),
      db.get("SELECT COUNT(*) AS total FROM site_visit_events WHERE created_at >= ? AND created_at < ?", [priorCutoff, cutoff]),
      db.get("SELECT COUNT(DISTINCT visitor_hash) AS total FROM site_visit_events WHERE created_at >= ? AND created_at < ?", [priorCutoff, cutoff])
    ]),
    db.all(
      `SELECT path, COUNT(*) AS impressions, COUNT(DISTINCT visitor_hash) AS visitors
       FROM site_visit_events
       WHERE created_at >= ?
       GROUP BY path
       ORDER BY impressions DESC, visitors DESC, path ASC
       LIMIT 10`,
      [cutoff]
    ),
    db.all(
      `SELECT referrer_host, COUNT(*) AS impressions
       FROM site_visit_events
       WHERE created_at >= ? AND referrer_host IS NOT NULL AND referrer_host != ''
       GROUP BY referrer_host
       ORDER BY impressions DESC, referrer_host ASC
       LIMIT 10`,
      [cutoff]
    ),
    db.all(
      `SELECT device_type, COUNT(*) AS impressions, COUNT(DISTINCT visitor_hash) AS visitors
       FROM site_visit_events
       WHERE created_at >= ?
       GROUP BY device_type
       ORDER BY impressions DESC, device_type ASC`,
      [cutoff]
    ),
    db.all(
      `SELECT DATE(created_at) AS day, COUNT(*) AS impressions, COUNT(DISTINCT visitor_hash) AS visitors
       FROM site_visit_events
       WHERE created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [cutoff]
    ),
    db.all(
      `SELECT path, referrer_host, device_type, created_at
       FROM site_visit_events
       WHERE created_at >= ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [cutoff]
    )
  ]);

  const currentImpressions = Number(totals[0].total || 0);
  const currentVisitors = Number(totals[1].total || 0);
  const todayImpressions = Number(totals[2].total || 0);
  const todayVisitors = Number(totals[3].total || 0);
  const previousImpressions = Number(totals[4].total || 0);
  const previousVisitors = Number(totals[5].total || 0);

  return {
    rangeDays: days,
    totals: {
      impressions: currentImpressions,
      visitors: currentVisitors,
      todayImpressions,
      todayVisitors,
      previousImpressions,
      previousVisitors
    },
    topPages: topPages.map((row) => ({
      path: row.path,
      impressions: Number(row.impressions || 0),
      visitors: Number(row.visitors || 0)
    })),
    referrers: referrers.map((row) => ({
      host: row.referrer_host,
      impressions: Number(row.impressions || 0)
    })),
    devices: devices.map((row) => ({
      device: row.device_type,
      impressions: Number(row.impressions || 0),
      visitors: Number(row.visitors || 0)
    })),
    dailyTrend: dailyRows.map((row) => ({
      day: row.day,
      label: formatDateLabel(row.day),
      impressions: Number(row.impressions || 0),
      visitors: Number(row.visitors || 0)
    })),
    recentEvents: recentEvents.map((row) => ({
      ...row,
      created_at_label: formatDateTime(row.created_at)
    }))
  };
}

module.exports = {
  analyticsMiddleware,
  getSummary,
  rangeDaysFromQuery
};
