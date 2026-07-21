const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const nodemailer = require("nodemailer");

const db = require("../db");
const { requiredText, toInt, toBool } = require("../utils/validators");
const { parseJson } = require("../utils/safeJson");

const USER_AGENT = "CreatorSpeakerContactResearch/1.0";
const MAX_RESULTS = 100;
const MAX_PAGES_PER_DOMAIN = 5;
const MAX_RESPONSE_BYTES = 512 * 1024;
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const PERSONAL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com"]);
const TEMP_DOMAINS = new Set(["mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com"]);
const ROLE_PREFIXES = new Set([
  "info",
  "contatti",
  "contact",
  "commerciale",
  "sales",
  "marketing",
  "ufficio",
  "assistenza",
  "support",
  "service",
  "amministrazione",
  "segreteria",
  "hello",
  "office",
  "booking",
  "prenotazioni"
]);
const EXCLUDED_PREFIXES = new Set(["noreply", "no-reply", "abuse", "privacy", "webmaster", "postmaster", "pec"]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSearchText(value) {
  return requiredText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSearchProviderError(message = "") {
  const text = String(message || "");
  if (
    /customsearchservice\.list are blocked/i.test(text) ||
    /custom search api has not been used/i.test(text) ||
    /does not have the access to custom search json api/i.test(text)
  ) {
    return "Google Custom Search non e attiva su questa chiave API. Abilita la Custom Search API nel progetto Google Cloud oppure usa Google Places o importazione manuale";
  }
  if (/permission denied|forbidden|status code 403/i.test(text)) {
    return "Google ha rifiutato la richiesta. Controlla che la API usata per la ricerca contatti sia abilitata e associata al progetto corretto";
  }
  if (/quota|rate limit|resource_exhausted/i.test(text)) {
    return "Quota Google esaurita o limite temporaneo raggiunto. Attendi oppure usa un altra chiave API";
  }
  return text;
}

function maskSecret(value) {
  const text = requiredText(value);
  if (!text) {
    return "";
  }
  return `${"•".repeat(12)}${text.slice(-4)}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isPrivateIp(address) {
  if (!address) {
    return true;
  }
  if (address === "127.0.0.1" || address === "::1" || address === "0.0.0.0") {
    return true;
  }
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80") || normalized === "::";
  }
  const parts = address.split(".").map((item) => Number(item));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return true;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

async function assertSafeUrl(inputUrl) {
  const url = new URL(inputUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Protocollo URL non consentito");
  }
  if (!url.hostname || url.hostname === "localhost") {
    throw new Error("Host non consentito");
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error("Host privato o interno bloccato");
  }
  return url;
}

async function fetchText(url, options = {}) {
  const safeUrl = await assertSafeUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), toInt(options.timeoutMs, 7000));
  try {
    const response = await fetch(safeUrl.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error("Risposta troppo grande");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timeout);
  }
}

async function robotsAllowed(siteUrl) {
  try {
    const url = new URL(siteUrl);
    const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
    const body = await fetchText(robotsUrl, { timeoutMs: 4000 });
    const lines = body.split(/\r?\n/).map((line) => line.trim());
    let applies = false;
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = String(rawKey || "").toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*" || value.toLowerCase().includes("creatorspeakercontactresearch");
      }
      if (applies && key === "disallow" && value === "/") {
        return false;
      }
    }
  } catch (error) {
    return true;
  }
  return true;
}

function cleanHtmlText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&commat;/gi, "@")
    .replace(/&#64;/g, "@")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanHtmlText(match[1]).slice(0, 160) : "";
}

function extractLinks(baseUrl, html) {
  const base = new URL(baseUrl);
  const found = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(String(html || "")))) {
    try {
      const href = match[1];
      if (href.startsWith("mailto:")) {
        continue;
      }
      const next = new URL(href, base);
      if (next.origin !== base.origin) {
        continue;
      }
      const path = next.pathname.toLowerCase();
      if (/(contatti|contact|chi-siamo|about|assistenza|support|impressum)/.test(path)) {
        found.push(next.toString());
      }
    } catch (error) {
      // ignore malformed href
    }
  }
  return Array.from(new Set(found)).slice(0, MAX_PAGES_PER_DOMAIN - 1);
}

function extractEmails(html) {
  const text = cleanHtmlText(html);
  const mailtos = Array.from(String(html || "").matchAll(/mailto:([^"'>?\s]+)/gi)).map((match) => match[1]);
  const plain = Array.from(text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)).map((match) => match[0]);
  return Array.from(new Set([...mailtos, ...plain].map(normalizeEmail)));
}

function classifyEmail(email, sourceUrl = "") {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  const syntaxValid = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized);
  const isRole = ROLE_PREFIXES.has(local);
  const isPersonal = PERSONAL_DOMAINS.has(domain);
  const isPec = domain && (domain.includes("pec.") || domain.endsWith(".pec.it") || local === "pec");
  const excluded = EXCLUDED_PREFIXES.has(local) || TEMP_DOMAINS.has(domain);
  let contactType = isRole ? "generic_business" : "named_business";
  let approvalStatus = isRole ? "pending_review" : "pending_review";
  if (isPersonal) {
    contactType = "personal_provider";
  }
  if (isPec) {
    contactType = "pec";
    approvalStatus = "rejected";
  }
  if (excluded) {
    contactType = isPec ? "pec" : "excluded";
    approvalStatus = "rejected";
  }
  return {
    email,
    normalizedEmail: normalized,
    domain,
    local,
    syntaxValid,
    isRole,
    isPersonal,
    contactType,
    approvalStatus,
    validationStatus: syntaxValid ? "syntax_valid" : "invalid",
    sourceUrl
  };
}

async function validateMx(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return records && records.length ? "mx_valid" : "domain_valid";
  } catch (error) {
    return "risky";
  }
}

async function isSuppressed(normalizedEmail) {
  const row = await db.get("SELECT id FROM outreach_suppression_list WHERE normalized_email = ?", [normalizedEmail]);
  return Boolean(row);
}

async function logAction(userId, action, entityType, entityId, details = {}, ipAddress = "") {
  return db.insert("outreach_audit_logs", {
    user_id: userId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    details_json: JSON.stringify(details || {}),
    ip_address: requiredText(ipAddress)
  });
}

async function insertContact({ businessId, searchId, email, sourceUrl, sourceTitle, context }) {
  const classified = classifyEmail(email, sourceUrl);
  if (!classified.syntaxValid) {
    return { inserted: false, reason: "invalid" };
  }
  if (await isSuppressed(classified.normalizedEmail)) {
    return { inserted: false, reason: "suppressed" };
  }
  const existing = await db.get("SELECT id FROM outreach_contacts WHERE normalized_email = ?", [classified.normalizedEmail]);
  if (existing) {
    return { inserted: false, reason: "duplicate", id: existing.id };
  }
  const validationStatus = classified.validationStatus === "syntax_valid"
    ? await validateMx(classified.domain)
    : classified.validationStatus;
  const id = await db.insert("outreach_contacts", {
    business_id: businessId || null,
    search_id: searchId || null,
    email: classified.email,
    normalized_email: classified.normalizedEmail,
    email_domain: classified.domain,
    contact_type: classified.contactType,
    is_role_based: classified.isRole ? 1 : 0,
    is_personal_provider: classified.isPersonal ? 1 : 0,
    source_url: sourceUrl || "",
    source_page_title: sourceTitle || "",
    source_context: String(context || "").slice(0, 500),
    validation_status: validationStatus,
    approval_status: classified.approvalStatus,
    legal_basis_note: "",
    consent_reference: "",
    approved_by_user_id: null,
    approved_at: null,
    last_contacted_at: null
  });
  return { inserted: true, id };
}

async function createSearch(payload, userId) {
  const targetQuery = requiredText(payload.target_query || payload.query);
  const sector = requiredText(payload.sector);
  const location = requiredText(payload.location);
  const requestedLimit = Math.max(1, Math.min(MAX_RESULTS, toInt(payload.requested_limit, 10)));
  if (!targetQuery && (!sector || !location)) {
    throw new Error("Inserisci una ricerca mirata oppure settore e localita");
  }
  const effectiveSector = targetQuery || sector;
  const effectiveLocation = targetQuery ? location || "" : location;
  const effectiveQuery = targetQuery || `${sector} ${location}`;
  return db.insert("outreach_searches", {
    created_by_user_id: userId || null,
    query: effectiveQuery,
    sector: effectiveSector,
    location: effectiveLocation,
    country: requiredText(payload.country || "Italia"),
    language: requiredText(payload.language || "it"),
    requested_limit: requestedLimit,
    status: "queued",
    search_provider: requiredText(payload.search_provider || "google_cse"),
    provider_query_json: JSON.stringify({
      targetQuery,
      createList: Boolean(payload.create_list),
      includeNamed: Boolean(payload.include_named),
      excludePersonal: payload.exclude_personal !== "off",
      excludePec: payload.exclude_pec !== "off"
    })
  });
}

async function googleCseSearch(search) {
  if (!process.env.GOOGLE_CSE_API_KEY || !process.env.GOOGLE_CSE_ID) {
    throw new Error("GOOGLE_CSE_API_KEY e GOOGLE_CSE_ID non configurati");
  }
  const options = parseJson(search.provider_query_json, {});
  const baseQuery = requiredText(options.targetQuery || search.query || [search.sector, search.location].filter(Boolean).join(" "));
  const queries = options.targetQuery
    ? [
        `"${baseQuery}" email`,
        `"${baseQuery}" contatti`,
        `"${baseQuery}" contatto`,
        `"${baseQuery}" sito ufficiale`,
        `"${baseQuery}" contact`
      ]
    : [
        `${search.sector} ${search.location} contatti`,
        `${search.sector} ${search.location} email`,
        `${search.sector} ${search.location} sito ufficiale`,
        `${search.sector} ${search.location} contact`
      ];
  const results = [];
  for (const query of queries) {
    if (results.length >= search.requested_limit) {
      break;
    }
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", process.env.GOOGLE_CSE_API_KEY);
    url.searchParams.set("cx", process.env.GOOGLE_CSE_ID);
    url.searchParams.set("q", query);
    url.searchParams.set("num", "10");
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        normalizeSearchProviderError(payload.error && payload.error.message ? payload.error.message : "Google CSE non disponibile")
      );
    }
    for (const item of payload.items || []) {
      if (item.link && !results.find((existing) => existing.link === item.link)) {
        results.push({
          title: item.title || item.displayLink || item.link,
          link: item.link,
          snippet: item.snippet || "",
          query
        });
      }
      if (results.length >= search.requested_limit) {
        break;
      }
    }
  }
  return results;
}

async function bingSearch(search) {
  const options = parseJson(search.provider_query_json, {});
  const baseQuery = requiredText(options.targetQuery || search.query || [search.sector, search.location].filter(Boolean).join(" "));
  if (!baseQuery) {
    return [];
  }
  const queries = options.targetQuery
    ? [
        `"${baseQuery}" email`,
        `"${baseQuery}" contatti`,
        `"${baseQuery}" contact`,
        `"${baseQuery}" sito ufficiale`
      ]
    : [
        `${search.sector} ${search.location} contatti`,
        `${search.sector} ${search.location} email`,
        `${search.sector} ${search.location} sito ufficiale`
      ];
  const results = [];
  for (const query of queries) {
    if (results.length >= search.requested_limit) {
      break;
    }
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", query);
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5"
      }
    });
    if (!response.ok) {
      throw new Error(`Bing non disponibile HTTP ${response.status}`);
    }
    const html = await response.text();
    const matches = Array.from(String(html).matchAll(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi));
    for (const match of matches) {
      const targetUrl = requiredText(match[1]);
      if (!/^https?:\/\//i.test(targetUrl)) {
        continue;
      }
      if (results.find((existing) => existing.link === targetUrl)) {
        continue;
      }
      results.push({
        title: cleanHtmlText(match[2]).slice(0, 180) || targetUrl,
        link: targetUrl,
        snippet: query,
        query,
        provider: "duckduckgo"
      });
      if (results.length >= search.requested_limit) {
        break;
      }
    }
  }
  return results;
}

async function googlePlacesSearch(search) {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return [];
  }
  const options = parseJson(search.provider_query_json, {});
  const textQuery = options.targetQuery
    ? `${options.targetQuery} ${search.country}`.trim()
    : `${search.sector} ${search.location} ${search.country}`.trim();
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryType"
    },
    body: JSON.stringify({
      textQuery,
      languageCode: search.language || "it",
      maxResultCount: Math.min(20, Number(search.requested_limit || 10))
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    return [];
  }
  return (payload.places || [])
    .filter((place) => place.websiteUri)
    .map((place) => ({
      title: place.displayName && place.displayName.text ? place.displayName.text : place.websiteUri,
      link: place.websiteUri,
      snippet: place.formattedAddress || "",
      placeId: place.id,
      phone: place.nationalPhoneNumber || "",
      category: place.primaryType || ""
    }));
}

async function osmAreaId(search) {
  const options = parseJson(search.provider_query_json, {});
  if (options.targetQuery && !requiredText(search.location)) {
    return "";
  }
  const query = [requiredText(search.location), requiredText(search.country || "Italia")].filter(Boolean).join(", ");
  if (!query) {
    return "";
  }
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      return "";
    }
    const [place] = await response.json();
    if (!place || !place.osm_type || !place.osm_id) {
      return "";
    }
    if (place.osm_type === "relation") {
      return String(3600000000 + Number(place.osm_id));
    }
    if (place.osm_type === "way") {
      return String(2400000000 + Number(place.osm_id));
    }
    return "";
  } catch (error) {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function osmSectorClauses(search) {
  const sector = normalizeSearchText(search.sector);
  const catalog = [
    { match: /palestr|fitness|gym/, clauses: ['["leisure"="fitness_centre"]', '["sport"~"fitness|gymnastics",i]', '["name"~"palestr|fitness|gym",i]'] },
    { match: /ristorant|trattori|pizzeri|food/, clauses: ['["amenity"~"restaurant|fast_food|food_court",i]', '["cuisine"]', '["name"~"ristorant|trattori|pizzeri",i]'] },
    { match: /\bbar\b|cafe|caffe|pub/, clauses: ['["amenity"~"bar|cafe|pub",i]', '["name"~"bar|cafe|caffe|pub",i]'] },
    { match: /hotel|albergh|b&b|bed and breakfast/, clauses: ['["tourism"~"hotel|guest_house|hostel|apartment",i]', '["name"~"hotel|albergo|b&b|bed and breakfast",i]'] },
    { match: /immobiliar|agenzi.*casa|real estate/, clauses: ['["office"="estate_agent"]', '["shop"="estate_agent"]', '["name"~"immobiliar|real estate|casa",i]'] },
    { match: /dentist|dentist|odontoiatr/, clauses: ['["amenity"="dentist"]', '["healthcare"="dentist"]', '["name"~"dentist|odontoiatr",i]'] },
    { match: /medic|clinic|studio medico/, clauses: ['["amenity"~"clinic|doctors",i]', '["healthcare"~"clinic|doctor",i]', '["name"~"clinic|studio medico|medic",i]'] },
    { match: /avvocat|legal|studio legale/, clauses: ['["office"="lawyer"]', '["name"~"avvocat|studio legale|legal",i]'] },
    { match: /commercialist|contabil|account/, clauses: ['["office"~"accountant|tax_advisor",i]', '["name"~"commercialist|contabil|account",i]'] },
    { match: /parrucchier|hair|barber/, clauses: ['["shop"~"hairdresser|beauty",i]', '["name"~"parrucchier|barber|hair",i]'] },
    { match: /estetic|beauty|spa/, clauses: ['["shop"~"beauty|massage",i]', '["leisure"="spa"]', '["name"~"estetic|beauty|spa",i]'] },
    { match: /farmaci|parafarmaci/, clauses: ['["amenity"="pharmacy"]', '["shop"="chemist"]', '["name"~"farmaci|parafarmaci",i]'] },
    { match: /scuol|formazione|academy|corso/, clauses: ['["amenity"~"school|college|university|language_school",i]', '["office"="educational_institution"]', '["name"~"scuol|academy|formazione|corso",i]'] },
    { match: /agenzi.*viaggi|travel/, clauses: ['["shop"="travel_agency"]', '["office"="travel_agent"]', '["name"~"viaggi|travel",i]'] },
    { match: /meccanic|auto|carrozzeri|officina/, clauses: ['["shop"~"car_repair|car|tyres",i]', '["craft"~"car_repair|mechanic",i]', '["name"~"officina|meccanic|carrozzeri",i]'] }
  ];
  const found = catalog.find((item) => item.match.test(sector));
  if (found) {
    return found.clauses;
  }
  const words = sector
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
    .slice(0, 4);
  if (!words.length) {
    return ['["website"]', '["contact:website"]', '["email"]', '["contact:email"]'];
  }
  return [`["name"~"${words.join("|")}",i]`];
}

function osmElementUrl(item) {
  const type = item.type === "node" ? "node" : item.type === "way" ? "way" : "relation";
  return `https://www.openstreetmap.org/${type}/${item.id}`;
}

function osmWebsite(tags = {}) {
  const value = requiredText(tags.website || tags["contact:website"] || tags.url);
  if (!value) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol).toString();
  } catch (error) {
    return "";
  }
}

function osmDirectEmails(tags = {}) {
  return Array.from(
    new Set(
      [tags.email, tags["contact:email"]]
        .flatMap((value) => String(value || "").split(/[;, ]+/))
        .map(normalizeEmail)
        .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    )
  );
}

async function openStreetMapSearch(search) {
  const options = parseJson(search.provider_query_json, {});
  if (options.targetQuery && !requiredText(search.location)) {
    return [];
  }
  const clauses = osmSectorClauses(search);
  const location = requiredText(search.location);
  const areaName = requiredText(location || search.country || "Italia").replace(/[\\"]/g, " ");
  const areaId = await osmAreaId(search);
  const bodyClauses = clauses
    .map(
      (clause) => `
        nwr(area.searchArea)${clause};
      `
    )
    .join("");
  const query = `
    [out:json][timeout:25];
    ${areaId ? `area(${areaId})->.searchArea;` : `area["name"~"^${areaName}$",i]["boundary"="administrative"]->.searchArea;`}
    (
      ${bodyClauses}
    );
    out tags center ${Math.min(25, Math.max(10, Number(search.requested_limit || 10) * 2))};
  `;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      },
      body: new URLSearchParams({ data: query }).toString()
    });
    if (!response.ok) {
      throw new Error(`OpenStreetMap non disponibile HTTP ${response.status}`);
    }
    const payload = await response.json();
    const results = [];
    for (const item of payload.elements || []) {
      const tags = item.tags || {};
      const website = osmWebsite(tags);
      const directEmails = osmDirectEmails(tags);
      if (!website && !directEmails.length) {
        continue;
      }
      const sourceUrl = osmElementUrl(item);
      const title = requiredText(tags.name || tags.operator || tags.brand || sourceUrl);
      if (results.find((existing) => existing.sourceUrl === sourceUrl || (website && existing.website === website))) {
        continue;
      }
      results.push({
        title,
        link: website || sourceUrl,
        website,
        sourceUrl,
        snippet: requiredText(tags["addr:full"] || [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]].filter(Boolean).join(" ")),
        phone: requiredText(tags.phone || tags["contact:phone"]),
        category: requiredText(tags.amenity || tags.shop || tags.office || tags.leisure || tags.tourism || search.sector),
        osmId: `${item.type}/${item.id}`,
        directEmails,
        provider: "openstreetmap"
      });
      if (results.length >= Number(search.requested_limit || 10)) {
        break;
      }
    }
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanOfficialSite(websiteUrl) {
  if (!(await robotsAllowed(websiteUrl))) {
    return { pages: 0, emails: [] };
  }
  const homeHtml = await fetchText(websiteUrl);
  const urls = [new URL(websiteUrl).toString(), ...extractLinks(websiteUrl, homeHtml)].slice(0, MAX_PAGES_PER_DOMAIN);
  const emails = [];
  for (const url of urls) {
    let html = url === urls[0] ? homeHtml : "";
    if (!html) {
      try {
        html = await fetchText(url);
      } catch (error) {
        continue;
      }
    }
    const title = extractTitle(html);
    const text = cleanHtmlText(html);
    for (const email of extractEmails(html)) {
      emails.push({
        email,
        sourceUrl: url,
        sourceTitle: title,
        context: text.slice(Math.max(0, text.toLowerCase().indexOf(email.toLowerCase()) - 160), 360)
      });
    }
  }
  return { pages: urls.length, emails };
}

async function startSearch(searchId, userId) {
  const search = await db.get("SELECT * FROM outreach_searches WHERE id = ?", [searchId]);
  if (!search) {
    throw new Error("Ricerca non trovata");
  }
  await db.run(
    "UPDATE outreach_searches SET status = 'processing', started_at = ?, error_message = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nowIso(), searchId]
  );
  try {
    let webResults = [];
    let places = [];
    let osmResults = [];
    const providerErrors = [];
    try {
      webResults = await googleCseSearch(search);
    } catch (error) {
      providerErrors.push(normalizeSearchProviderError(error.message));
    }
    if (!webResults.length) {
      try {
        webResults = await bingSearch(search);
      } catch (error) {
        providerErrors.push(`Bing: ${normalizeSearchProviderError(error.message)}`);
      }
    }
    try {
      places = await googlePlacesSearch(search);
    } catch (error) {
      providerErrors.push(`Google Places: ${normalizeSearchProviderError(error.message)}`);
    }
    try {
      osmResults = await openStreetMapSearch(search);
    } catch (error) {
      providerErrors.push(`OpenStreetMap: ${normalizeSearchProviderError(error.message)}`);
    }
    if (!webResults.length && !places.length && !osmResults.length && providerErrors.length) {
      throw new Error(providerErrors.join(" | "));
    }
    const combined = [...places, ...webResults, ...osmResults].slice(0, Number(search.requested_limit || 10));
    let websitesScanned = 0;
    let emailsFound = 0;
    let accepted = 0;
    let rejected = 0;
    let listId = null;
    const options = parseJson(search.provider_query_json, {});
    if (options.createList) {
      listId = await db.insert("outreach_lists", {
        name: [search.sector, search.location].filter(Boolean).join(" - ") || search.query,
        description: `Lista creata dalla ricerca ${search.id}`,
        created_by_user_id: userId || search.created_by_user_id || null,
        contact_count: 0,
        status: "active"
      });
    }
    for (const result of combined) {
      let websiteUrl = "";
      let officialUrl = result.website || result.link;
      try {
        websiteUrl = officialUrl ? new URL(officialUrl).origin : "";
      } catch (error) {
        websiteUrl = "";
      }
      const businessId = await db.insert("outreach_businesses", {
        search_id: searchId,
        business_name: requiredText(result.title).slice(0, 180),
        category: result.category || search.sector,
        address: result.snippet || "",
        city: search.location,
        province: "",
        country: search.country,
        phone: result.phone || "",
        website_url: websiteUrl,
        google_place_id: result.placeId || null,
        source_provider: result.provider || (result.placeId ? "google_places" : "google_cse"),
        source_url: result.sourceUrl || result.link,
        status: "active"
      });
      for (const email of result.directEmails || []) {
        if (emailsFound >= search.requested_limit) {
          break;
        }
        const saved = await insertContact({
          businessId,
          searchId,
          email,
          sourceUrl: result.sourceUrl || result.link,
          sourceTitle: result.title,
          context: "Email pubblicata nei dati OpenStreetMap dell attivita"
        });
        if (saved.inserted) {
          emailsFound += 1;
          accepted += 1;
          if (listId) {
            await addContactToList(listId, saved.id, userId);
          }
        } else if (saved.reason !== "duplicate") {
          rejected += 1;
        }
      }
      if (!websiteUrl) {
        continue;
      }
      try {
        const scan = await scanOfficialSite(websiteUrl);
        websitesScanned += 1;
        for (const found of scan.emails) {
          if (emailsFound >= search.requested_limit) {
            break;
          }
          const saved = await insertContact({
            businessId,
            searchId,
            email: found.email,
            sourceUrl: found.sourceUrl,
            sourceTitle: found.sourceTitle,
            context: found.context
          });
          if (saved.inserted) {
            emailsFound += 1;
            accepted += 1;
            if (listId) {
              await addContactToList(listId, saved.id, userId);
            }
          } else if (saved.reason !== "duplicate") {
            rejected += 1;
          }
        }
      } catch (error) {
        rejected += 1;
      }
      if (emailsFound >= search.requested_limit) {
        break;
      }
    }
    await db.run(
      `UPDATE outreach_searches
       SET status = 'completed', results_found = ?, websites_scanned = ?, emails_found = ?, emails_accepted = ?,
           emails_rejected = ?, error_message = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        combined.length,
        websitesScanned,
        emailsFound,
        accepted,
        rejected,
        "",
        nowIso(),
        searchId
      ]
    );
    await logAction(userId, "outreach.search.completed", "outreach_search", searchId, { emailsFound });
    return db.get("SELECT * FROM outreach_searches WHERE id = ?", [searchId]);
  } catch (error) {
    await db.run(
      "UPDATE outreach_searches SET status = 'failed', error_message = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [error.message, nowIso(), searchId]
    );
    await logAction(userId, "outreach.search.failed", "outreach_search", searchId, { error: error.message });
    return db.get("SELECT * FROM outreach_searches WHERE id = ?", [searchId]);
  }
}

async function addContactToList(listId, contactId, userId) {
  const existing = await db.get("SELECT id FROM outreach_list_contacts WHERE list_id = ? AND contact_id = ?", [
    listId,
    contactId
  ]);
  if (!existing) {
    await db.insert("outreach_list_contacts", {
      list_id: listId,
      contact_id: contactId,
      added_by_user_id: userId || null
    });
  }
  const count = await db.get("SELECT COUNT(*) AS total FROM outreach_list_contacts WHERE list_id = ?", [listId]);
  await db.run("UPDATE outreach_lists SET contact_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    Number(count.total || 0),
    listId
  ]);
}

async function approveContact(contactId, userId, body = {}) {
  const note = requiredText(body.legal_basis_note);
  if (!note || !toBool(body.confirm_authorization)) {
    throw new Error("Nota e conferma autorizzazione sono obbligatorie");
  }
  await db.run(
    `UPDATE outreach_contacts
     SET approval_status = 'approved', legal_basis_note = ?, consent_reference = ?, approved_by_user_id = ?,
         approved_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [note, requiredText(body.consent_reference), userId || null, nowIso(), contactId]
  );
  await logAction(userId, "outreach.contact.approved", "outreach_contact", contactId, { note });
}

async function rejectContact(contactId, userId, reason = "") {
  await db.run(
    "UPDATE outreach_contacts SET approval_status = 'rejected', legal_basis_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [requiredText(reason), contactId]
  );
  await logAction(userId, "outreach.contact.rejected", "outreach_contact", contactId, { reason });
}

function sanitizeTemplateHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+=["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<img[^>]+display\s*:\s*none[^>]*>/gi, "");
}

function renderTemplate(text, variables) {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => variables[key] || "");
}

function outreachConfig() {
  return {
    enabled: toBool(process.env.OUTREACH_ENABLED),
    smtpHost: requiredText(process.env.OUTREACH_SMTP_HOST),
    smtpPort: toInt(process.env.OUTREACH_SMTP_PORT, 465),
    smtpSecure: toBool(process.env.OUTREACH_SMTP_SECURE || "true"),
    smtpUser: requiredText(process.env.OUTREACH_SMTP_USER || "service@creatorspeakertv.it"),
    smtpPassConfigured: Boolean(requiredText(process.env.OUTREACH_SMTP_PASS)),
    fromEmail: requiredText(process.env.OUTREACH_FROM_EMAIL || "service@creatorspeakertv.it"),
    fromName: requiredText(process.env.OUTREACH_FROM_NAME || "CreatorSpeaker TV"),
    replyTo: requiredText(process.env.OUTREACH_REPLY_TO || "service@creatorspeakertv.it"),
    dailyLimit: toInt(process.env.OUTREACH_DAILY_LIMIT, 100),
    minDelaySeconds: Math.max(45, toInt(process.env.OUTREACH_MIN_DELAY_SECONDS, 45)),
    domain: requiredText(process.env.OUTREACH_DOMAIN || "creatorspeakertv.it"),
    dkimSelector: requiredText(process.env.OUTREACH_DKIM_SELECTOR),
    privacyUrl: requiredText(process.env.OUTREACH_PRIVACY_URL || "https://www.creatorspeakertv.it/privacy"),
    baseUrl: requiredText(process.env.OUTREACH_BASE_URL || "https://www.creatorspeakertv.it")
  };
}

function createTransport() {
  const config = outreachConfig();
  if (!config.smtpHost || !config.smtpPassConfigured) {
    throw new Error("SMTP outreach non configurato");
  }
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    requireTLS: !config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: process.env.OUTREACH_SMTP_PASS
    }
  });
}

async function verifySmtpAndSendTest(toEmail) {
  const config = outreachConfig();
  const recipient = normalizeEmail(toEmail);
  if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    throw new Error("Email test non valida");
  }
  const transport = createTransport();
  await transport.verify();
  await transport.sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to: recipient,
    replyTo: config.replyTo,
    subject: "Test SMTP outreach CreatorSpeaker TV",
    text: "Test configurazione SMTP outreach completato",
    html: "<p>Test configurazione SMTP outreach completato</p>"
  });
}

async function createCampaign(payload, userId) {
  const listId = toInt(payload.list_id);
  const templateId = toInt(payload.template_id);
  const template = await db.get("SELECT * FROM outreach_email_templates WHERE id = ? AND status = 'active'", [templateId]);
  const list = await db.get("SELECT * FROM outreach_lists WHERE id = ? AND status = 'active'", [listId]);
  if (!template || !list) {
    throw new Error("Lista o modello non valido");
  }
  const config = outreachConfig();
  const contacts = await db.all(
    `SELECT outreach_contacts.*
     FROM outreach_list_contacts
     JOIN outreach_contacts ON outreach_contacts.id = outreach_list_contacts.contact_id
     WHERE outreach_list_contacts.list_id = ? AND outreach_contacts.approval_status = 'approved'
     ORDER BY outreach_contacts.id ASC
     LIMIT 100`,
    [listId]
  );
  const campaignId = await db.insert("outreach_campaigns", {
    name: requiredText(payload.name) || `Campagna ${list.name}`,
    template_id: templateId,
    list_id: listId,
    from_email: config.fromEmail,
    from_name: config.fromName,
    reply_to: config.replyTo,
    subject_override: requiredText(payload.subject_override),
    status: contacts.length ? "ready" : "draft",
    recipient_count: contacts.length,
    approved_recipient_count: contacts.length,
    daily_limit: Math.min(config.dailyLimit, toInt(payload.daily_limit, config.dailyLimit)),
    delay_seconds: Math.max(config.minDelaySeconds, toInt(payload.delay_seconds, config.minDelaySeconds)),
    scheduled_at: requiredText(payload.scheduled_at) || null,
    created_by_user_id: userId || null,
    approved_by_admin_id: null
  });
  for (const contact of contacts) {
    if (await isSuppressed(contact.normalized_email)) {
      continue;
    }
    await db.insert("outreach_campaign_recipients", {
      campaign_id: campaignId,
      contact_id: contact.id,
      email: contact.normalized_email,
      status: "pending",
      personalization_json: JSON.stringify({
        business_name: "",
        category: contact.contact_type,
        city: "",
        website: "",
        recipient_email: contact.normalized_email
      })
    });
  }
  await logAction(userId, "outreach.campaign.created", "outreach_campaign", campaignId, { recipients: contacts.length });
  return campaignId;
}

async function queueCampaign(campaignId, userId) {
  const config = outreachConfig();
  if (!config.enabled) {
    throw new Error("OUTREACH_ENABLED e disattivato");
  }
  await db.run(
    "UPDATE outreach_campaigns SET status = 'queued', approved_by_admin_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('ready','paused')",
    [userId || null, campaignId]
  );
  await db.run(
    "UPDATE outreach_campaign_recipients SET status = 'queued', queued_at = ? WHERE campaign_id = ? AND status = 'pending'",
    [nowIso(), campaignId]
  );
  await logAction(userId, "outreach.campaign.queued", "outreach_campaign", campaignId, {});
}

async function buildUnsubscribeToken(contactId, campaignId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert("outreach_unsubscribe_tokens", {
    contact_id: contactId,
    campaign_id: campaignId,
    token_hash: hashToken(token),
    used_at: null,
    expires_at: null
  });
  return token;
}

async function processQueueOnce() {
  const config = outreachConfig();
  if (!config.enabled) {
    return { processed: false, reason: "disabled" };
  }
  const sentToday = await db.get(
    "SELECT COUNT(*) AS total FROM outreach_campaign_recipients WHERE status = 'sent' AND sent_at >= ?",
    [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
  );
  if (Number(sentToday.total || 0) >= config.dailyLimit) {
    return { processed: false, reason: "daily_limit" };
  }
  const recipient = await db.get(
    `SELECT r.*, c.normalized_email, c.approval_status, c.contact_type, c.source_url, t.subject, t.html_body, t.text_body,
            camp.subject_override, camp.from_email, camp.from_name, camp.reply_to, camp.id AS campaign_id
     FROM outreach_campaign_recipients r
     JOIN outreach_campaigns camp ON camp.id = r.campaign_id
     JOIN outreach_contacts c ON c.id = r.contact_id
     JOIN outreach_email_templates t ON t.id = camp.template_id
     WHERE r.status = 'queued' AND camp.status IN ('queued','sending')
     ORDER BY r.queued_at ASC, r.id ASC
     LIMIT 1`
  );
  if (!recipient) {
    return { processed: false, reason: "empty" };
  }
  if (recipient.approval_status !== "approved" || (await isSuppressed(recipient.normalized_email))) {
    await db.run("UPDATE outreach_campaign_recipients SET status = 'suppressed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      recipient.id
    ]);
    return { processed: true, reason: "suppressed" };
  }
  const token = await buildUnsubscribeToken(recipient.contact_id, recipient.campaign_id);
  const unsubscribeUrl = `${config.baseUrl.replace(/\/$/, "")}/outreach/unsubscribe/${token}`;
  const variables = {
    business_name: "azienda",
    category: recipient.contact_type,
    city: "",
    website: recipient.source_url,
    recipient_email: recipient.normalized_email,
    sender_name: recipient.from_name || config.fromName,
    unsubscribe_url: unsubscribeUrl,
    privacy_url: config.privacyUrl
  };
  const subject = renderTemplate(recipient.subject_override || recipient.subject, variables);
  const html = `${renderTemplate(sanitizeTemplateHtml(recipient.html_body), variables)}<p>Ricevi questa comunicazione da CreatorSpeaker TV. Puoi rispondere direttamente a questa email oppure richiedere di non ricevere ulteriori comunicazioni utilizzando il link seguente: ${unsubscribeUrl}</p>`;
  const text = `${renderTemplate(recipient.text_body, variables)}\n\nRicevi questa comunicazione da CreatorSpeaker TV. Puoi rispondere direttamente a questa email oppure richiedere di non ricevere ulteriori comunicazioni utilizzando il link seguente: ${unsubscribeUrl}`;
  const transport = createTransport();
  try {
    await db.run("UPDATE outreach_campaign_recipients SET status = 'sending', attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [recipient.id]);
    const info = await transport.sendMail({
      from: `"${recipient.from_name || config.fromName}" <${recipient.from_email || config.fromEmail}>`,
      to: recipient.normalized_email,
      replyTo: recipient.reply_to || config.replyTo,
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      }
    });
    await db.run(
      "UPDATE outreach_campaign_recipients SET status = 'sent', message_id = ?, smtp_response = ?, sent_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [info.messageId || "", String(info.response || "").slice(0, 500), nowIso(), recipient.id]
    );
    await db.run(
      "UPDATE outreach_contacts SET last_contacted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nowIso(), recipient.contact_id]
    );
    await db.run(
      "UPDATE outreach_campaigns SET status = 'sending', sent_count = sent_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [recipient.campaign_id]
    );
    return { processed: true, reason: "sent" };
  } catch (error) {
    const finalStatus = Number(recipient.attempt_count || 0) >= 2 ? "failed" : "queued";
    await db.run(
      "UPDATE outreach_campaign_recipients SET status = ?, error_message = ?, failed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [finalStatus, error.message.slice(0, 500), finalStatus === "failed" ? nowIso() : null, recipient.id]
    );
    return { processed: true, reason: "smtp_error" };
  }
}

async function unsubscribe(token) {
  const tokenHash = hashToken(token);
  const row = await db.get(
    `SELECT outreach_unsubscribe_tokens.*, outreach_contacts.normalized_email, outreach_contacts.email
     FROM outreach_unsubscribe_tokens
     JOIN outreach_contacts ON outreach_contacts.id = outreach_unsubscribe_tokens.contact_id
     WHERE token_hash = ?`,
    [tokenHash]
  );
  if (!row) {
    return false;
  }
  await db.run("UPDATE outreach_unsubscribe_tokens SET used_at = ? WHERE id = ?", [nowIso(), row.id]);
  const existing = await db.get("SELECT id FROM outreach_suppression_list WHERE normalized_email = ?", [row.normalized_email]);
  if (!existing) {
    await db.insert("outreach_suppression_list", {
      email: row.email || row.normalized_email,
      normalized_email: row.normalized_email,
      reason: "unsubscribe",
      source: "public_unsubscribe",
      created_by_user_id: null
    });
  }
  await db.run(
    "UPDATE outreach_campaign_recipients SET status = 'unsubscribed', updated_at = CURRENT_TIMESTAMP WHERE contact_id = ? AND status IN ('pending','queued')",
    [row.contact_id]
  );
  return true;
}

async function dnsStatus() {
  const config = outreachConfig();
  const domain = config.domain;
  const result = {
    mx: { status: "NON VERIFICATO", records: [] },
    spf: { status: "NON VERIFICATO", record: "" },
    dmarc: { status: "NON VERIFICATO", record: "" },
    dkim: { status: config.dkimSelector ? "NON VERIFICATO" : "MANCANTE", record: "" }
  };
  try {
    result.mx.records = (await dns.resolveMx(domain)).map((item) => item.exchange);
    result.mx.status = result.mx.records.length ? "PASS" : "MANCANTE";
  } catch (error) {
    result.mx.status = "MANCANTE";
  }
  try {
    const txt = (await dns.resolveTxt(domain)).map((row) => row.join(""));
    result.spf.record = txt.find((row) => row.startsWith("v=spf1")) || "";
    result.spf.status = result.spf.record ? "PASS" : "MANCANTE";
  } catch (error) {
    result.spf.status = "MANCANTE";
  }
  try {
    const txt = (await dns.resolveTxt(`_dmarc.${domain}`)).map((row) => row.join(""));
    result.dmarc.record = txt.find((row) => row.startsWith("v=DMARC1")) || "";
    result.dmarc.status = result.dmarc.record ? "PASS" : "MANCANTE";
  } catch (error) {
    result.dmarc.status = "MANCANTE";
  }
  if (config.dkimSelector) {
    try {
      const txt = (await dns.resolveTxt(`${config.dkimSelector}._domainkey.${domain}`)).map((row) => row.join(""));
      result.dkim.record = txt[0] || "";
      result.dkim.status = result.dkim.record ? "PASS" : "MANCANTE";
    } catch (error) {
      result.dkim.status = "MANCANTE";
    }
  }
  return result;
}

async function dashboard() {
  const rows = await Promise.all([
    db.get("SELECT COUNT(*) AS total FROM outreach_searches WHERE status = 'completed'"),
    db.get("SELECT COUNT(*) AS total FROM outreach_contacts"),
    db.get("SELECT COUNT(*) AS total FROM outreach_contacts WHERE approval_status = 'approved'"),
    db.get("SELECT COUNT(*) AS total FROM outreach_lists WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS total FROM outreach_campaigns WHERE status IN ('draft','ready','queued','sending')"),
    db.get("SELECT COUNT(*) AS total FROM outreach_campaign_recipients WHERE status = 'sent' AND sent_at >= ?", [
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    ]),
    db.get("SELECT COUNT(*) AS total FROM outreach_campaign_recipients WHERE status = 'failed'"),
    db.get("SELECT COUNT(*) AS total FROM outreach_suppression_list WHERE reason = 'unsubscribe'")
  ]);
  const config = outreachConfig();
  return {
    searchesCompleted: Number(rows[0].total || 0),
    contactsTotal: Number(rows[1].total || 0),
    contactsApproved: Number(rows[2].total || 0),
    listsActive: Number(rows[3].total || 0),
    campaignsOpen: Number(rows[4].total || 0),
    sentToday: Number(rows[5].total || 0),
    sendErrors: Number(rows[6].total || 0),
    unsubscribes: Number(rows[7].total || 0),
    dailyLimit: config.dailyLimit,
    smtpConfigured: Boolean(config.smtpHost && config.smtpPassConfigured),
    moduleEnabled: config.enabled
  };
}

module.exports = {
  MAX_RESULTS,
  MAX_PAGES_PER_DOMAIN,
  USER_AGENT,
  normalizeEmail,
  classifyEmail,
  assertSafeUrl,
  sanitizeTemplateHtml,
  outreachConfig,
  maskSecret,
  createSearch,
  openStreetMapSearch,
  startSearch,
  insertContact,
  addContactToList,
  approveContact,
  rejectContact,
  createCampaign,
  queueCampaign,
  processQueueOnce,
  verifySmtpAndSendTest,
  unsubscribe,
  dnsStatus,
  dashboard,
  logAction
};
