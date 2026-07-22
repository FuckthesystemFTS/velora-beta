import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const root = resolve("oceano/velora-search-packs");
const now = new Date().toISOString();

const packs = [
  {
    slug: "scienza",
    address: "atlas.scienza",
    category: "ATLAS_SCIENZA",
    title: "Atlante Scienza",
    description: "Fisica, biologia, chimica, spazio, Terra, matematica e metodo scientifico",
    areas: ["Fisica", "Biologia", "Chimica", "Astronomia", "Geologia", "Matematica", "Ecologia", "Energia", "Materiali", "Metodo scientifico"],
    subjects: ["forza", "energia", "cellula", "DNA", "proteina", "reazione", "molecola", "pianeta", "orbita", "stella", "roccia", "clima", "oceano", "equazione", "probabilita", "ecosistema", "batterio", "luce", "suono", "calore", "pressione", "gravita", "magnete", "cristallo", "esperimento"],
    contexts: ["principio base", "errore comune", "esempio quotidiano", "misura utile", "segnale da osservare", "applicazione pratica", "rischio da evitare", "domanda frequente", "modello mentale", "collegamento interdisciplinare"]
  },
  {
    slug: "tecnologia",
    address: "atlas.tecnologia",
    category: "ATLAS_TECNOLOGIA",
    title: "Atlante Tecnologia",
    description: "Software, reti, sicurezza, dati, intelligenza artificiale, privacy e strumenti digitali",
    areas: ["Software", "Reti", "Sicurezza", "Dati", "Intelligenza artificiale", "Cloud", "Hardware", "Privacy", "Automazione", "Accessibilita"],
    subjects: ["API", "database", "backup", "crittografia", "autenticazione", "token", "firewall", "DNS", "browser", "cache", "log", "malware", "phishing", "modello AI", "dataset", "prompt", "container", "server", "client", "endpoint", "rete locale", "latency", "hash", "firma digitale", "permesso"],
    contexts: ["uso sicuro", "configurazione minima", "controllo rapido", "errore frequente", "buona pratica", "segnale di rischio", "flusso operativo", "scelta consigliata", "verifica manuale", "integrazione"]
  },
  {
    slug: "salute",
    address: "atlas.salute",
    category: "ATLAS_SALUTE",
    title: "Atlante Salute",
    description: "Educazione alla salute, prevenzione, benessere, abitudini, sicurezza domestica e orientamento informativo",
    areas: ["Benessere", "Prevenzione", "Alimentazione", "Movimento", "Sonno", "Stress", "Primo orientamento", "Igiene", "Sicurezza domestica", "Salute digitale"],
    subjects: ["idratazione", "sonno", "camminata", "postura", "respiro", "stress", "alimentazione", "fibra", "zuccheri", "sale", "pressione", "temperatura", "igiene mani", "luce solare", "pausa schermo", "rumore", "farmaci", "allergia", "febbre", "dolore", "caduta", "ustione", "ferita", "umore", "routine"],
    contexts: ["segnale da monitorare", "abitudine semplice", "quando chiedere aiuto", "errore comune", "promemoria utile", "scelta prudente", "contesto familiare", "prevenzione quotidiana", "lettura responsabile", "limite dell'autovalutazione"]
  },
  {
    slug: "impresa",
    address: "atlas.impresa",
    category: "ATLAS_IMPRESA",
    title: "Atlante Lavoro e Impresa",
    description: "Produttivita, impresa, finanza personale, marketing, contratti, organizzazione e crescita professionale",
    areas: ["Produttivita", "Impresa", "Finanza personale", "Marketing", "Vendite", "Contratti", "Progetti", "Team", "Carriera", "Decisioni"],
    subjects: ["budget", "cash flow", "preventivo", "fattura", "cliente", "offerta", "riunione", "priorita", "scadenza", "obiettivo", "rischio", "contratto", "privacy clienti", "prezzo", "margine", "brand", "landing page", "email", "negoziazione", "feedback", "roadmap", "KPI", "portfolio", "colloquio", "delegare"],
    contexts: ["passo pratico", "errore da evitare", "indicatore utile", "domanda da fare", "formula semplice", "controllo prima di agire", "segnale positivo", "segnale critico", "metodo operativo", "decisione rapida"]
  },
  {
    slug: "cultura",
    address: "atlas.cultura",
    category: "ATLAS_CULTURA",
    title: "Atlante Cultura e Vita Pratica",
    description: "Storia, geografia, linguaggi, educazione civica, creativita, casa, viaggi e competenze quotidiane",
    areas: ["Storia", "Geografia", "Lingue", "Educazione civica", "Arte", "Musica", "Scrittura", "Casa", "Viaggi", "Competenze quotidiane"],
    subjects: ["citta", "mappa", "confine", "museo", "opera", "ritmo", "racconto", "argomentazione", "diritto", "dovere", "comunita", "documento", "viaggio", "bagaglio", "spesa", "energia domestica", "acqua", "tempo", "memoria", "lingua", "traduzione", "lettura", "fotografia", "archivio", "evento"],
    contexts: ["uso quotidiano", "lettura critica", "contesto storico", "punto da verificare", "esempio concreto", "strumento mentale", "scelta consapevole", "abitudine utile", "connessione culturale", "domanda guida"]
  }
];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pad(value) {
  return String(value).padStart(4, "0");
}

function makeEntry(pack, area, subject, context, index) {
  const id = `${pack.slug}-${pad(index)}`;
  const title = `${area}: ${subject} e ${context}`;
  const summary = `${area} applicata a ${subject}: una voce pratica per capire ${context}, cercare meglio e collegare il tema ad azioni concrete`;
  const body = [
    `${title}`,
    `${summary}`,
    `Per orientarsi: parti dalla definizione, osserva il contesto, cerca un esempio reale e verifica se il risultato cambia quando cambiano dati, ambiente o obiettivo`,
    `Uso in Velora: questa voce aiuta la ricerca quando l'utente scrive termini brevi, combinazioni fino a dieci parole o domande pratiche su ${subject}`,
    `Punti chiave: chiarezza del concetto, collegamento con ${area.toLowerCase()}, parole correlate, limite da ricordare, prossima azione consigliata`,
    `Parole correlate: ${pack.title}, ${area}, ${subject}, ${context}, guida, ricerca, spiegazione, esempio, verifica, pratica`
  ].join("\n\n");
  return {
    id,
    pack: pack.address,
    address: `${pack.slug}.${pad(index)}`,
    slug: id,
    title,
    description: summary,
    category: pack.category,
    language: "it",
    keywords: [pack.slug, area.toLowerCase(), subject, context, "velora", "guida", "ricerca"],
    headings: [area, subject, context],
    body,
    publisher: `Velora ${pack.title}`,
    ageRating: "EVERYONE",
    familySafe: true,
    trustLevel: 2,
    availability: 98
  };
}

await mkdir(root, { recursive: true });
const catalog = { title: "Velora Search Packs", generatedAt: now, packs: [] };

for (const pack of packs) {
  const dir = join(root, pack.slug);
  await mkdir(dir, { recursive: true });
  const entries = [];
  let count = 0;
  for (const area of pack.areas) {
    for (const subject of pack.subjects) {
      for (const context of pack.contexts) {
        count += 1;
        entries.push(makeEntry(pack, area, subject, context, count));
      }
    }
  }
  const jsonl = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  const digest = hash(jsonl);
  const manifest = {
    address: pack.address,
    title: pack.title,
    description: pack.description,
    category: pack.category,
    language: "it",
    entries: entries.length,
    generatedAt: now,
    contentHash: digest,
    files: ["entries.jsonl"]
  };
  await writeFile(join(dir, "entries.jsonl"), jsonl, "utf8");
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await writeFile(join(dir, "README.md"), `# ${pack.title}\n\n${pack.description}\n\nVoci indicizzabili: ${entries.length}\n\nIndirizzo Velora: ${pack.address}\n`, "utf8");
  catalog.packs.push({ slug: pack.slug, address: pack.address, title: pack.title, entries: entries.length, contentHash: digest });
}

catalog.totalEntries = catalog.packs.reduce((sum, pack) => sum + pack.entries, 0);
await writeFile(join(root, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(JSON.stringify(catalog, null, 2));
