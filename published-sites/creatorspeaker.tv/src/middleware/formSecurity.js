const crypto = require("crypto");

function cleanScalar(value, maxLength = 4000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      result[key] = cleanScalar(value, key === "message" || key === "notes" || key === "admin_notes" ? 12000 : 4000);
    } else if (Array.isArray(value) || (value && typeof value === "object")) {
      result[key] = sanitizePayload(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function normalizeLocalPath(value, fallback = "/") {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  return normalized;
}

function getFormRedirectUrl(req, fallback = "/") {
  const bodyTarget = req.body && typeof req.body === "object" ? req.body._return_to : "";
  const queryTarget = req.query && typeof req.query === "object" ? req.query._return_to : "";
  const referrer = String(req.get("Referrer") || "").trim();

  if (bodyTarget) {
    return normalizeLocalPath(bodyTarget, fallback);
  }
  if (queryTarget) {
    return normalizeLocalPath(queryTarget, fallback);
  }
  if (referrer) {
    try {
      const referrerUrl = new URL(referrer);
      return normalizeLocalPath(`${referrerUrl.pathname}${referrerUrl.search || ""}`, fallback);
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
}

function isMultipartRequest(req) {
  return String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data");
}

function csrfFailure(req, res, message, fallback = "/") {
  if (req.session) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }
  req.session.flash = { type: "error", message };
  return res.redirect(getFormRedirectUrl(req, fallback));
}

function sameOriginAdminPost(req) {
  if (!req.session || !req.session.adminId || !(/^\/admin(\/|$)|^\/staff(\/|$)/).test(req.path)) {
    return false;
  }

  const host = String(req.get("host") || "").toLowerCase();
  const candidates = [req.get("origin"), req.get("referer")].filter(Boolean);
  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate);
      return url.host.toLowerCase() === host;
    } catch (error) {
      return false;
    }
  });
}

function hasValidCsrf(req) {
  if (req.method !== "POST" || req.path.startsWith("/api/")) {
    return true;
  }

  const token = String(req.body && req.body._csrf ? req.body._csrf : "");
  const sessionToken = String(req.session && req.session.csrfToken ? req.session.csrfToken : "");
  const honeypot = String(req.body && req.body.website ? req.body.website : "").trim();

  if (honeypot) {
    return { ok: false, message: "Invio non valido" };
  }

  if (sameOriginAdminPost(req) && (!token || !sessionToken)) {
    req.session.csrfToken = token || crypto.randomBytes(24).toString("hex");
    return { ok: true };
  }

  if (!token || !sessionToken) {
    return { ok: false, message: "Sessione del form scaduta ricarica e riprova" };
  }

  const tokenBuffer = Buffer.from(token);
  const sessionBuffer = Buffer.from(sessionToken);
  if (tokenBuffer.length !== sessionBuffer.length || !crypto.timingSafeEqual(tokenBuffer, sessionBuffer)) {
    if (sameOriginAdminPost(req)) {
      req.session.csrfToken = crypto.randomBytes(24).toString("hex");
      return { ok: true };
    }
    return { ok: false, message: "Modulo aggiornato durante la sessione ricarica e riprova" };
  }

  return { ok: true };
}

function verifyCsrf(req, res, next) {
  if (isMultipartRequest(req)) {
    return next();
  }

  const result = hasValidCsrf(req);
  if (result === true || result.ok) {
    return next();
  }

  return csrfFailure(req, res, result.message);
}

function verifyCsrfAfterUpload(fallback = "/") {
  return (req, res, next) => {
    const result = hasValidCsrf(req);
    if (result === true || result.ok) {
      return next();
    }
    return csrfFailure(req, res, result.message, fallback);
  };
}

function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizePayload(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitizePayload(req.query);
  }
  next();
}

module.exports = {
  cleanScalar,
  ensureCsrfToken,
  verifyCsrf,
  verifyCsrfAfterUpload,
  getFormRedirectUrl,
  sanitizeRequest
};
