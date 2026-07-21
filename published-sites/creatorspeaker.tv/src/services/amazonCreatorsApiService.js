const db = require("../db");
const { requiredText } = require("../utils/validators");

const DOCS_URL = "https://affiliate-program.amazon.com/creatorsapi/docs/";
const DEMO_MARKETPLACE = "www.amazon.it";

const demoCatalog = {
  smartphone: [
    ["Samsung Galaxy S25", "DEMOS250001", 64900, 89900, "Samsung", 4.6, 1240],
    ["Motorola Edge Fusion", "DEMOMOTO002", 32900, 44900, "Motorola", 4.3, 460],
    ["Nothing Phone Neo", "DEMONOTH003", 29900, 37900, "Nothing", 4.2, 311]
  ],
  "accessori-smartphone": [
    ["Powerbank Magnetico 10000mAh", "DEMOPOWB004", 2990, 4590, "Volt", 4.4, 820],
    ["Caricatore GaN 65W", "DEMOGAN6005", 2490, 3990, "ChargePro", 4.5, 1410]
  ],
  "tecnologia-generale": [
    ["Hub USB-C Creator Dock", "DEMOHUBC006", 3490, 5990, "CreatorDock", 4.4, 350],
    ["SSD Portatile 1TB", "DEMOSSD1007", 7990, 11990, "FastStore", 4.7, 2050]
  ],
  computer: [
    ["Notebook Creator 15", "DEMONOTE008", 79900, 109900, "CreatorBook", 4.5, 274],
    ["Monitor 27 QHD", "DEMOMONI009", 17900, 25900, "ViewLab", 4.4, 512]
  ],
  tablet: [
    ["Tablet Studio 11", "DEMOTABL010", 28900, 39900, "StudioTab", 4.3, 333],
    ["Tablet Mini Pro", "DEMOMINI011", 21900, 29900, "MiniTech", 4.1, 119]
  ],
  smartwatch: [
    ["Smartwatch Pulse Sport", "DEMOWATC012", 8990, 14990, "Pulse", 4.2, 945],
    ["Smartwatch Urban LTE", "DEMOURBA013", 15900, 21900, "Urban", 4.0, 410]
  ],
  "cuffie-e-audio": [
    ["Cuffie ANC Pro", "DEMOANCP014", 7990, 12990, "AudioLab", 4.6, 2410],
    ["Speaker Bluetooth Lounge", "DEMOSPKR015", 4990, 7990, "Lounge", 4.4, 566]
  ],
  "casa-smart": [
    ["Lampada Smart WiFi", "DEMOLAMP016", 1990, 3490, "BrightHome", 4.2, 772],
    ["Robot Vacuum Lite", "DEMOROBO017", 15900, 24900, "HomeBot", 4.1, 286]
  ]
};

function discountPercent(referencePrice, currentPrice) {
  if (!referencePrice || !currentPrice || referencePrice <= currentPrice) {
    return 0;
  }
  return Math.round(((referencePrice - currentPrice) / referencePrice) * 100);
}

function amazonHostForMarketplace(marketplace) {
  const host = requiredText(marketplace || DEMO_MARKETPLACE);
  return host.startsWith("http") ? new URL(host).host : host.replace(/^www\./, "www.");
}

function buildAffiliateUrl(product) {
  const base = requiredText(product.affiliateUrl || product.detailPageUrl || product.productUrl);
  const tag = requiredText(product.associateTag);
  if (!base || !tag) {
    return base;
  }
  const url = new URL(base);
  if (!/amazon\./i.test(url.hostname)) {
    return base;
  }
  url.searchParams.set("tag", tag);
  return url.toString();
}

async function getConfig() {
  const modeRow = await db.get("SELECT value FROM affiliate_settings WHERE key = ?", ["affiliate_mode"]);
  const modeSetting = String(modeRow ? modeRow.value : "configuration");
  return {
    mode: process.env.AFFILIATE_AMAZON_MODE || modeSetting,
    endpoint: requiredText(process.env.AMAZON_CREATORS_API_ENDPOINT),
    credentialId: requiredText(process.env.AMAZON_CREATORS_API_CREDENTIAL_ID),
    credentialSecret: requiredText(process.env.AMAZON_CREATORS_API_CREDENTIAL_SECRET),
    associateTag: requiredText(process.env.AMAZON_ASSOCIATE_TAG),
    marketplace: requiredText(process.env.AMAZON_MARKETPLACE || DEMO_MARKETPLACE),
    marketplaceId: requiredText(process.env.AMAZON_MARKETPLACE_ID),
    defaultCurrency: requiredText(process.env.AMAZON_DEFAULT_CURRENCY || "EUR")
  };
}

function normalizeProduct(rawProduct, context = {}) {
  const marketplace = requiredText(rawProduct.marketplace || context.marketplace || DEMO_MARKETPLACE);
  const asin = requiredText(rawProduct.asin || rawProduct.amazonAsin || rawProduct.id);
  const detailPageUrl = requiredText(rawProduct.detailPageUrl || rawProduct.productUrl);
  const currentPrice = Number(rawProduct.currentPrice || rawProduct.current_price || 0);
  const referencePrice = Number(rawProduct.referencePrice || rawProduct.reference_price || rawProduct.listPrice || 0);
  const associateTag = requiredText(rawProduct.associateTag || context.associateTag);
  return {
    amazonAsin: asin,
    marketplace,
    title: requiredText(rawProduct.title),
    brand: requiredText(rawProduct.brand),
    categoryId: context.categoryId || null,
    productUrl: detailPageUrl,
    detailPageUrl,
    affiliateUrl: buildAffiliateUrl({
      affiliateUrl: requiredText(rawProduct.affiliateUrl),
      detailPageUrl,
      associateTag
    }),
    imageUrl: requiredText(rawProduct.imageUrl || rawProduct.image_url),
    currency: requiredText(rawProduct.currency || context.defaultCurrency || "EUR"),
    availability: requiredText(rawProduct.availability || "unknown"),
    primeEligible: Boolean(rawProduct.primeEligible),
    rating: rawProduct.rating ? Number(rawProduct.rating) : null,
    reviewCount: Number(rawProduct.reviewCount || 0),
    currentPrice: Number.isFinite(currentPrice) ? Math.round(currentPrice) : 0,
    referencePrice: Number.isFinite(referencePrice) ? Math.round(referencePrice) : null,
    discountPercent: discountPercent(referencePrice, currentPrice),
    observedAt: new Date().toISOString(),
    source: context.source || "amazon_creators_api"
  };
}

function extractOfferData(product) {
  const normalized = normalizeProduct(product);
  return {
    currentPrice: normalized.currentPrice,
    referencePrice: normalized.referencePrice,
    discountPercent: normalized.discountPercent,
    currency: normalized.currency,
    availability: normalized.availability,
    primeEligible: normalized.primeEligible
  };
}

function buildDemoProducts(category, config, page = 1) {
  const rows = demoCatalog[category.slug] || [];
  return rows.map((item, index) =>
    normalizeProduct(
      {
        asin: item[1],
        title: item[0],
        currentPrice: item[2],
        referencePrice: item[3],
        brand: item[4],
        rating: item[5],
        reviewCount: item[6],
        primeEligible: index % 2 === 0,
        availability: "in_stock",
        imageUrl: `https://images.amazon.com/images/P/${item[1]}.jpg`,
        detailPageUrl: `https://${amazonHostForMarketplace(config.marketplace)}/dp/${item[1]}`
      },
      {
        categoryId: category.id,
        associateTag: config.associateTag || "creatorspeakerdemo-21",
        marketplace: config.marketplace || DEMO_MARKETPLACE,
        defaultCurrency: config.defaultCurrency || "EUR",
        source: "demo"
      }
    )
  );
}

async function searchProducts(category, keywords, page = 1) {
  const config = await getConfig();
  if (config.mode === "demo") {
    return buildDemoProducts(category, config, page);
  }
  if (config.mode !== "live") {
    return [];
  }
  if (!config.endpoint || !config.credentialId || !config.credentialSecret || !config.associateTag) {
    throw new Error("Configurazione Creators API incompleta");
  }
  throw new Error(
    "Creators API pronta a livello architetturale ma endpoint operativo da confermare nel tuo account Amazon Associates"
  );
}

async function getProductDetails(productIds = []) {
  const config = await getConfig();
  if (config.mode === "demo") {
    return productIds.map((asin) =>
      normalizeProduct(
        {
          asin,
          title: `Prodotto demo ${asin}`,
          currentPrice: 4990,
          referencePrice: 7990,
          brand: "Demo",
          rating: 4.2,
          reviewCount: 120,
          primeEligible: true,
          availability: "in_stock",
          imageUrl: `https://images.amazon.com/images/P/${asin}.jpg`,
          detailPageUrl: `https://${amazonHostForMarketplace(config.marketplace)}/dp/${asin}`
        },
        {
          associateTag: config.associateTag || "creatorspeakerdemo-21",
          marketplace: config.marketplace || DEMO_MARKETPLACE,
          defaultCurrency: config.defaultCurrency || "EUR",
          source: "demo"
        }
      )
    );
  }
  if (config.mode !== "live") {
    return [];
  }
  throw new Error(
    "Dettagli prodotto Creators API pronti a livello architetturale ma endpoint operativo da confermare nel tuo account Amazon Associates"
  );
}

async function testConnection() {
  const config = await getConfig();
  if (config.mode === "demo") {
    return {
      ok: true,
      mode: "demo",
      docsUrl: DOCS_URL,
      message: "Modalita demo attiva. Nessuna chiamata reale ad Amazon eseguita."
    };
  }
  if (!config.credentialId || !config.credentialSecret || !config.associateTag) {
    return {
      ok: false,
      mode: config.mode,
      docsUrl: DOCS_URL,
      message: "Mancano credenziali Creators API o tag affiliato Amazon"
    };
  }
  if (!config.endpoint) {
    return {
      ok: false,
      mode: config.mode,
      docsUrl: DOCS_URL,
      message: "Endpoint Creators API non configurato"
    };
  }
  return {
    ok: false,
    mode: config.mode,
    docsUrl: DOCS_URL,
    message:
      "Credenziali presenti. Prima di abilitare il live serve confermare l endpoint effettivo e il mapping operativo del tuo account Creators API."
  };
}

module.exports = {
  DOCS_URL,
  getConfig,
  testConnection,
  searchProducts,
  getProductDetails,
  normalizeProduct,
  buildAffiliateUrl,
  extractOfferData
};
