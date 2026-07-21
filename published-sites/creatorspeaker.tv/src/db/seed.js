const bcrypt = require("bcrypt");

const db = require(".");
const { slugify } = require("../utils/slug");
const { stringifyJson } = require("../utils/safeJson");
const { DEFAULT_STAFF_PERMISSIONS } = require("../middleware/adminOnly");

const packageSeeds = [
  {
    area: "creator_video",
    name: "CREATOR START",
    price_cents: 9900,
    billing_type: "monthly",
    description: "Pacchetto iniziale per creator video che vogliono entrare nel network.",
    features: [
      "2 puntate video al mese",
      "Durata massima 15 minuti",
      "Distribuzione nel network TV",
      "Presenza su Smart TV",
      "Presenza su App e Web TV",
      "Pagina personale",
      "2 ore/mese registrazione audio gratuite",
      "Canva incluso",
      "Regia virtuale inclusa fino a 2 ore/mese",
      "1 comunicato/notizia al mese",
      "1 base musicale originale"
    ]
  },
  {
    area: "creator_video",
    name: "CREATOR PRO",
    price_cents: 19900,
    billing_type: "monthly",
    description: "Maggiore frequenza, newsletter e strumenti professionali per i creator più strutturati.",
    features: [
      "4 puntate video al mese",
      "Durata massima 15 minuti",
      "Distribuzione TV",
      "Smart TV",
      "App e Web TV",
      "Newsletter del network",
      "2 comunicati/notizie al mese",
      "2 ore/mese registrazione audio gratuite",
      "Canva incluso",
      "Regia virtuale a consumo",
      "1 base musicale originale"
    ]
  },
  {
    area: "speaker_podcast",
    name: "SPEAKER START",
    price_cents: 8900,
    billing_type: "monthly",
    description: "Per podcaster, speaker e divulgatori con una produzione audio costante.",
    features: [
      "2 puntate audio al mese",
      "Distribuzione radio",
      "Pubblicazione podcast",
      "Pagina personale",
      "2 ore/mese registrazione audio gratuite",
      "Canva incluso",
      "Regia virtuale inclusa",
      "1 comunicato/notizia al mese",
      "1 base musicale originale"
    ]
  },
  {
    area: "speaker_podcast",
    name: "SPEAKER PRO",
    price_cents: 14900,
    billing_type: "monthly",
    description: "Più episodi, conversione video per Smart TV e archivio completo.",
    features: [
      "4 puntate audio al mese",
      "Distribuzione radio",
      "Podcast",
      "Conversione audio/video per Smart TV",
      "Anteprima TV da 3 a 10 minuti",
      "Archivio completo",
      "Newsletter del network",
      "2 comunicati/notizie al mese",
      "2 ore/mese registrazione audio gratuite",
      "Canva incluso",
      "Regia virtuale a consumo",
      "1 base musicale originale"
    ]
  },
  {
    area: "aziende",
    name: "Spazio della Settimana",
    price_cents: 14800,
    billing_type: "one_time",
    description: "Slot promozionale per attività e professionisti nel palinsesto.",
    features: ["Interviste professionali", "Presenza su App e Web TV", "Distribuzione social"]
  },
  {
    area: "aziende",
    name: "Spazio della Settimana Plus",
    price_cents: 33300,
    billing_type: "one_time",
    description: "Formato esteso con visibilità maggiore e supporto editoriale.",
    features: ["Pubblicità TV", "Banner web", "Distribuzione social", "Speakeraggio professionale"]
  },
  {
    area: "aziende",
    name: "4 Video TV",
    price_cents: 122200,
    billing_type: "one_time",
    description: "Pacchetto editoriale con quattro produzioni TV.",
    features: ["4 video TV", "Presenza Smart TV", "Distribuzione TV", "Web TV e App"]
  },
  {
    area: "aziende",
    name: "Intervista Premium",
    price_cents: 99800,
    billing_type: "one_time",
    description: "Intervista professionale con taglio premium e distribuzione multi-canale.",
    features: ["Intervista professionale", "Distribuzione TV", "App e Web TV", "Pubblicazione social"]
  },
  {
    area: "aziende",
    name: "Banner TV",
    price_cents: 9800,
    billing_type: "one_time",
    description: "Banner promozionale per slot televisivi.",
    features: ["Creatività base", "Presenza TV", "Adattamento brand"]
  },
  {
    area: "aziende",
    name: "Banner Web",
    price_cents: 11100,
    billing_type: "one_time",
    description: "Banner digitali per sito, blog e newsletter del network.",
    features: ["Creatività base", "Pubblicazione web", "Distribuzione newsletter"]
  },
  {
    area: "produttori_brand",
    name: "BRAND START",
    price_cents: 0,
    billing_type: "one_time",
    description: "Pacchetto in definizione per brand e progetti editoriali.",
    features: ["Prezzo in definizione", "Richiesta informazioni dal form interno"]
  },
  {
    area: "produttori_brand",
    name: "BRAND PRO",
    price_cents: 0,
    billing_type: "one_time",
    description: "Soluzione evoluta in definizione per brand e produttori.",
    features: ["Prezzo in definizione", "Richiesta informazioni dal form interno"]
  },
  {
    area: "produttori_brand",
    name: "FORMAT PREMIUM",
    price_cents: 0,
    billing_type: "one_time",
    description: "Percorso premium per format e distribuzione su più canali.",
    features: ["Prezzo in definizione", "Richiesta informazioni dal form interno"]
  },
  {
    area: "caricamenti",
    name: "1 caricamento",
    price_cents: 1500,
    billing_type: "usage",
    description: "Gestione contenuto da parte dello staff.",
    features: ["1 caricamento", "+ IVA"]
  },
  {
    area: "caricamenti",
    name: "2 caricamenti",
    price_cents: 2500,
    billing_type: "usage",
    description: "Gestione contenuti da parte dello staff.",
    features: ["2 caricamenti", "+ IVA"]
  },
  {
    area: "caricamenti",
    name: "4 caricamenti",
    price_cents: 4000,
    billing_type: "usage",
    description: "Gestione contenuti da parte dello staff.",
    features: ["4 caricamenti", "+ IVA"]
  },
  {
    area: "caricamenti",
    name: "8 caricamenti",
    price_cents: 7500,
    billing_type: "usage",
    description: "Gestione contenuti da parte dello staff.",
    features: ["8 caricamenti", "+ IVA"]
  },
  {
    area: "caricamenti",
    name: "16 caricamenti",
    price_cents: 14000,
    billing_type: "usage",
    description: "Gestione contenuti da parte dello staff.",
    features: ["16 caricamenti", "+ IVA"]
  },
  {
    area: "caricamenti",
    name: "32 caricamenti",
    price_cents: 16000,
    billing_type: "usage",
    description: "Gestione contenuti da parte dello staff.",
    features: ["32 caricamenti", "+ IVA"]
  }
];

const extraServices = [
  "Comunicati stampa",
  "Articoli",
  "Interviste",
  "Grafica",
  "Locandine",
  "Banner",
  "Miniature",
  "Montaggio video",
  "Montaggio audio",
  "Reel e Shorts",
  "Speakeraggio",
  "Consulenze",
  "Pubblicazione libri",
  "Pubblicazione musicale"
].map((name, index) => ({
  area: "extra",
  name,
  price_cents: (index + 4) * 1500,
  billing_type: "one_time",
  description: `${name} come servizio extra acquistabile dal carrello o dal pannello utente.`,
  features: ["Servizio extra", "Gestione manuale da admin"]
}));

const categorySeeds = [
  { name: "Smartphone", active: 1, keywords: ["smartphone", "android", "iphone"], sort_order: 1 },
  { name: "Accessori smartphone", active: 1, keywords: ["cover", "powerbank", "magsafe"], sort_order: 2 },
  { name: "Tecnologia generale", active: 1, keywords: ["tech", "gadget"], sort_order: 3 },
  { name: "Computer", active: 1, keywords: ["notebook", "desktop", "monitor"], sort_order: 4 },
  { name: "Tablet", active: 1, keywords: ["tablet", "ipad"], sort_order: 5 },
  { name: "Smartwatch", active: 1, keywords: ["smartwatch", "fitness"], sort_order: 6 },
  { name: "Cuffie e audio", active: 1, keywords: ["earbuds", "cuffie", "speaker"], sort_order: 7 },
  { name: "Casa smart", active: 1, keywords: ["smart home", "domotica"], sort_order: 8 },
  { name: "Piccoli elettrodomestici", active: 0, keywords: ["friggitrice", "aspirapolvere"], sort_order: 9 },
  { name: "Libri", active: 0, keywords: ["libri tech", "offerte libri"], sort_order: 10 },
  { name: "Orologi", active: 0, keywords: ["watch", "orologi"], sort_order: 11 },
  { name: "Accessori auto", active: 0, keywords: ["dash cam", "car charger"], sort_order: 12 },
  { name: "Accessori moto", active: 0, keywords: ["helmet bluetooth", "moto"], sort_order: 13 },
  { name: "Gaming", active: 0, keywords: ["console", "controller"], sort_order: 14 },
  { name: "TV", active: 0, keywords: ["smart tv", "oled"], sort_order: 15 },
  { name: "Altre categorie", active: 0, keywords: ["offerte varie"], sort_order: 16 }
];

function defaultSettings() {
  return {
    site: {
      name: process.env.SITE_NAME || "creatorspeaker TV",
      claim: "Creator & Speaker Network",
      logo: "/assets/brand/creatorspeaker-brand-emblem.jpg",
      colors: {
        bg: "#070812",
        panel: "#101322",
        accent: "#7C3AED",
        accent2: "#E50914",
        gold: "#FFD166",
        cyan: "#23D5FF"
      }
    },
    bank: {
      holder: process.env.BANK_ACCOUNT_HOLDER || "CreatorSpeaker TV",
      iban: process.env.BANK_IBAN || "INSERIRE-IBAN-REALE-DA-PANNELLO-ADMIN",
      causalPrefix: process.env.BANK_CAUSAL_PREFIX || "Ordine creatorspeaker TV",
      adminNote: "Attivazione entro 5 giorni lavorativi dalla verifica del bonifico."
    },
    legal: {
      privacy:
        "Titolare del trattamento\nCreatorSpeaker TV tratta dati raccolti tramite registrazione, form contatti, richieste di attivazione, ordini, caricamenti, area riservata e gestione operativa della piattaforma\n\nDati trattati\nPossiamo trattare dati identificativi e di contatto, credenziali account, richieste inviate, contenuti caricati, log tecnici, indirizzo IP, dati di navigazione essenziali e informazioni necessarie alla gestione dei servizi richiesti\n\nFinalita\nI dati sono trattati per creare e gestire account, rispondere alle richieste, attivare servizi, gestire contenuti, inviare comunicazioni operative, recuperare password, prevenire abusi, proteggere form e sessioni, adempiere a obblighi di legge e gestire verifiche amministrative o pagamenti\n\nPagamenti\nPer bonifico, PayPal e Stripe possono essere trattati dati necessari alla richiesta, alla verifica del pagamento, alla fatturazione e alla corretta attivazione del servizio. I dati completi di carte o strumenti di pagamento non vengono salvati direttamente dalla piattaforma quando il pagamento avviene tramite provider esterni\n\nDiritti e contatti\nL'interessato puo chiedere accesso, rettifica, cancellazione, limitazione, opposizione e portabilita nei limiti previsti dal GDPR scrivendo a info@creatorspeakertv.it",
      cookie:
        "Cookie e strumenti tecnici\nIl sito utilizza cookie tecnici e di sessione necessari ad autenticazione, sicurezza, continuita di navigazione, protezione dei form, salvataggio temporaneo del riepilogo richiesta e funzionamento dell'area riservata\n\nSicurezza dei form\nLa piattaforma puo usare token anti CSRF, controlli anti bot, honeypot, limiti di invio e log tecnici per ridurre spam, form injection, invii automatici e uso improprio delle richieste\n\nCookie opzionali\nEventuali strumenti statistici, marketing, profilazione, tracciamento avanzato o integrazioni terze che richiedano consenso non vengono attivati automaticamente",
      terms:
        "Oggetto del servizio\nCreatorSpeaker TV offre servizi editoriali, multimediali, gestione contenuti, area riservata, strumenti operativi, richieste di attivazione, caricamenti, supporto alla pubblicazione e percorsi collegati alla piattaforma\n\nRegistrazione e accesso\nL'utente deve fornire dati veritieri, mantenere riservate le credenziali e usare il servizio in modo lecito, corretto e coerente con la finalita della piattaforma\n\nContenuti caricati\nL'utente garantisce di avere diritti, autorizzazioni e responsabilita sui materiali caricati, inclusi testi, immagini, audio, video, loghi, brani, grafiche e documenti. Non sono ammessi contenuti illeciti, lesivi di diritti altrui, diffamatori, violenti, discriminatori, ingannevoli o contrari alla normativa applicabile\n\nPagamenti e attivazione\nBonifico, PayPal e Stripe possono essere previsti come metodi di pagamento. L'attivazione effettiva dei servizi puo dipendere da verifica amministrativa, conferma del pagamento, disponibilita tecnica e completamento delle configurazioni operative necessarie\n\nAccessi digitali condivisi\nGli accessi digitali collegati a strumenti o piattaforme esterne sono personali, temporanei e revocabili in caso di uso improprio, condivisione non autorizzata o mancato rispetto delle istruzioni"
    },
    telegram: {
      enabled: String(process.env.TELEGRAM_ENABLED || "false") === "true",
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      channelId: process.env.TELEGRAM_CHANNEL_ID || "",
      channelLogo: "/assets/brand/creatorspeaker-brand-emblem.jpg",
      frequencyMinutes: 120,
      dailyLimit: 4,
      messageFormat: "standard"
    },
    facebook: {
      enabled: String(process.env.FACEBOOK_ENABLED || "false") === "true",
      pageUrl: process.env.FACEBOOK_PAGE_URL || "",
      pageId: process.env.FACEBOOK_PAGE_ID || "",
      accessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "",
      postTime1: "07:00",
      postTime2: "19:00",
      minHoursDistance: 12
    },
    amazon: {
      provider: process.env.AMAZON_PROVIDER || "demo",
      associateTag: process.env.AMAZON_ASSOCIATE_TAG || "",
      trackingId: process.env.AMAZON_TRACKING_ID || "",
      marketplace: process.env.AMAZON_MARKETPLACE || "IT",
      credentialId: process.env.AMAZON_API_CREDENTIAL_ID || "",
      credentialSecret: process.env.AMAZON_API_CREDENTIAL_SECRET || "",
      region: process.env.AMAZON_API_REGION || "EU"
    },
    offer_settings: {
      schedulerEnabled: true,
      searchFrequencyMinutes: 60,
      telegramFrequencyMinutes: 120,
      minDiscountPercent: 10,
      minScore: 55,
      lastSearchAt: null,
      lastTelegramAt: null,
      lastDailyOfferAt: null,
      lastFacebookOfferAt: null
    },
    video_credit_costs: {
      semplice: 3,
      elegante: 3,
      "podcast cover": 5,
      "promo social": 8
    },
    growth_strategy: [
      "Gruppi Facebook dedicati alle offerte dove consentito",
      "Pagina Facebook",
      "Gruppi Telegram di amici",
      "Reels sulle offerte",
      "TikTok offerte tech",
      "Instagram offerte tech",
      "Condivisioni nei gruppi consentiti",
      "SEO tramite sito web",
      "Newsletter futura"
    ]
  };
}

const demoOffers = [
  {
    title: "Samsung Galaxy S25 256GB",
    categorySlug: "smartphone",
    current_price_cents: 64900,
    normal_price_cents: 89900,
    product_url: "https://www.amazon.it/dp/demo-s25",
    affiliate_url: "https://www.amazon.it/dp/demo-s25?tag=creatorspeakerdemo-21",
    image_url: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9",
    prime_available: 1,
    source: "demo",
    status: "approved"
  },
  {
    title: "Cuffie wireless ANC Pro",
    categorySlug: "cuffie-e-audio",
    current_price_cents: 7990,
    normal_price_cents: 12990,
    product_url: "https://www.amazon.it/dp/demo-anc",
    affiliate_url: "https://www.amazon.it/dp/demo-anc?tag=creatorspeakerdemo-21",
    image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e",
    prime_available: 1,
    source: "demo",
    status: "published_telegram"
  },
  {
    title: "Tablet Studio 11",
    categorySlug: "tablet",
    current_price_cents: 28900,
    normal_price_cents: 39900,
    product_url: "https://www.amazon.it/dp/demo-tablet11",
    affiliate_url: "https://www.amazon.it/dp/demo-tablet11?tag=creatorspeakerdemo-21",
    image_url: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0",
    prime_available: 0,
    source: "demo",
    status: "approved"
  }
];

async function seedAdmin() {
  const username = process.env.ADMIN_INITIAL_USERNAME || "admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD || "CreatorSpeakerTV!2026-ChangeMe";
  const existing = await db.get("SELECT id FROM admins WHERE username = ?", [username]);
  if (existing) {
    await db.run(
      "UPDATE admins SET display_name = COALESCE(NULLIF(display_name, ''), ?), role = COALESCE(NULLIF(role, ''), 'admin'), status = COALESCE(NULLIF(status, ''), 'active'), permissions_json = CASE WHEN permissions_json IS NULL OR permissions_json = '' THEN ? ELSE permissions_json END, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
      ["Admin principale", stringifyJson(DEFAULT_STAFF_PERMISSIONS), username]
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert("admins", {
    username,
    display_name: "Admin principale",
    role: "admin",
    status: "active",
    permissions_json: stringifyJson(DEFAULT_STAFF_PERMISSIONS),
    password_hash: passwordHash,
    must_change_password: db.meta.driver === "pg" ? true : 1
  });
}

async function seedStaffAccounts() {
  const defaults = [
    {
      username: process.env.STAFF_INITIAL_USERNAME_1 || "staff1",
      displayName: "Staff 1",
      password: process.env.STAFF_INITIAL_PASSWORD_1 || "CreatorStaff1!2026-ChangeMe"
    },
    {
      username: process.env.STAFF_INITIAL_USERNAME_2 || "staff2",
      displayName: "Staff 2",
      password: process.env.STAFF_INITIAL_PASSWORD_2 || "CreatorStaff2!2026-ChangeMe"
    }
  ];

  for (const item of defaults) {
    const existing = await db.get("SELECT id FROM admins WHERE username = ?", [item.username]);
    if (existing) {
      await db.run(
        "UPDATE admins SET display_name = ?, role = 'staff', status = COALESCE(NULLIF(status, ''), 'active'), permissions_json = CASE WHEN permissions_json IS NULL OR permissions_json = '' THEN ? ELSE permissions_json END, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
        [item.displayName, stringifyJson(DEFAULT_STAFF_PERMISSIONS), item.username]
      );
      continue;
    }

    const passwordHash = await bcrypt.hash(item.password, 10);
    await db.insert("admins", {
      username: item.username,
      display_name: item.displayName,
      role: "staff",
      status: "active",
      permissions_json: stringifyJson(DEFAULT_STAFF_PERMISSIONS),
      password_hash: passwordHash,
      must_change_password: db.meta.driver === "pg" ? true : 1
    });
  }
}

async function seedPackages() {
  const seeds = [...packageSeeds, ...extraServices];
  for (const item of seeds) {
    const slug = slugify(item.name);
    const existing = await db.get("SELECT id FROM packages WHERE slug = ?", [slug]);
    if (existing) {
      continue;
    }
    await db.insert("packages", {
      area: item.area,
      name: item.name,
      slug,
      price_cents: item.price_cents,
      billing_type: item.billing_type,
      description: item.description,
      features_json: stringifyJson(item.features),
      active: db.meta.driver === "pg" ? true : 1,
      sort_order: seeds.indexOf(item) + 1
    });
  }
}

async function seedCategories() {
  for (const category of categorySeeds) {
    const slug = slugify(category.name);
    const existing = await db.get("SELECT id FROM categories WHERE slug = ?", [slug]);
    if (existing) {
      continue;
    }
    await db.insert("categories", {
      name: category.name,
      slug,
      active: db.meta.driver === "pg" ? Boolean(category.active) : category.active,
      amazon_keywords_json: stringifyJson({
        keywords: category.keywords,
        minDiscountPercent: 10,
        minPriceCents: 1000,
        maxPriceCents: 300000,
        minScore: 55
      }),
      sort_order: category.sort_order
    });
  }
}

async function seedSettings() {
  const settings = defaultSettings();
  for (const [key, value] of Object.entries(settings)) {
    const existing = await db.get("SELECT key FROM settings WHERE key = ?", [key]);
    if (!existing) {
      await db.setSetting(key, value);
    }
  }
}

async function seedDemoUser() {
  const existing = await db.get("SELECT id FROM users WHERE email = ?", ["demo@creatorspeaker.local"]);
  if (existing) {
    return;
  }
  const passwordHash = await bcrypt.hash("DemoUser!2026", 10);
  await db.insert("users", {
    name: "Demo Creator",
    email: "demo@creatorspeaker.local",
    password_hash: passwordHash,
    status: "active",
    credits: 12
  });
}

async function seedOffers() {
  for (const offer of demoOffers) {
    const existing = await db.get("SELECT id FROM offers WHERE title = ?", [offer.title]);
    if (existing) {
      continue;
    }
    const category = await db.get("SELECT id FROM categories WHERE slug = ?", [offer.categorySlug]);
    const discountPercent = offer.normal_price_cents
      ? Math.round(((offer.normal_price_cents - offer.current_price_cents) / offer.normal_price_cents) * 100)
      : 0;
    await db.insert("offers", {
      source: offer.source,
      category_id: category ? category.id : null,
      title: offer.title,
      asin: null,
      image_url: offer.image_url,
      product_url: offer.product_url,
      affiliate_url: offer.affiliate_url,
      normal_price_cents: offer.normal_price_cents,
      current_price_cents: offer.current_price_cents,
      discount_percent: discountPercent,
      prime_available: db.meta.driver === "pg" ? Boolean(offer.prime_available) : offer.prime_available,
      score: 78 + discountPercent / 2,
      status: offer.status
    });
  }
}

async function seedSubscriptionPlatforms() {
  const existing = await db.get("SELECT id FROM subscription_platforms WHERE slug = ?", ["canva"]);
  if (existing) {
    return;
  }
  await db.insert("subscription_platforms", {
    name: "Canva",
    slug: "canva",
    description:
      "Strumento per creare grafiche, contenuti social, presentazioni e materiali visivi",
    public_description:
      "Accesso Canva disponibile dopo richiesta, verifica pagamento e attivazione manuale admin",
    status: "active",
    max_users: 25,
    active_users_count: 0,
    price_per_user: 0,
    currency: "EUR",
    duration_days: 30,
    platform_url: "https://www.canva.com",
    login_url: "https://www.canva.com/login",
    shared_login_email_encrypted: "",
    shared_login_password_encrypted: "",
    admin_private_notes_encrypted: "",
    user_visible_instructions:
      "Apri Canva, usa le credenziali mostrate in dashboard e non condividerle con terzi"
  });
}

async function seedServicePackages() {
  const existing = await db.get("SELECT id FROM service_packages LIMIT 1");
  if (existing) {
    return;
  }
  const rows = await db.all("SELECT * FROM packages ORDER BY sort_order ASC, id ASC");
  const categoryMap = {
    creator_video: "creator",
    speaker_podcast: "speaker",
    aziende: "azienda",
    produttori_brand: "custom",
    extra: "custom",
    caricamenti: "custom"
  };
  for (const row of rows) {
    await db.insert("service_packages", {
      title: row.name,
      slug: row.slug,
      category: categoryMap[row.area] || "custom",
      short_description: row.description,
      long_description: row.description,
      price: row.price_cents,
      currency: "EUR",
      billing_type: row.billing_type,
      features_json: row.features_json || "[]",
      media_asset_id: null,
      status: row.active ? "active" : "hidden",
      is_featured: db.meta.driver === "pg" ? false : 0,
      sort_order: row.sort_order,
      cta_label: row.area === "aziende" ? "Richiedi informazioni" : "Richiedi attivazione"
    });
  }
}

async function seedIfNeeded() {
  await seedAdmin();
  await seedStaffAccounts();
  await seedPackages();
  await seedCategories();
  await seedSettings();
  await seedDemoUser();
  await seedOffers();
  await seedSubscriptionPlatforms();
  await seedServicePackages();
}

if (require.main === module) {
  db.initialize()
    .then(() => seedIfNeeded())
    .then(() => {
      console.log("Seed completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  seedIfNeeded
};
