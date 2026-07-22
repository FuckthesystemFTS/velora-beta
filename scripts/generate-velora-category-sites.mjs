import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const root = resolve("published-sites");
const now = new Date().toISOString();

const categories = [
  {
    code: "merchant",
    label: "Merchant",
    sites: [
      ["merchant.catalog", "Catalogo Merchant", "Schede prodotto, listini e richieste commerciali in un formato ordinato per piccole aziende"],
      ["merchant.invoice", "Fatture Smart", "Registro leggero per preventivi, fatture, scadenze e pagamenti da controllare velocemente"],
      ["merchant.crm", "Clienti Attivi", "Mini CRM per seguire contatti, trattative, note e prossime azioni"]
    ]
  },
  {
    code: "shop",
    label: "Shop",
    sites: [
      ["shop.pricewatch", "Price Watch", "Osservatorio prezzi per confrontare offerte, storico e soglie di acquisto"],
      ["shop.giftfinder", "Gift Finder", "Idee regalo filtrate per occasione, budget, eta e interesse"],
      ["shop.localstock", "Local Stock", "Vetrina per disponibilita locali, prodotti essenziali e ritiro in zona"]
    ]
  },
  {
    code: "auto",
    label: "Auto",
    sites: [
      ["auto.maintenance", "Manutenzione Auto", "Promemoria per tagliandi, gomme, revisione, assicurazione e controlli stagionali"],
      ["auto.routecheck", "Route Check", "Pianificazione sintetica di viaggi, soste, costi, tempi e criticita del percorso"],
      ["auto.usedguide", "Usato Sicuro", "Checklist per valutare un'auto usata prima di acquisto, prova e passaggio"]
    ]
  },
  {
    code: "tv",
    label: "TV",
    sites: [
      ["tv.guide", "Guida TV Pulita", "Griglia semplice per programmi, film, eventi e promemoria senza distrazioni"],
      ["tv.familywatch", "Family Watch", "Selezione di contenuti adatti alla famiglia con fascia eta e tema"],
      ["tv.streamcheck", "Stream Check", "Confronto rapido tra contenuti, piattaforme, disponibilita e priorita di visione"]
    ]
  },
  {
    code: "sport",
    label: "Sport",
    sites: [
      ["sport.training", "Training Log", "Diario allenamenti con obiettivi, carico, recupero e progressi"],
      ["sport.events", "Eventi Sport", "Calendario essenziale per eventi, gare, iscrizioni e promemoria"],
      ["sport.recovery", "Recovery Coach", "Schede di recupero, sonno, stretching e gestione dello sforzo"]
    ]
  },
  {
    code: "culture",
    label: "Culture",
    sites: [
      ["culture.agenda", "Agenda Cultura", "Eventi culturali, mostre, letture e appuntamenti da seguire"],
      ["culture.archive", "Archivio Idee", "Raccolta di concetti, autori, movimenti e collegamenti culturali"],
      ["culture.reading", "Percorsi Lettura", "Percorsi tematici per libri, articoli, saggi e note personali"]
    ]
  },
  {
    code: "info",
    label: "Info",
    sites: [
      ["info.civic", "Info Civica", "Schede chiare su documenti, scadenze, uffici e procedure quotidiane"],
      ["info.weatherdesk", "Meteo Desk", "Lettura pratica di meteo, allerte, viaggio e preparazione giornaliera"],
      ["info.factcheck", "Fact Check Base", "Metodo rapido per verificare fonti, date, autore e coerenza di una notizia"]
    ]
  },
  {
    code: "news",
    label: "News",
    sites: [
      ["news.brief", "Brief Giornaliero", "Sintesi ordinata di temi da seguire, priorita e aggiornamenti"],
      ["news.local", "News Locale", "Spazio per notizie locali, servizi, traffico, lavori e avvisi cittadini"],
      ["news.science", "Science Brief", "Notizie scientifiche spiegate con contesto, limite e impatto pratico"]
    ]
  },
  {
    code: "tools",
    label: "Tools",
    sites: [
      ["tools.convert", "Convertitore Rapido", "Conversioni comuni per testo, misure, date, liste e formati"],
      ["tools.plan", "Piano Giorno", "Planner essenziale per priorita, blocchi lavoro, promemoria e fine giornata"],
      ["tools.checklist", "Checklist Veloci", "Liste pronte per casa, lavoro, viaggio, pubblicazione e controllo sicurezza"]
    ]
  },
  {
    code: "health",
    label: "Health",
    sites: [
      ["health.routine", "Routine Salute", "Tracciamento leggero di sonno, acqua, movimento, pause e umore"],
      ["health.sleep", "Sleep Focus", "Guida pratica per regolarita del sonno, ambiente e abitudini serali"],
      ["health.safety", "Sicurezza Casa", "Checklist per prevenzione domestica, farmaci, emergenze e numeri utili"]
    ]
  }
];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function page(site, category) {
  const [address, title, description] = site;
  const points = [
    "Panoramica immediata",
    "Lista operativa",
    "Priorita del giorno",
    "Note salvabili",
    "Verifica finale"
  ];
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} - Velora</title>
  <style>
    :root{color-scheme:dark;--bg:#0b1117;--panel:#101a22;--line:#2f4658;--gold:#e9c766;--ink:#f7fbff;--muted:#aebdca;--green:#37d89b}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#0b1117,#102635 60%,#121916);color:var(--ink);font-family:Segoe UI,ui-sans-serif,system-ui,sans-serif}
    main{max-width:1120px;margin:auto;padding:42px 18px 82px}header{display:grid;gap:14px;margin-bottom:28px}.kicker{color:var(--gold);font-weight:900;letter-spacing:.16em;text-transform:uppercase;font-size:12px}h1{font-size:48px;line-height:1;margin:0;letter-spacing:0}p{color:var(--muted);font-size:18px;line-height:1.5;max-width:820px}.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.panel,.tile{border:1px solid var(--line);background:rgba(16,26,34,.82);border-radius:8px;padding:20px}.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tile b{display:block;color:var(--gold);margin-bottom:8px}.action{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}button{border:0;border-radius:6px;padding:12px 15px;background:var(--gold);color:#111820;font-weight:900}button.secondary{background:#1c3141;color:var(--ink);border:1px solid var(--line)}input,textarea{width:100%;border:1px solid var(--line);background:#071019;color:var(--ink);border-radius:6px;padding:12px;margin-top:10px}textarea{min-height:116px}.status{color:var(--green);font-weight:900}@media(max-width:820px){main{padding-top:24px}.grid,.tiles{grid-template-columns:1fr}h1{font-size:36px}}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="kicker">Velora ${category.label}</div>
      <h1>${title}</h1>
      <p>${description}</p>
      <div class="status">Zona attiva: ${address}</div>
    </header>
    <section class="grid">
      <div class="panel">
        <h2>Centro operativo</h2>
        <div class="tiles">
          ${points.map((point, index) => `<div class="tile"><b>0${index + 1}</b>${point}</div>`).join("")}
        </div>
        <div class="action">
          <button onclick="addNote()">Aggiungi nota</button>
          <button class="secondary" onclick="clearNotes()">Pulisci</button>
        </div>
      </div>
      <div class="panel">
        <h2>Note</h2>
        <input id="noteTitle" placeholder="Titolo rapido">
        <textarea id="noteBody" placeholder="Scrivi una nota utile"></textarea>
        <div id="notes"></div>
      </div>
    </section>
  </main>
  <script>
    const key='velora-zone-${address}-notes';
    function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
    function render(){const rows=JSON.parse(localStorage.getItem(key)||'[]');notes.innerHTML=rows.map(n=>'<div class="tile"><b>'+esc(n.title)+'</b>'+esc(n.body)+'</div>').join('')}
    function addNote(){const title=noteTitle.value.trim()||'Nota';const body=noteBody.value.trim();if(!body)return;const rows=JSON.parse(localStorage.getItem(key)||'[]');rows.unshift({title,body});localStorage.setItem(key,JSON.stringify(rows.slice(0,12)));noteTitle.value='';noteBody.value='';render()}
    function clearNotes(){localStorage.removeItem(key);render()}
    render()
  </script>
</body>
</html>`;
}

await mkdir(root, { recursive: true });
const catalog = [];

for (const category of categories) {
  for (const site of category.sites) {
    const [address, title, description] = site;
    const dir = join(root, address);
    await mkdir(dir, { recursive: true });
    const html = page(site, category);
    const manifest = {
      formatVersion: 1,
      address,
      title,
      description,
      category: category.code,
      entryFile: "index.html",
      languages: ["it"],
      keywords: [category.code, title.toLowerCase(), address, "velora"],
      version: "1.0.0",
      ageRating: "EVERYONE",
      familySafe: true,
      permissions: { externalNetwork: false, clipboardRead: false, clipboardWrite: false, notifications: false, fileDownload: false },
      allowedExternalOrigins: []
    };
    await writeFile(join(dir, "index.html"), html, "utf8");
    await writeFile(join(dir, "velora.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    catalog.push({ address, title, description, category: category.code, contentHash: hash(html), generatedAt: now });
  }
}

await writeFile(join(root, "velora-category-sites.json"), JSON.stringify({ generatedAt: now, totalSites: catalog.length, sites: catalog }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: true, totalSites: catalog.length, categories: categories.length }, null, 2));
