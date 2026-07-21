const db = require("../src/db");

const legal = {
  privacy: [
    "Titolare del trattamento",
    "CreatorSpeaker TV tratta dati raccolti tramite registrazione, form contatti, richieste di attivazione, ordini, caricamenti, area riservata e gestione operativa della piattaforma",
    "Dati trattati",
    "Possiamo trattare dati identificativi e di contatto, credenziali account, richieste inviate, contenuti caricati, log tecnici, indirizzo IP, dati di navigazione essenziali e informazioni necessarie alla gestione dei servizi richiesti",
    "Finalita",
    "I dati sono trattati per creare e gestire account, rispondere alle richieste, attivare servizi, gestire contenuti, inviare comunicazioni operative, recuperare password, prevenire abusi, proteggere form e sessioni, adempiere a obblighi di legge e gestire verifiche amministrative o pagamenti",
    "Pagamenti",
    "Per bonifico, PayPal e Stripe possono essere trattati dati necessari alla richiesta, alla verifica del pagamento, alla fatturazione e alla corretta attivazione del servizio. I dati completi di carte o strumenti di pagamento non vengono salvati direttamente dalla piattaforma quando il pagamento avviene tramite provider esterni",
    "Contenuti caricati",
    "I materiali inviati dall'utente possono essere conservati e trattati per revisione, pubblicazione, assistenza tecnica, produzione editoriale, distribuzione e gestione delle richieste collegate",
    "Conservazione",
    "I dati vengono conservati per il tempo necessario alla gestione del rapporto, alla sicurezza della piattaforma, alla continuita dei servizi, agli obblighi civilistici, fiscali o probatori applicabili e alla tutela da usi impropri",
    "Diritti e contatti",
    "L'interessato puo chiedere accesso, rettifica, cancellazione, limitazione, opposizione e portabilita nei limiti previsti dal GDPR scrivendo a info@creatorspeakertv.it"
  ].join("\n\n"),
  cookie: [
    "Cookie e strumenti tecnici",
    "Il sito utilizza cookie tecnici e di sessione necessari ad autenticazione, sicurezza, continuita di navigazione, protezione dei form, salvataggio temporaneo del riepilogo richiesta e funzionamento dell'area riservata",
    "Cookie che non richiedono consenso",
    "I cookie strettamente necessari al funzionamento del servizio non richiedono consenso preventivo quando sono usati solo per finalita tecniche",
    "Sicurezza dei form",
    "La piattaforma puo usare token anti CSRF, controlli anti bot, honeypot, limiti di invio e log tecnici per ridurre spam, form injection, invii automatici e uso improprio delle richieste",
    "Cookie opzionali",
    "Eventuali strumenti statistici, marketing, profilazione, tracciamento avanzato o integrazioni terze che richiedano consenso non vengono attivati automaticamente"
  ].join("\n\n"),
  terms: [
    "Oggetto del servizio",
    "CreatorSpeaker TV offre servizi editoriali, multimediali, gestione contenuti, area riservata, strumenti operativi, richieste di attivazione, caricamenti, supporto alla pubblicazione e percorsi collegati alla piattaforma",
    "Registrazione e accesso",
    "L'utente deve fornire dati veritieri, mantenere riservate le credenziali, aggiornare le informazioni quando necessario e usare il servizio in modo lecito, corretto e coerente con la finalita della piattaforma",
    "Contenuti caricati",
    "L'utente garantisce di avere diritti, autorizzazioni e responsabilita sui materiali caricati, inclusi testi, immagini, audio, video, loghi, brani, grafiche e documenti. Non sono ammessi contenuti illeciti, lesivi di diritti altrui, diffamatori, violenti, discriminatori, ingannevoli o contrari alla normativa applicabile",
    "Pagamenti e attivazione",
    "Bonifico, PayPal e Stripe possono essere previsti come metodi di pagamento. L'attivazione effettiva dei servizi puo dipendere da verifica amministrativa, conferma del pagamento, disponibilita tecnica e completamento delle configurazioni operative necessarie",
    "Pubblicazione e distribuzione",
    "La pubblicazione di contenuti puo richiedere revisione, adattamenti tecnici, approvazione editoriale e rispetto dei formati richiesti. La piattaforma puo rifiutare o sospendere materiali non conformi, incompleti o rischiosi",
    "Accessi digitali condivisi",
    "Gli accessi digitali collegati a strumenti o piattaforme esterne sono personali, temporanei e revocabili in caso di uso improprio, condivisione non autorizzata o mancato rispetto delle istruzioni"
  ].join("\n\n")
};

const seoSettings = {
  seo_home_title: "CreatorSpeaker TV network per creator, speaker, podcast e aziende",
  seo_home_description:
    "Network editoriale e multimediale per pubblicare video, podcast, format creator e contenuti aziendali su web, podcast, app e Smart TV"
};

async function upsertSiteSetting(key, value) {
  const existing = await db.get("SELECT id FROM site_settings WHERE key = ?", [key]);
  if (existing) {
    await db.run("UPDATE site_settings SET value = ?, group_name = 'seo', updated_at = CURRENT_TIMESTAMP WHERE key = ?", [value, key]);
    return;
  }
  await db.insert("site_settings", { key, value, group_name: "seo" });
}

async function main() {
  await db.initialize();
  await db.setSetting("legal", legal);
  for (const [key, value] of Object.entries(seoSettings)) {
    await upsertSiteSetting(key, value);
  }
  console.log("production-readiness-settings: OK");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
