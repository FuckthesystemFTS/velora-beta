const express = require("express");

const db = require("../db");
const { isEmail, requiredText } = require("../utils/validators");
const { parseJson } = require("../utils/safeJson");
const { getSiteSettings, getPackagesByArea, renderPublicPage } = require("../utils/viewHelpers");
const { createOrder } = require("../services/orderService");
const { DISCLOSURE } = require("../services/amazonService");
const cmsService = require("../services/cmsService");

const router = express.Router();
const SITE_URL = (process.env.SITE_URL || `https://${process.env.CANONICAL_HOST || "www.creatorspeakertv.it"}`).replace(/\/$/, "");
const SITEMAP_ROUTES = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/network", priority: "0.95", changefreq: "weekly" },
  { path: "/creator-network", priority: "0.9", changefreq: "weekly" },
  { path: "/speaker-network", priority: "0.9", changefreq: "weekly" },
  { path: "/aziende-brand", priority: "0.9", changefreq: "weekly" },
  { path: "/smart-tv", priority: "0.9", changefreq: "weekly" },
  { path: "/servizi", priority: "0.85", changefreq: "weekly" },
  { path: "/percorsi", priority: "0.9", changefreq: "weekly" },
  { path: "/pubblicare-video-musicale", priority: "0.86", changefreq: "weekly" },
  { path: "/pubblicare-podcast-online", priority: "0.84", changefreq: "weekly" },
  { path: "/visibilita-azienda-smart-tv", priority: "0.84", changefreq: "weekly" },
  { path: "/chi-siamo", priority: "0.8", changefreq: "monthly" },
  { path: "/contatti", priority: "0.8", changefreq: "monthly" },
  { path: "/richiedi-informazioni", priority: "0.8", changefreq: "monthly" },
  { path: "/offerte", priority: "0.55", changefreq: "weekly" },
  { path: "/mappa-sito", priority: "0.45", changefreq: "monthly" },
  { path: "/abbonamenti", priority: "0.7", changefreq: "weekly" },
  { path: "/abbonamenti/canva", priority: "0.7", changefreq: "weekly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/cookie", priority: "0.3", changefreq: "yearly" },
  { path: "/termini", priority: "0.3", changefreq: "yearly" },
  { path: "/legal", priority: "0.25", changefreq: "yearly" }
];

function buildPage(title, eyebrow, intro, sections, options = {}) {
  return {
    title,
    eyebrow,
    intro,
    sections,
    ...options
  };
}

function defaultPrivacyText(contactEmail) {
  return [
    "Titolare del trattamento",
    `CreatorSpeaker TV tratta i dati personali raccolti tramite registrazione, form contatti, richieste di attivazione, ordini, caricamenti, area riservata e gestione operativa della piattaforma. Per richieste privacy puoi scrivere a ${contactEmail}`,
    "",
    "Dati trattati",
    "Possiamo trattare dati identificativi e di contatto, credenziali account, dati amministrativi, richieste inviate, contenuti caricati, log tecnici, indirizzo IP, dati di navigazione essenziali, preferenze operative e informazioni necessarie alla gestione dei servizi richiesti",
    "",
    "Finalita e base giuridica",
    "I dati sono trattati per creare e gestire account, rispondere alle richieste, attivare servizi, gestire contenuti e caricamenti, inviare comunicazioni operative, recuperare password, prevenire abusi, proteggere form e sessioni, adempiere a obblighi di legge e gestire verifiche amministrative o pagamenti",
    "",
    "Pagamenti",
    "Per bonifico, PayPal e Stripe possono essere trattati dati necessari alla richiesta, alla verifica del pagamento, alla fatturazione e alla corretta attivazione del servizio. I dati completi di carte o strumenti di pagamento non vengono salvati direttamente dalla piattaforma quando il pagamento avviene tramite provider esterni",
    "",
    "Contenuti caricati",
    "I materiali inviati dall'utente possono essere conservati e trattati per revisione, pubblicazione, assistenza tecnica, produzione editoriale, distribuzione e gestione delle richieste collegate",
    "",
    "Conservazione",
    "I dati vengono conservati per il tempo necessario alla gestione del rapporto, alla sicurezza della piattaforma, alla continuita dei servizi, agli obblighi civilistici, fiscali o probatori applicabili e alla tutela da usi impropri",
    "",
    "Diritti dell'interessato",
    "L'interessato puo chiedere accesso, rettifica, cancellazione, limitazione, opposizione e portabilita nei limiti previsti dal GDPR, oltre a proporre reclamo all'autorita competente",
    "",
    "Soggetti coinvolti",
    "I dati possono essere trattati da fornitori tecnici necessari al funzionamento della piattaforma, hosting, database, posta elettronica, storage, pagamenti, sicurezza, analytics tecnici e strumenti operativi attivati dal titolare, nei limiti delle rispettive funzioni",
    "",
    "Gestione dei dati tecnici degli accessi",
    "I dati tecnici e riservati relativi agli accessi digitali vengono gestiti con misure di sicurezza e cifratura lato server. Gli utenti autorizzati possono visualizzare credenziali solo dopo attivazione manuale. Ogni visualizzazione puo essere registrata per ragioni di sicurezza, controllo accessi e gestione operativa"
  ].join("\n\n");
}

function defaultCookieText() {
  return [
    "Cookie e strumenti tecnici",
    "Il sito utilizza cookie tecnici e di sessione necessari ad autenticazione, sicurezza, continuita di navigazione, protezione dei form, salvataggio temporaneo del riepilogo richiesta e funzionamento dell'area riservata",
    "",
    "Cookie che non richiedono consenso",
    "I cookie strettamente necessari al funzionamento del servizio non richiedono consenso preventivo secondo il quadro normativo europeo e le linee guida del Garante quando sono usati solo per finalita tecniche",
    "",
    "Sicurezza dei form",
    "La piattaforma puo usare token anti CSRF, controlli anti bot, honeypot, limiti di invio e log tecnici per ridurre spam, form injection, invii automatici e uso improprio delle richieste",
    "",
    "Cookie opzionali",
    "Eventuali strumenti statistici, marketing, profilazione, tracciamento avanzato o integrazioni terze che richiedano consenso non vengono attivati automaticamente in questa configurazione",
    "",
    "Gestione preferenze",
    "Se in futuro verranno introdotti cookie o tecnologie non tecniche, il sito dovra raccogliere il consenso prima dell'attivazione e permettere all'utente di modificarlo o revocarlo facilmente"
  ].join("\n\n");
}

function defaultTermsText(contactEmail) {
  return [
    "Oggetto del servizio",
    "CreatorSpeaker TV offre servizi editoriali, multimediali, gestione contenuti, area riservata, strumenti operativi, richieste di attivazione, caricamenti, supporto alla pubblicazione e percorsi collegati alla piattaforma",
    "",
    "Registrazione e accesso",
    "L'utente deve fornire dati veritieri, mantenere riservate le credenziali, aggiornare le informazioni quando necessario e usare il servizio in modo lecito, corretto e coerente con la finalita della piattaforma",
    "",
    "Contenuti caricati",
    "L'utente garantisce di avere diritti, autorizzazioni e responsabilita sui materiali caricati, inclusi testi, immagini, audio, video, loghi, brani, grafiche e documenti. Non sono ammessi contenuti illeciti, lesivi di diritti altrui, diffamatori, violenti, discriminatori, ingannevoli o contrari alla normativa applicabile",
    "",
    "Pagamenti e attivazione",
    "Bonifico, PayPal e Stripe possono essere previsti come metodi di pagamento. L'attivazione effettiva dei servizi puo dipendere da verifica amministrativa, conferma del pagamento, disponibilita tecnica e completamento delle configurazioni operative necessarie",
    "",
    "Pubblicazione e distribuzione",
    "La pubblicazione di contenuti puo richiedere revisione, adattamenti tecnici, approvazione editoriale e rispetto dei formati richiesti. La piattaforma puo rifiutare o sospendere materiali non conformi, incompleti o rischiosi",
    "",
    "Accessi digitali condivisi",
    "CreatorSpeaker TV puo mettere a disposizione degli utenti autorizzati accessi digitali collegati a strumenti, servizi o piattaforme esterne. L'attivazione avviene solo dopo richiesta, verifica e approvazione manuale. Gli accessi sono personali, temporanei e revocabili in caso di uso improprio, condivisione non autorizzata, mancato rispetto delle istruzioni o violazione delle condizioni previste. L'utente si impegna a non condividere credenziali, accessi, link o materiali riservati con terzi",
    "",
    "Sospensione e tutela",
    "La piattaforma puo sospendere o limitare accessi e funzioni in presenza di abusi, rischio tecnico, violazioni contrattuali, usi illeciti o esigenze di sicurezza",
    "",
    "Assistenza",
    `Per chiarimenti operativi o contrattuali puoi contattare il team tramite ${contactEmail}`
  ].join("\n\n");
}

function enrichPackage(item, description, ctaLabel = "Richiedi attivazione") {
  return {
    ...item,
    longDescription: description,
    ctaLabel
  };
}

function buildPercorsi(packagesByArea) {
  return {
    creator: (packagesByArea.creator_video || []).map((item) =>
      enrichPackage(
        item,
        item.name.includes("PRO")
          ? "Pensato per chi vuole uscire dalla pubblicazione occasionale e costruire una presenza video piu costante, ordinata e riconoscibile"
          : "Pensato per chi vuole partire bene, con un format video chiaro, una presenza curata e una distribuzione che non si fermi ai social"
      )
    ),
    speaker: (packagesByArea.speaker_podcast || []).map((item) =>
      enrichPackage(
        item,
        item.name.includes("PRO")
          ? "Un percorso per dare piu continuita alla voce, aumentare la frequenza di uscita e far crescere un progetto audio o audio video con maggiore solidita"
          : "Adatto a speaker, podcaster, giornalisti e divulgatori che vogliono entrare nel network con una presenza piu chiara e professionale"
      )
    ),
    aziende: (packagesByArea.aziende || []).map((item) =>
      enrichPackage(
        item,
        "Una soluzione pensata per aziende e attivita che vogliono raccontarsi meglio, con contenuti autorevoli, distribuzione multicanale e una presenza piu credibile",
        "Richiedi informazioni"
      )
    ),
    brand: (packagesByArea.produttori_brand || []).map((item) =>
      enrichPackage(
        item,
        "Un percorso dedicato a brand, format e progetti in costruzione che hanno bisogno di un confronto iniziale prima dell'attivazione",
        "Richiedi informazioni"
      )
    )
  };
}

async function getPublicShell() {
  const [
    shell,
    packagesByArea,
    cmsPackages,
    latestOffers,
    homeSections,
    creatorSections,
    speakerSections,
    aziendeSections,
    smartTvSections,
    serviziSections,
    chiSiamoSections,
    contattiSections,
    creatorProfiles,
    speakerProfiles,
    brandServices
  ] = await Promise.all([
    getSiteSettings(),
    getPackagesByArea(),
    cmsService.listServicePackages(),
    db.all(
      "SELECT offers.*, categories.name AS category_name FROM offers LEFT JOIN categories ON categories.id = offers.category_id WHERE offers.status IN ('approved', 'published_telegram', 'published_facebook') ORDER BY offers.score DESC, offers.created_at DESC LIMIT 6"
    ),
    cmsService.getPublishedSections("home"),
    cmsService.getPublishedSections("creator-network"),
    cmsService.getPublishedSections("speaker-network"),
    cmsService.getPublishedSections("aziende"),
    cmsService.getPublishedSections("smart-tv"),
    cmsService.getPublishedSections("servizi"),
    cmsService.getPublishedSections("chi-siamo"),
    cmsService.getPublishedSections("contatti"),
    cmsService.listProfiles("creator"),
    cmsService.listProfiles("speaker"),
    cmsService.listBrandServices(true)
  ]);
  if (cmsPackages.length) {
    packagesByArea.creator_video = cmsPackages.filter((item) => item.category === "creator");
    packagesByArea.speaker_podcast = cmsPackages.filter((item) => item.category === "speaker");
    packagesByArea.aziende = cmsPackages.filter((item) => item.category === "azienda");
    packagesByArea.produttori_brand = cmsPackages.filter((item) => item.category === "custom" || item.category === "smart-tv");
  }
  const operations = (await db.getSetting("operations", {})) || {};

  return {
    ...shell,
    operations,
    packagesByArea,
    cmsPackages,
    dynamicSections: {
      home: homeSections,
      creator: creatorSections,
      speaker: speakerSections,
      aziende: aziendeSections,
      smartTv: smartTvSections,
      servizi: serviziSections,
      chiSiamo: chiSiamoSections,
      contatti: contattiSections
    },
    creatorProfiles: creatorProfiles.filter((item) => item.status === "active"),
    speakerProfiles: speakerProfiles.filter((item) => item.status === "active"),
    brandServices,
    latestOffers,
    disclosure: DISCLOSURE,
    percorsi: buildPercorsi(packagesByArea)
  };
}

async function saveContactRequest(req, type = "contact_request") {
  const name = requiredText(req.body.name);
  const email = requiredText(req.body.email);
  const phone = requiredText(req.body.phone);
  const projectType = requiredText(req.body.project_type || req.body.package_name || "Richiesta generica");
  const message = requiredText(req.body.message || req.body.note);

  if (!name || !isEmail(email) || !Boolean(req.body.accept_privacy)) {
    return {
      ok: false,
      message: "Inserisci nome, email valida e consenso privacy"
    };
  }

  await db.insert("notifications_log", {
    type,
    target: "contact",
    subject: `Richiesta informazioni - ${projectType}`,
    body: `Nome: ${name}\nEmail: ${email}\nTelefono: ${phone}\nTipo progetto: ${projectType}\nMessaggio: ${message}`,
    status: "new"
  });

  return {
    ok: true,
    message: "Richiesta inviata, lo staff la trovera nel pannello amministrativo"
  };
}

router.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  return res.send(`User-agent: *\nAllow: /\nHost: ${new URL(SITE_URL).host}\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

router.get("/favicon.ico", (req, res) => {
  return res.redirect(301, "/assets/favicon.png");
});

router.get("/favicon.png", (req, res) => {
  return res.redirect(301, "/assets/favicon.png");
});

router.get("/sitemap.xml", (req, res) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = SITEMAP_ROUTES.map(
    (item) =>
      `<url><loc>${SITE_URL}${item.path}</loc><lastmod>${lastmod}</lastmod><changefreq>${item.changefreq}</changefreq><priority>${item.priority}</priority></url>`
  ).join("");
  res.type("application/xml");
  return res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

router.get("/mappa-sito", async (req, res) => {
  return renderPublicPage(
    res,
    "Mappa del sito",
    "site-map",
    await getPublicShell(),
    buildPage(
      "Mappa del sito CreatorSpeakerTV",
      "Mappa sito",
      "Tutte le pagine principali di CreatorSpeaker TV raccolte in un unico punto",
      []
    )
  );
});

router.get("/", async (req, res) => {
  return renderPublicPage(
    res,
    "CreatorSpeakerTV network editoriale e multimediale",
    "index",
    await getPublicShell(),
    buildPage(
      "CreatorSpeaker TV",
      "Home",
      "Network editoriale e multimediale per creator, speaker, podcast, aziende e progetti distribuiti su web, podcast e Smart TV",
      [],
      {
        seoDescription:
          "CreatorSpeaker TV o CreatorSpeakerTV e il network editoriale e multimediale per creator, speaker, podcast, aziende e progetti distribuiti su web, podcast e Smart TV"
      }
    )
  );
});

router.get("/network", async (req, res) => {
  return renderPublicPage(
    res,
    "CreatorSpeaker TV Network",
    "public-page",
    await getPublicShell(),
    buildPage(
      "CreatorSpeaker TV Network",
      "Il Network",
      "Una rete editoriale e multimediale che aiuta i contenuti a prendere forma, trovare ritmo e arrivare piu lontano",
      [
        {
          title: "Missione",
          text:
            "CreatorSpeaker TV nasce per chi ha qualcosa da dire ma non vuole restare fermo alla pubblicazione isolata. Il network organizza, valorizza e accompagna i contenuti dentro un percorso piu chiaro e piu credibile"
        },
        {
          title: "Distribuzione multicanale",
          text:
            "TV, radio, podcast, web TV, Smart TV, app, newsletter, blog e ambienti digitali possono lavorare insieme invece di vivere come presenze sparse e scollegate"
        },
        {
          title: "Supporto editoriale",
          text:
            "Ogni progetto puo essere seguito anche sul piano editoriale e visivo, con strumenti concreti come regia virtuale, supporto grafico e impostazione del format"
        },
        {
          title: "Valore del network",
          text:
            "Un contenuto da solo si perde facilmente. Dentro una rete puo essere ripreso, rilanciato, ordinato e presentato con piu forza"
        },
        {
          title: "Presenza piu ampia",
          text:
            "L'obiettivo non e solo essere online ma costruire una presenza riconoscibile su schermi, piattaforme e dispositivi diversi"
        },
        {
          title: "Perche entrare",
          text:
            "Entrare nel network significa dare al proprio progetto una cornice piu seria, una distribuzione piu ampia e strumenti che aiutano a crescere con continuita"
        }
      ],
      {
        heroImage: "/assets/brand/creatorspeaker-brand-emblem.jpg",
        ctaPrimary: { href: "/richiedi-informazioni", label: "Raccontaci il tuo progetto" },
        ctaSecondary: { href: "/percorsi", label: "Guarda i percorsi" },
        seoDescription:
          "Network editoriale e multimediale per creator, speaker, podcast, video musicali, aziende e progetti digitali distribuiti su web, podcast e Smart TV",
        seoKeywords: [
          "network per creator",
          "pubblicare video musicale online",
          "creator network italia",
          "distribuzione contenuti creator",
          "smart tv creator"
        ]
      }
    )
  );
});

router.get("/creator-network", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Creator Video Network",
    "percorsi",
    data,
    buildPage(
      "Creator Video Network",
      "Creator Video",
      "Per chi vuole trasformare un'idea in un format video chiaro, riconoscibile e distribuito con criterio",
      [
        {
          title: "Per chi e pensato",
          text:
            "Per creator, divulgatori, professionisti, coach e content creator che vogliono smettere di pubblicare a caso e iniziare a costruire una presenza video piu solida"
        },
        {
          title: "Perche conta il network",
          text:
            "Quando un format entra in un sistema piu ordinato acquista ritmo, identita e valore percepito. Non cambia solo dove esce, cambia come viene visto"
        },
        {
          title: "Produzione e strumenti",
          text:
            "Puntate, clip, regia virtuale, audio, grafiche e materiali di supporto aiutano il progetto a restare coerente nel tempo e piu facile da distribuire"
        },
        {
          title: "Sei un creator e vuoi pubblicare un video musicale",
          text:
            "Se vuoi pubblicare un video musicale, un videoclip o un contenuto promozionale legato a un brano, CreatorSpeaker TV puo aiutarti a costruire una presentazione piu curata, materiali di supporto, grafiche coerenti e una distribuzione piu ordinata tra web, clip e presenza editoriale"
        }
      ],
      {
        heroImage: data.site.heroImage,
        seoDescription:
          "Sei un creator e vuoi pubblicare un video musicale o un format video online? CreatorSpeaker TV ti aiuta con distribuzione, grafiche, supporto editoriale e presenza multicanale",
        seoKeywords: [
          "sei un creator e vuoi pubblicare un video musicale",
          "pubblicare video musicale online",
          "creator video musicale",
          "distribuzione videoclip creator",
          "format video creator"
        ],
        faqItems: [
          {
            question: "CreatorSpeaker TV aiuta anche chi vuole pubblicare un video musicale",
            answer:
              "Si, il network puo aiutare un creator a organizzare videoclip, clip promozionali, grafiche, pagina progetto e distribuzione editoriale in modo piu credibile e ordinato"
          },
          {
            question: "Posso usare CreatorSpeaker TV per dare piu visibilita a un format video",
            answer:
              "Si, il progetto e pensato per aiutare creator e professionisti a dare continuita, identita e distribuzione a un format video"
          }
        ],
        packageGroups: [
          {
            title: "Percorsi Creator",
            intro:
              "Ogni percorso nasce per aiutarti a costruire una presenza video professionale senza appesantire il progetto",
            packages: data.percorsi.creator
          }
        ]
      }
    )
  );
});

router.get("/speaker-network", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Speaker & Podcast Network",
    "percorsi",
    data,
    buildPage(
      "Speaker & Podcast Network",
      "Speaker e Podcast",
      "Per dare piu forza alla voce e trasformarla in un progetto audio o audio video con una direzione precisa",
      [
        {
          title: "Il valore della voce",
          text:
            "La voce crea relazione, fiducia e continuita. Quando trova un contenitore giusto puo diventare un vero progetto editoriale"
        },
        {
          title: "Dove puo arrivare",
          text:
            "Podcast, radio, estratti video, conversioni audio video e archivi ordinati permettono a ogni contenuto di vivere in piu contesti"
        },
        {
          title: "Supporto editoriale",
          text:
            "Grafiche, registrazione audio, newsletter, supporto comunicazione e regia virtuale aiutano il progetto a presentarsi meglio fin dai primi episodi"
        }
      ],
      {
        heroImage: "/assets/brand/creatorspeaker-brand-emblem.jpg",
        seoDescription:
          "Percorsi per speaker, podcaster e divulgatori che vogliono distribuire meglio podcast, puntate audio e contenuti video collegati",
        seoKeywords: [
          "podcast network",
          "speaker network",
          "pubblicare podcast online",
          "speaker contenuti audio video"
        ],
        packageGroups: [
          {
            title: "Percorsi Speaker",
            intro:
              "Dai primi episodi a una pubblicazione piu costante, qui trovi percorsi pensati per dare ordine, voce e continuita al progetto",
            packages: data.percorsi.speaker
          }
        ]
      }
    )
  );
});

router.get("/aziende-brand", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Aziende, Brand e Attivita",
    "percorsi",
    data,
    buildPage(
      "Aziende, Brand e Attivita",
      "Aziende e Brand",
      "Per raccontare un'attivita con contenuti piu forti, interviste, video e presenza multicanale",
      [
        {
          title: "Oltre la pubblicita veloce",
          text:
            "Non tutto deve sembrare una promo urlata. Un contenuto ben costruito puo raccontare un'azienda in modo molto piu credibile"
        },
        {
          title: "Storytelling aziendale",
          text:
            "Interviste, video, speakeraggio e contenuti editoriali aiutano a dare voce al lavoro, ai valori e al posizionamento del brand"
        },
        {
          title: "Distribuzione e presenza",
          text:
            "Web, social, Smart TV, app e Web TV possono lavorare insieme per tenere il brand presente in piu punti di contatto"
        }
      ],
      {
        heroImage: data.site.heroImage,
        featureList: [
          "Interviste professionali",
          "Promo video",
          "Banner web",
          "Distribuzione social",
          "Speakeraggio professionale",
          "Comunicati stampa",
          "Presenza su Smart TV",
          "Presenza su app e Web TV"
        ],
        packageGroups: [
          {
            title: "Soluzioni per aziende e brand",
            intro:
              "Ogni proposta nasce per trasformare la comunicazione aziendale in qualcosa di piu curato, continuativo e utile nel tempo",
            packages: data.percorsi.aziende
          },
          {
            title: "Progetti in definizione",
            intro:
              "Per brand, produttori e format ancora in costruzione partiamo da un confronto iniziale e costruiamo la soluzione piu adatta",
            packages: data.percorsi.brand
          }
        ]
      }
    )
  );
});

router.get("/smart-tv", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Smart TV e Distribuzione",
    "public-page",
    data,
    buildPage(
      "Smart TV, Web TV e Distribuzione Multicanale",
      "Distribuzione",
      "Porta i tuoi contenuti oltre il feed e costruisci una presenza che funzioni su schermi, piattaforme e dispositivi diversi",
      [
        {
          title: "Smart TV e dispositivi connessi",
          text:
            "I contenuti possono essere pensati per web, podcast, TV, radio, Smart TV, app e dispositivi connessi cosi da uscire dal solo uso social"
        },
        {
          title: "Un ecosistema editoriale",
          text:
            "Web TV, app, newsletter, blog, clip social e contenuti audio possono dialogare tra loro e dare piu continuita al progetto"
        },
        {
          title: "Piu occasioni di contatto",
          text:
            "L'idea e arrivare alle persone in momenti diversi, a casa, in mobilita, in cuffia o davanti a uno schermo, senza perdere coerenza"
        }
      ],
      {
        heroImage: data.site.heroImage,
        seoDescription:
          "Distribuzione multicanale su Smart TV, web TV, podcast, app e schermi connessi per creator, speaker, aziende e progetti editoriali",
        seoKeywords: [
          "smart tv creator",
          "web tv creator",
          "distribuzione multicanale video",
          "pubblicare contenuti su smart tv"
        ],
        stats: [
          { label: "TV e Web TV", value: "Formati video" },
          { label: "Podcast e Radio", value: "Formati audio" },
          { label: "Smart TV", value: "Schermi connessi" },
          { label: "Newsletter e Blog", value: "Supporti editoriali" }
        ]
      }
    )
  );
});

router.get("/servizi", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Servizi",
    "public-page",
    data,
    buildPage(
      "Servizi e strumenti distintivi",
      "Servizi",
      "Regia virtuale, supporto grafico, registrazione audio, caricamento contenuti e studio video aiutano il progetto a crescere con piu ordine e piu forza",
      [
        {
          title: "Regia virtuale",
          text:
            "La regia virtuale aiuta a gestire ospiti, grafiche, sfondi, intro, registrazioni e dirette in modo piu pulito e professionale",
          bullets: [
            "Ospiti multipli",
            "Grafiche personalizzate",
            "Sfondi virtuali",
            "Video introduttivi",
            "Registrazione trasmissioni",
            "Dirette social multiple",
            "Archivio registrazioni",
            "Qualita HD per distribuzione televisiva"
          ]
        },
        {
          title: "Supporto grafico e Canva",
          text:
            "Miniature, locandine, card e materiali visuali fanno una differenza concreta quando un progetto vuole apparire piu curato e riconoscibile"
        },
        {
          title: "Video musicali, teaser e lanci",
          text:
            "Se devi pubblicare un video musicale, un teaser o un contenuto promozionale, qui trovi strumenti utili per accompagnarlo con copertine, grafiche, clip brevi, pagine di supporto e una presentazione piu forte"
        },
        {
          title: "Registrazione audio",
          text:
            "Le ore dedicate all'audio aiutano podcast, speakeraggi, rubriche e puntate a uscire con una base piu ordinata e piu credibile"
        },
        {
          title: "Caricamento contenuti",
          text:
            "Puoi gestire i caricamenti in autonomia oppure affidarli allo staff quando vuoi alleggerire il lavoro operativo"
        },
        {
          title: "Studio video foto piu audio",
          text:
            "Dall'area riservata puoi creare contenuti video partendo da immagini e audio, utile per teaser, rilanci, rubriche semplici e materiali rapidi"
        }
      ],
      {
        heroImage: "/assets/brand/creatorspeaker-brand-emblem.jpg",
        seoDescription:
          "Servizi per creator, speaker e progetti digitali: regia virtuale, Canva, grafiche, caricamenti contenuti, audio e supporto per video musicali e lanci online",
        seoKeywords: [
          "servizi per creator",
          "regia virtuale creator",
          "grafica canva creator",
          "pubblicare video musicale",
          "servizi video musicale online"
        ],
        faqItems: [
          {
            question: "Quali servizi sono utili se voglio pubblicare un video musicale",
            answer:
              "Regia virtuale, supporto grafico, Canva, clip promozionali, caricamenti, pagina dedicata e distribuzione multicanale sono i servizi piu utili per accompagnare un lancio video musicale"
          }
        ],
        extraCards: (data.packagesByArea.caricamenti || []).map((item) => ({
          title: item.name,
          text: `${item.description} ${item.features.join(" - ")}`,
          badge: `${item.price_cents / 100} EUR + IVA`
        }))
      }
    )
  );
});

router.get("/percorsi", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Percorsi di adesione",
    "percorsi",
    data,
    buildPage(
      "Percorsi di adesione",
      "Percorsi",
      "Scegli il percorso piu adatto al progetto. L'attivazione viene confermata dopo il confronto con lo staff e la verifica amministrativa",
      [
        {
          title: "Prima il progetto, poi il percorso",
          text:
            "Qui non trovi pacchetti da scaffale ma percorsi pensati per dare una direzione chiara ai contenuti e accompagnarli nella distribuzione"
        }
      ],
      {
        heroImage: data.site.heroImage,
        seoDescription:
          "Percorsi CreatorSpeaker TV per creator, speaker, aziende, podcast e progetti video che vogliono crescere con piu ordine, supporto editoriale e distribuzione",
        seoKeywords: [
          "percorsi creator",
          "percorsi speaker",
          "pubblicare format video",
          "crescere come creator online"
        ],
        packageGroups: [
          { title: "Creator Video", intro: "Percorsi dedicati a creator, format video e professionisti che vogliono crescere con ordine", packages: data.percorsi.creator },
          { title: "Speaker e Podcast", intro: "Percorsi per la voce, il podcast e i format audio video che hanno bisogno di continuita", packages: data.percorsi.speaker },
          { title: "Aziende e Brand", intro: "Soluzioni per contenuti editoriali, interviste, promozione e storytelling", packages: data.percorsi.aziende },
          { title: "Progetti in definizione", intro: "Proposte dedicate a brand, produttori e format premium da costruire insieme", packages: data.percorsi.brand }
        ]
      }
    )
  );
});

router.get("/chi-siamo", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Chi siamo",
    "public-page",
    data,
    buildPage(
      "Chi siamo",
      "Visione",
      "CreatorSpeaker TV e un progetto editoriale e multimediale pensato per chi vuole dare piu spazio, piu forma e piu continuita ai propri contenuti",
      [
        {
          title: "Visione",
          text:
            "Crediamo che idee, voci, format e progetti meritino una rete vera, non una semplice pubblicazione lasciata sola"
        },
        {
          title: "Missione",
          text:
            "Aiutare creator, speaker, aziende e professionisti a costruire contenuti piu chiari, piu curati e piu facili da distribuire"
        },
        {
          title: "Approccio editoriale",
          text:
            "Ogni contenuto viene pensato come parte di un percorso che puo crescere nel tempo senza perdere identita"
        },
        {
          title: "Qualita e supporto",
          text:
            "Lavoriamo su presentazione, ritmo, coerenza, strumenti e distribuzione per dare al progetto una base piu solida"
        }
      ],
      {
        heroImage: "/assets/brand/creatorspeaker-brand-emblem.jpg",
        ctaPrimary: { href: "/contatti", label: "Parla con lo staff" }
      }
    )
  );
});

router.get("/pubblicare-video-musicale", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Pubblicare un video musicale",
    "public-page",
    data,
    buildPage(
      "Sei un creator e vuoi pubblicare un video musicale",
      "Video musicale",
      "Una pagina pensata per chi vuole presentare meglio un videoclip, un lancio musicale o un contenuto promozionale collegato a un brano",
      [
        {
          title: "Dal file al progetto",
          text:
            "Un video musicale non e solo un file da caricare. Servono una presentazione chiara, materiali visuali coerenti, una pagina di supporto e un percorso che aiuti il contenuto a non perdersi subito dopo la pubblicazione"
        },
        {
          title: "Cosa puo fare CreatorSpeaker TV",
          text:
            "Il network puo aiutarti a preparare copertine, miniature, clip brevi, descrizioni, scheda progetto, contenuti di lancio e distribuzione editoriale su canali web, social, podcast video e ambienti multimediali"
        },
        {
          title: "Per artisti, creator e team piccoli",
          text:
            "Il percorso e utile se hai un brano, un videoclip, una live session, un teaser o un contenuto musicale che vuoi presentare con piu cura senza costruire da zero tutta la parte operativa"
        },
        {
          title: "Cosa serve per partire",
          text:
            "Titolo del progetto, file o link del video, immagini, descrizione, contatti, obiettivo del lancio e materiali gia disponibili. Lo staff potra poi indicare cosa manca e quali passaggi sono piu urgenti"
        }
      ],
      {
        heroImage: data.site.heroImage,
        ctaPrimary: { href: "/richiedi-informazioni", label: "Racconta il lancio" },
        ctaSecondary: { href: "/creator-network", label: "Vedi percorsi creator" },
        seoDescription:
          "Sei un creator e vuoi pubblicare un video musicale? CreatorSpeaker TV aiuta con presentazione, grafiche, clip, pagina progetto e distribuzione editoriale multicanale",
        seoKeywords: [
          "sei un creator e vuoi pubblicare un video musicale",
          "pubblicare video musicale",
          "lanciare videoclip online",
          "promuovere video musicale creator",
          "pagina progetto video musicale"
        ],
        faqItems: [
          {
            question: "Posso usare CreatorSpeaker TV per pubblicare un videoclip",
            answer:
              "Si, puoi usare CreatorSpeaker TV per organizzare presentazione, materiali, pagina progetto, clip e distribuzione editoriale del videoclip"
          },
          {
            question: "Serve avere gia tutto pronto",
            answer:
              "No, puoi partire anche con materiali parziali. Lo staff puo aiutarti a capire cosa manca prima della pubblicazione"
          }
        ],
        extraCards: [
          { title: "Miniature e copertine", badge: "Visual", text: "Materiali grafici coerenti per rendere il lancio piu riconoscibile" },
          { title: "Clip e teaser", badge: "Video", text: "Contenuti brevi per accompagnare il video principale" },
          { title: "Pagina progetto", badge: "SEO", text: "Una scheda ordinata con testo, media, contatti e call to action" }
        ]
      }
    )
  );
});

router.get("/pubblicare-podcast-online", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Pubblicare podcast online",
    "public-page",
    data,
    buildPage(
      "Vuoi pubblicare un podcast online con piu continuita",
      "Podcast",
      "Un percorso per trasformare episodi, voce e idee in una presenza audio o audio video piu ordinata",
      [
        {
          title: "Non basta registrare",
          text:
            "Un podcast ha bisogno di identita, scaletta, copertina, descrizioni, archivio, pubblicazione costante e materiali che aiutino ogni episodio a essere capito prima ancora di essere ascoltato"
        },
        {
          title: "Audio, video e distribuzione",
          text:
            "CreatorSpeaker TV puo aiutare con registrazione, grafiche, conversione audio video, clip, pagina speaker, archivio episodi e distribuzione collegata a web, radio, podcast e Smart TV"
        },
        {
          title: "Per chi parla, intervista o divulga",
          text:
            "Il percorso e pensato per speaker, podcaster, professionisti, divulgatori, coach e creator che vogliono costruire una rubrica riconoscibile invece di pubblicare episodi scollegati"
        }
      ],
      {
        heroImage: "/assets/brand/creatorspeaker-brand-emblem.jpg",
        ctaPrimary: { href: "/richiedi-informazioni", label: "Proponi il podcast" },
        ctaSecondary: { href: "/speaker-network", label: "Percorsi speaker" },
        seoDescription:
          "Pubblicare podcast online con supporto editoriale, grafiche, registrazione audio, conversione video, pagina speaker e distribuzione multicanale",
        seoKeywords: [
          "pubblicare podcast online",
          "creare podcast professionale",
          "speaker podcast network",
          "distribuire podcast",
          "podcast audio video"
        ],
        faqItems: [
          {
            question: "CreatorSpeaker TV puo aiutare a pubblicare un podcast",
            answer:
              "Si, puo aiutare a strutturare episodi, grafiche, pagina speaker, materiali audio video e distribuzione"
          },
          {
            question: "Il podcast puo diventare anche contenuto video",
            answer:
              "Si, gli episodi possono essere adattati in formato audio video, clip e materiali pensati per piu canali"
          }
        ]
      }
    )
  );
});

router.get("/visibilita-azienda-smart-tv", async (req, res) => {
  const data = await getPublicShell();
  return renderPublicPage(
    res,
    "Visibilita azienda su Smart TV",
    "public-page",
    data,
    buildPage(
      "Visibilita per aziende, brand e professionisti",
      "Aziende",
      "Contenuti editoriali, interviste, video e presenza multicanale per raccontare un'attivita in modo piu credibile",
      [
        {
          title: "Comunicazione meno improvvisata",
          text:
            "Molte aziende pubblicano contenuti senza una struttura. Un format editoriale, anche semplice, aiuta a spiegare meglio cosa fai, perche conta e quale valore porti"
        },
        {
          title: "Dove puo apparire il contenuto",
          text:
            "Video, interviste, banner, clip, pagine web, app, Web TV e Smart TV possono lavorare insieme per creare piu punti di contatto senza disperdere il messaggio"
        },
        {
          title: "Per attivita locali e brand digitali",
          text:
            "Il percorso e utile per professionisti, negozi, servizi, aziende locali, brand emergenti e progetti che vogliono una comunicazione piu curata rispetto al solo post social"
        }
      ],
      {
        heroImage: data.site.heroImage,
        ctaPrimary: { href: "/richiedi-informazioni", label: "Racconta l'attivita" },
        ctaSecondary: { href: "/aziende-brand", label: "Soluzioni aziende" },
        seoDescription:
          "Visibilita per aziende su Smart TV, web TV e canali digitali con interviste, video, storytelling, banner, speakeraggio e contenuti editoriali",
        seoKeywords: [
          "visibilita azienda smart tv",
          "video aziendale smart tv",
          "intervista azienda online",
          "storytelling aziendale",
          "promozione brand multicanale"
        ],
        faqItems: [
          {
            question: "Un'azienda puo usare CreatorSpeaker TV per farsi conoscere",
            answer:
              "Si, puo usare contenuti editoriali, interviste, video e distribuzione multicanale per presentarsi in modo piu credibile"
          },
          {
            question: "Serve gia avere video pronti",
            answer:
              "No, si puo partire da un confronto iniziale e scegliere il formato piu adatto tra intervista, video, banner, pagina o contenuti brevi"
          }
        ]
      }
    )
  );
});

router.get("/contatti", async (req, res) => {
  return renderPublicPage(
    res,
    "Contatti",
    "contatti",
    await getPublicShell(),
    buildPage(
      "Raccontaci il tuo progetto",
      "Contatti",
      "Spiegaci cosa vuoi costruire e ti aiutiamo a capire da dove partire",
      []
    )
  );
});

router.get("/richiedi-informazioni", async (req, res) => {
  return renderPublicPage(
    res,
    "Richiedi informazioni",
    "contatti",
    await getPublicShell(),
    buildPage(
      "Raccontaci il tuo progetto",
      "Richiesta informazioni",
      "Compila il form e ti ricontattiamo per capire quale percorso puo valorizzare meglio la tua idea",
      [],
      {
        seoDescription:
          "Richiedi informazioni a CreatorSpeaker TV se vuoi pubblicare un video musicale, lanciare un format creator, sviluppare un podcast o costruire una presenza multicanale",
        seoKeywords: [
          "richiedi informazioni creator",
          "pubblicare video musicale contatti",
          "contatti creatorspeakertv"
        ]
      }
    )
  );
});

router.post("/contatti", async (req, res) => {
  const result = await saveContactRequest(req);
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/contatti");
});

router.post("/richiedi-informazioni", async (req, res) => {
  const result = await saveContactRequest(req, "activation_request");
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect("/richiedi-informazioni");
});

router.get("/offerte", async (req, res) => {
  const shell = await getPublicShell();
  const offers = await db.all(
    "SELECT offers.*, categories.name AS category_name FROM offers LEFT JOIN categories ON categories.id = offers.category_id WHERE offers.status IN ('approved', 'published_telegram', 'published_facebook') ORDER BY offers.score DESC, offers.created_at DESC LIMIT 50"
  );
  return renderPublicPage(res, "Offerte", "policies", {
    ...shell,
    legalType: "offers",
    title: "Offerte approvate",
    content:
      "Una selezione di strumenti e risorse utili per creator, speaker, podcast e progetti digitali con disclosure sempre visibile",
    offers,
    disclosure: DISCLOSURE
  });
});

router.get("/privacy", async (req, res) => {
  const shell = await getPublicShell();
  return renderPublicPage(res, "Privacy", "policies", {
    ...shell,
    legalType: "privacy",
    title: "Privacy",
    content: shell.legal.privacy || defaultPrivacyText(shell.operations.officialInfoEmail || "info@creatorspeakertv.it")
  });
});

router.get("/cookie", async (req, res) => {
  const shell = await getPublicShell();
  return renderPublicPage(res, "Cookie", "policies", {
    ...shell,
    legalType: "cookie",
    title: "Cookie",
    content: shell.legal.cookie || defaultCookieText()
  });
});

router.get("/termini", async (req, res) => {
  const shell = await getPublicShell();
  return renderPublicPage(res, "Termini", "policies", {
    ...shell,
    legalType: "terms",
    title: "Termini",
    content: shell.legal.terms || defaultTermsText(shell.operations.officialInfoEmail || "info@creatorspeakertv.it")
  });
});

router.get("/legal", async (req, res) => {
  const shell = await getPublicShell();
  return renderPublicPage(res, "Area legale", "policies", {
    ...shell,
    legalType: "legal",
    title: "Privacy, Cookie e Termini",
    content: [
      "Privacy: gestione dati account, richieste di attivazione, contenuti caricati e richieste di contatto per finalita di servizio",
      "Cookie: uso di cookie tecnici di sessione per autenticazione e continuita d'uso",
      "Termini: servizi editoriali e multimediali con attivazione successiva alla verifica amministrativa"
    ].join("\n\n")
  });
});

router.get("/cart", async (req, res) => {
  const shell = await getPublicShell();
  return renderPublicPage(res, "Riepilogo richiesta", "cart", shell);
});

router.get("/checkout", async (req, res) => {
  const shell = await getPublicShell();
  return renderPublicPage(res, "Invia richiesta", "checkout", shell);
});

router.post("/cart/add", async (req, res) => {
  req.session.flash = {
    type: "success",
    message: "Percorso aggiunto al riepilogo richiesta"
  };
  res.redirect("/cart");
});

router.post("/request-info", async (req, res) => {
  const result = await saveContactRequest(req, "activation_request");
  req.session.flash = { type: result.ok ? "success" : "error", message: result.message };
  return res.redirect(req.body.redirect_to || "/richiedi-informazioni");
});

router.post("/checkout", async (req, res) => {
  const name = requiredText(req.body.name);
  const email = requiredText(req.body.email);
  const phone = requiredText(req.body.phone);
  const company = requiredText(req.body.company);
  const notes = requiredText(req.body.notes);
  const acceptPrivacy = Boolean(req.body.accept_privacy);
  const acceptTerms = Boolean(req.body.accept_terms);
  const paymentMethod = requiredText(req.body.payment_method) || "bank_transfer";
  const rawItems = parseJson(req.body.cart_payload, []);

  if (!name || !isEmail(email) || !acceptPrivacy || !acceptTerms || !rawItems.length) {
    req.session.flash = {
      type: "error",
      message: "Controlla i campi richiesti, le accettazioni e il riepilogo richiesta"
    };
    return res.redirect("/checkout");
  }

  const order = await createOrder({
    userId: req.session.userId || null,
    customer: { name, email, phone, company, notes },
    rawItems,
    paymentMethod
  });

  return res.redirect(`/order/${order.order_code}`);
});

router.get("/order/:orderCode", async (req, res) => {
  const shell = await getPublicShell();
  const order = await db.get("SELECT * FROM orders WHERE order_code = ?", [req.params.orderCode]);
  if (!order) {
    return res.redirect("/cart");
  }

  return renderPublicPage(res, `Richiesta ${order.order_code}`, "order-success", {
    ...shell,
    order,
    items: parseJson(order.items_json, [])
  });
});

module.exports = router;
