const db = require("../db");
const { parseJson } = require("../utils/safeJson");
const { computeDiscount, computeOfferScore } = require("./offerScoringService");

const DISCLOSURE =
  "Alcuni link possono essere affiliati: il progetto puo ricevere una commissione sugli acquisti idonei, senza costi aggiuntivi per l'utente.";

const demoCatalog = {
  smartphone: [
    ["Samsung Galaxy S25", 64900, 89900],
    ["Motorola Edge Fusion", 32900, 44900],
    ["Nothing Phone Neo", 29900, 37900]
  ],
  "accessori-smartphone": [
    ["Powerbank Magnetico 10000mAh", 2990, 4590],
    ["Caricatore GaN 65W", 2490, 3990]
  ],
  "tecnologia-generale": [
    ["Hub USB-C Creator Dock", 3490, 5990],
    ["SSD Portatile 1TB", 7990, 11990]
  ],
  computer: [
    ["Notebook Creator 15", 79900, 109900],
    ["Monitor 27 QHD", 17900, 25900]
  ],
  tablet: [
    ["Tablet Studio 11", 28900, 39900],
    ["Tablet Mini Pro", 21900, 29900]
  ],
  smartwatch: [
    ["Smartwatch Pulse Sport", 8990, 14990],
    ["Smartwatch Urban LTE", 15900, 21900]
  ],
  "cuffie-e-audio": [
    ["Cuffie ANC Pro", 7990, 12990],
    ["Speaker Bluetooth Lounge", 4990, 7990]
  ],
  "casa-smart": [
    ["Lampada Smart WiFi", 1990, 3490],
    ["Robot Vacuum Lite", 15900, 24900]
  ]
};

function getAffiliateLink(productUrl, tag) {
  if (!productUrl || !tag) {
    return productUrl;
  }
  const separator = productUrl.includes("?") ? "&" : "?";
  return `${productUrl}${separator}tag=${encodeURIComponent(tag)}`;
}

async function getConfig() {
  const stored = (await db.getSetting("amazon", {})) || {};
  return {
    provider: process.env.AMAZON_PROVIDER || stored.provider || "demo",
    associateTag: process.env.AMAZON_ASSOCIATE_TAG || stored.associateTag || "",
    trackingId: process.env.AMAZON_TRACKING_ID || stored.trackingId || "",
    marketplace: process.env.AMAZON_MARKETPLACE || stored.marketplace || "IT",
    credentialId: process.env.AMAZON_API_CREDENTIAL_ID || stored.credentialId || "",
    credentialSecret: process.env.AMAZON_API_CREDENTIAL_SECRET || stored.credentialSecret || "",
    region: process.env.AMAZON_API_REGION || stored.region || "EU"
  };
}

async function getActiveCategories() {
  const rows = await db.all("SELECT * FROM categories WHERE active = ? ORDER BY sort_order ASC", [
    db.meta.driver === "pg" ? true : 1
  ]);
  return rows.map((row) => ({
    ...row,
    meta: parseJson(row.amazon_keywords_json, {})
  }));
}

function buildDemoOffers(categories, associateTag) {
  return categories.flatMap((category) => {
    const catalog = demoCatalog[category.slug] || [];
    return catalog.map(([title, current, normal], index) => {
      const productUrl = `https://www.amazon.it/dp/demo-${category.slug}-${index + 1}`;
      return {
        source: "demo",
        category_id: category.id,
        title,
        asin: null,
        image_url: "",
        product_url: productUrl,
        affiliate_url: getAffiliateLink(productUrl, associateTag || "creatorspeakerdemo-21"),
        normal_price_cents: normal,
        current_price_cents: current,
        discount_percent: computeDiscount(normal, current),
        prime_available: index % 2 === 0,
        score: computeOfferScore(
          {
            normal_price_cents: normal,
            current_price_cents: current,
            prime_available: index % 2 === 0
          },
          10
        ),
        status: "discovered"
      };
    });
  });
}

async function discoverOffers() {
  const config = await getConfig();
  const categories = await getActiveCategories();

  if (config.provider === "manual") {
    const rows = await db.all("SELECT * FROM offers WHERE source = 'manual' ORDER BY created_at DESC LIMIT 50");
    return {
      ok: true,
      provider: "manual",
      offers: rows,
      message: "Provider manuale attivo."
    };
  }

  if (config.provider === "amazon_api_ready") {
    if (!config.credentialId || !config.credentialSecret) {
      return {
        ok: true,
        provider: "amazon_api_ready",
        offers: buildDemoOffers(categories, config.associateTag),
        message: "Amazon API non configurata: uso modalita demo/manuale."
      };
    }

    return {
      ok: true,
      provider: "amazon_api_ready",
      offers: [],
      message:
        "Struttura Amazon API pronta ma integrazione reale non attivata in questa prima versione senza endpoint ufficiali configurati."
    };
  }

  return {
    ok: true,
    provider: "demo",
    offers: buildDemoOffers(categories, config.associateTag),
    message: "Offerte demo generate correttamente."
  };
}

async function syncOffers() {
  const result = await discoverOffers();
  let inserted = 0;
  for (const offer of result.offers) {
    const duplicate = await db.get(
      "SELECT id FROM offers WHERE title = ? OR product_url = ? OR affiliate_url = ?",
      [offer.title, offer.product_url, offer.affiliate_url]
    );
    if (duplicate) {
      continue;
    }

    await db.insert("offers", {
      source: offer.source,
      category_id: offer.category_id,
      title: offer.title,
      asin: offer.asin,
      image_url: offer.image_url,
      product_url: offer.product_url,
      affiliate_url: offer.affiliate_url,
      normal_price_cents: offer.normal_price_cents,
      current_price_cents: offer.current_price_cents,
      discount_percent: offer.discount_percent,
      prime_available: db.meta.driver === "pg" ? Boolean(offer.prime_available) : Number(offer.prime_available),
      score: offer.score,
      status: offer.status
    });
    inserted += 1;
  }

  return {
    ...result,
    inserted
  };
}

async function testConnection() {
  const config = await getConfig();
  if (config.provider === "amazon_api_ready" && config.credentialId && config.credentialSecret) {
    return {
      ok: true,
      message: "Credenziali presenti. Integrare endpoint ufficiale Amazon quando disponibile."
    };
  }

  return {
    ok: true,
    message: "Modalita demo/manuale attiva. Nessuna chiamata esterna eseguita."
  };
}

module.exports = {
  DISCLOSURE,
  getConfig,
  discoverOffers,
  syncOffers,
  testConnection
};
