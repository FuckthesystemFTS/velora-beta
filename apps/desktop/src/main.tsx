import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  createVeloraSiteApi,
  type PublisherPackageResponse,
  type PublisherReleaseRecord,
  type PublisherSearchResult,
  type VeloraValidationResult
} from "@velora/shared/velora-site";
import { desktopBranding } from "./config/branding";
import "./styles.css";

type Workspace = "home" | "explore" | "tools" | "mail" | "forum" | "mining" | "nodes" | "favorites" | "activity" | "identity" | "notifications" | "dev" | "settings" | "control";
type ViewerState = "idle" | "loading" | "verifying" | "ready" | "not-found" | "blocked" | "unavailable" | "error";
type NetworkState = "ready" | "syncing" | "limited" | "offline";
type PublishStage = "idle" | "selecting" | "validating" | "packaging" | "publishing" | "success" | "error";

type LoadedSiteDocument = {
  address: string;
  title: string;
  html: string;
  source: string;
};

type SearchCard = {
  title: string;
  zone: string;
  description: string;
  category: string;
  publisher: string;
  identityLevel: string;
  verified: boolean;
  familySafe: boolean;
  availability: string;
  updatedAt: string;
};

type ToolGroup = "Velora Core" | "Vita Quotidiana" | "Sicurezza" | "Creator Studio";

type ToolDefinition = SearchCard & {
  group: ToolGroup;
  action: ToolAction;
  inputLabel: string;
  placeholder: string;
};

type ToolAction =
  | "wallet-check"
  | "mining-summary"
  | "publisher-validator"
  | "zone-open"
  | "login-test"
  | "mail-test"
  | "node-health"
  | "hash"
  | "recovery"
  | "report"
  | "tts"
  | "translate"
  | "summary"
  | "rewrite"
  | "spell"
  | "dictation-note"
  | "focus-timer"
  | "checklist"
  | "percent"
  | "unit"
  | "link-check"
  | "difesa-check"
  | "password"
  | "privacy-clean"
  | "qr-safe"
  | "phishing"
  | "permission"
  | "file-signature"
  | "breach-note"
  | "safe-message"
  | "manifest"
  | "landing"
  | "seo"
  | "accessibility"
  | "changelog"
  | "logo"
  | "cover"
  | "content-pack"
  | "prompt-site"
  | "publish-plan";

type MailMessage = {
  id: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  bodyPreview: string;
  deliveryStatus: string;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
};

type ForumSection = {
  id: string;
  slug: string;
  title: string;
  description: string;
  onlineCount: number;
  lastActivityAt: string | null;
};

type ForumMessage = {
  id: string;
  body: string;
  bodyLength: number;
  author: string;
  createdAt: string;
};

type AccountSession = {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  recovery?: {
    required: boolean;
    visibleOnce: boolean;
    token?: string;
    message?: string;
  };
  user: {
    id: string;
    username: string;
    identityLevel: number;
  };
  mail: {
    address: string;
    identityLevel: number;
  };
};

type AuthMode = "login" | "register";

type MiningLocalStatus = {
  ready: boolean;
  running: boolean;
  minerPath: string;
  pidPath: string;
  logPath: string;
  maxThreads: number;
  message: string;
};

type MiningPowerProfile = "eco" | "balanced" | "boost" | "max";

type MiningForm = {
  coin: string;
  payoutWallet: string;
  threads: string;
  cpuPriority: string;
  powerProfile: MiningPowerProfile;
};

type MiningUiStats = {
  startedAt: number | null;
  elapsedSeconds: number;
};

type MiningProgressWorker = {
  coin: string;
  worker_id: string;
  accepted_pool_shares: number;
  rejected_pool_shares: number;
  stale_pool_shares: number;
  pending_label: string;
  paid_label: string;
  payout_threshold_label: string;
  payout_progress_percent: number;
  payout_ready: boolean;
  accounting_note: string;
};

type MiningProgress = {
  threshold: { xmrLabel: string; note: string };
  workers: MiningProgressWorker[];
  note: string;
};

type MiningNetworkStats = {
  source: string;
  payoutStatus: string;
  network: {
    total_hashrate_hs: number;
    xmr_hashrate_hs: number;
    zeph_hashrate_hs: number;
    accepted_shares: number;
    rejected_shares: number;
    stale_shares: number;
    active_workers: number;
    active_devices: number;
    active_boost_boxes: number;
  };
  pool?: {
    reachable?: boolean;
    wallet?: string;
    source?: string;
    hash?: number;
    hash2?: number;
    totalHashes?: number;
    validShares?: number;
    invalidShares?: number;
    lastShareAlgo?: string | null;
    amtDueAtomic?: string;
    error?: string;
  };
  contributionModel: string;
  warning: string;
};

type ReleaseCheck = {
  latestVersion: string;
  channel: string;
  changelog: string[];
  current: {
    platforms?: Record<string, { available: boolean; filename: string; sha256: string; size: number; downloadUrl: string }>;
  };
  message: string;
};

const apiBaseUrl = "https://velora-beta-20260629-9a9196313b42.herokuapp.com";
const demoSitePath = "examples/velora-demo-site";
const isAdminSessionEnabled = false;

const featuredSites: SearchCard[] = [
  {
    title: "Velora Demo Shop",
    zone: "shop.demo",
    description: "Vetrina dimostrativa verificata per provare la navigazione nell'Upper Web.",
    category: "Commercio",
    publisher: "Velora Labs",
    identityLevel: "Livello 0",
    verified: true,
    familySafe: true,
    availability: "Disponibile",
    updatedAt: "Beta corrente"
  },
  {
    title: "HappyMeter Health",
    zone: "health.happymeter",
    description: "Modello per applicazioni Velora con Login Velora e SDK, senza account paralleli.",
    category: "Benessere",
    publisher: "HappyMeter",
    identityLevel: "Livello 1",
    verified: false,
    familySafe: true,
    availability: "In preparazione",
    updatedAt: "Roadmap beta"
  },
  {
    title: "Velora Security",
    zone: "security.system",
    description: "Zona di sistema riservata a comunicazioni di sicurezza e aggiornamenti ufficiali.",
    category: "Sistema",
    publisher: "Velora",
    identityLevel: "Livello 0",
    verified: true,
    familySafe: true,
    availability: "Riservata",
    updatedAt: "Sistema"
  }
];

const veloraTools: ToolDefinition[] = [
  tool("Wallet Check", "tools.wallet", "Velora Core", "Valida indirizzi pubblici XMR e ZEPH senza salvare chiavi.", "wallet-check", "Wallet pubblico", "Incolla indirizzo XMR o ZEPH"),
  tool("Mining Monitor", "tools.mining", "Velora Core", "Legge lo stato mining, worker, hashrate e soglia payout.", "mining-summary", "Stato mining", "Premi Esegui per riepilogo mining"),
  tool("Publisher Validator", "tools.publisher-validator", "Velora Core", "Controlla struttura minima, manifest e indirizzo di una zona Velora.", "publisher-validator", "Manifest o appunti sito", "Incolla contenuto velora-site.json o percorso/zona"),
  tool("Zone Explorer", "tools.zone-explorer", "Velora Core", "Apre una zona Velora valida dalla sezione Esplora.", "zone-open", "Zona", "happy.meter"),
  tool("Velora Login Tester", "tools.login-test", "Velora Core", "Verifica se una pagina espone richiesta login Velora o SDK.", "login-test", "HTML o URL zona", "Incolla HTML o testo della pagina"),
  tool("Mail Tester", "tools.mail-test", "Velora Core", "Prepara un messaggio test VeloMail tra due account.", "mail-test", "Destinatario", "alias@velora"),
  tool("Node Health", "tools.node-health", "Velora Core", "Mostra stato nodo locale e rete Velora.", "node-health", "Nodo", "Premi Esegui per controllare"),
  tool("Hash Verifier", "tools.hash", "Velora Core", "Calcola SHA-256 di testo o file piccolo incollato.", "hash", "Contenuto", "Incolla testo o hash atteso"),
  tool("Recovery Key Check", "tools.recovery", "Velora Core", "Controlla se il key token e stato salvato senza mostrarlo di nuovo.", "recovery", "Promemoria", "Scrivi dove hai salvato il key token"),
  tool("Report Abuse", "tools.report-abuse", "Velora Core", "Prepara una segnalazione chiara per sito, mail, chat o utente.", "report", "Segnalazione", "Descrivi problema, zona e motivo"),
  tool("TTS Reader", "tools.tts", "Vita Quotidiana", "Legge ad alta voce testi, mail e pagine usando la voce del dispositivo.", "tts", "Testo da leggere", "Incolla testo da ascoltare"),
  tool("Traduttore Velora", "tools.translate", "Vita Quotidiana", "Traduce testo con servizio online e fallback locale.", "translate", "Testo", "it>en Ciao mondo"),
  tool("Riassunto Rapido", "tools.summary", "Vita Quotidiana", "Estrae punti principali e versione breve da testi lunghi.", "summary", "Testo lungo", "Incolla un testo da riassumere"),
  tool("Riscrivi Meglio", "tools.rewrite", "Vita Quotidiana", "Rende un testo piu chiaro, diretto e pubblicabile.", "rewrite", "Testo", "Incolla testo da migliorare"),
  tool("Correttore Umano", "tools.spell", "Vita Quotidiana", "Corregge spazi, maiuscole, punteggiatura e frasi confuse.", "spell", "Testo", "Incolla testo da correggere"),
  tool("Note Vocali", "tools.voice-notes", "Vita Quotidiana", "Prepara una nota ordinata da testo dettato o appunti veloci.", "dictation-note", "Nota", "Incolla appunti vocali trascritti"),
  tool("Timer Focus", "tools.focus", "Vita Quotidiana", "Crea sessioni focus con durata e pausa consigliata.", "focus-timer", "Minuti", "25"),
  tool("Checklist Rapida", "tools.checklist", "Vita Quotidiana", "Trasforma testo libero in checklist operativa.", "checklist", "Appunti", "Incolla cose da fare"),
  tool("Calcolatrice Percentuali", "tools.percent", "Vita Quotidiana", "Calcola percentuali, sconti, aumenti e quote.", "percent", "Valori", "20% di 150"),
  tool("Convertitore Unita", "tools.unit", "Vita Quotidiana", "Converte km/mi, kg/lb, C/F, EUR/USD indicativo manuale.", "unit", "Conversione", "10 km in mi"),
  tool("Link Check", "tools.link-check", "Sicurezza", "Analizza link sospetti prima di aprirli.", "link-check", "Link", "https://esempio.com"),
  tool("Difesa Totale Check", "tools.difesa-totale", "Sicurezza", "Controllo locale su link, testo e indicatori sospetti.", "difesa-check", "Testo o link", "Incolla messaggio, link o nome file"),
  tool("Password Strength", "tools.password", "Sicurezza", "Misura forza password senza salvarla.", "password", "Password", "Scrivi password da controllare"),
  tool("Privacy Cleaner", "tools.privacy", "Sicurezza", "Rimuove dati personali evidenti da testo prima di condividerlo.", "privacy-clean", "Testo", "Incolla testo da pulire"),
  tool("QR Safe Scanner", "tools.qr-safe", "Sicurezza", "Valuta contenuto QR gia letto prima di aprirlo.", "qr-safe", "Contenuto QR", "Incolla testo letto dal QR"),
  tool("Phishing Detector", "tools.phishing", "Sicurezza", "Evidenzia segnali di truffa in mail e messaggi.", "phishing", "Messaggio", "Incolla messaggio sospetto"),
  tool("Permission Viewer", "tools.permissions", "Sicurezza", "Spiega in modo semplice permessi richiesti da app o sito.", "permission", "Permessi", "camera, posizione, notifiche"),
  tool("File Signature Check", "tools.file-signature", "Sicurezza", "Riconosce tipo file da nome, estensione o firma nota.", "file-signature", "Nome o firma file", "setup.exe oppure %PDF"),
  tool("Breach Note", "tools.breach-note", "Sicurezza", "Crea piano azione dopo possibile furto account.", "breach-note", "Servizio coinvolto", "email, social, wallet"),
  tool("Safe Message", "tools.safe-message", "Sicurezza", "Riscrive messaggi delicati senza dati privati inutili.", "safe-message", "Messaggio", "Incolla messaggio da rendere sicuro"),
  tool("Manifest Generator", "tools.manifest", "Creator Studio", "Genera velora-site.json base valido per pubblicazione.", "manifest", "Dati sito", "zona: happy.meter; titolo: HappyMeter"),
  tool("Landing Builder", "tools.landing", "Creator Studio", "Crea HTML landing minimale pronta per Velora.", "landing", "Idea pagina", "Titolo, sottotitolo, sezioni"),
  tool("SEO Velora", "tools.seo", "Creator Studio", "Genera titolo, descrizione e tag per ricerca interna.", "seo", "Descrizione sito", "Incolla descrizione del sito"),
  tool("Accessibility Check", "tools.accessibility", "Creator Studio", "Controlla leggibilita base, contrasto testuale e alternative.", "accessibility", "HTML o testo", "Incolla HTML o testo pagina"),
  tool("Changelog Writer", "tools.changelog", "Creator Studio", "Crea changelog leggibile per sito o app.", "changelog", "Modifiche", "Incolla elenco modifiche"),
  tool("Mini Logo Maker", "tools.logo", "Creator Studio", "Genera concept testuale per logo e palette.", "logo", "Nome progetto", "HappyMeter"),
  tool("Cover Builder", "tools.cover", "Creator Studio", "Genera brief copertina per sito/zona.", "cover", "Tema", "Benessere quotidiano"),
  tool("Content Packager", "tools.content-pack", "Creator Studio", "Suggerisce alleggerimento contenuti prima della pubblicazione.", "content-pack", "Lista file", "Incolla nomi file o dimensioni"),
  tool("Prompt Sito Velora", "tools.prompt-site", "Creator Studio", "Crea prompt per adattare un sito a Velora.", "prompt-site", "Percorso o nome sito", "C:\\\\sito-da-convertire"),
  tool("Publish Plan", "tools.publish-plan", "Creator Studio", "Crea piano pubblicazione: controllo, manifest, upload, indicizzazione.", "publish-plan", "Zona", "nome.zona")
];

const defaultFeaturedSites = featuredSites.filter((site) => site.zone === "shop.demo" || site.verified);

const identityLevels = [
  ["Livello 0", "Account creato", "Accesso, navigazione, VeloMail e pubblicazione beta."],
  ["Livello 1", "Dispositivo verificato", "Account collegato al dispositivo attivo e pronto per pubblicare."],
  ["Livello 2", "Revisione avanzata", "Riservato alle verifiche manuali successive alla beta pubblica."]
];

const publisherPlans = [
  ["Livello 0", "Gratis", "Pubblicazione informativa con revisione entro 24 ore."],
  ["Livello 1", "Gratis", "Login Velora e SDK obbligatori per account base."],
  ["Livello 2", "1,99 EUR/mese", "Attributi verificati con consenso utente."],
  ["Livello 3", "4,99 EUR/mese", "Operazioni sensibili predisposte, pagamenti non ancora attivi."],
  ["Publisher Pro", "19,90 EUR/mese", "Supporto prioritario, strumenti avanzati e Siti Emergenti."]
];

function App() {
  const [workspace, setWorkspace] = React.useState<Workspace>("home");
  const [networkState, setNetworkState] = React.useState<NetworkState>("syncing");
  const [nodeMessage, setNodeMessage] = React.useState("Preparazione di Velora");
  const [query, setQuery] = React.useState("");
  const [address, setAddress] = React.useState("shop.demo");
  const [loadedSite, setLoadedSite] = React.useState<LoadedSiteDocument | null>(null);
  const [activeToolZone, setActiveToolZone] = React.useState("tools.tts");
  const [viewerState, setViewerState] = React.useState<ViewerState>("idle");
  const [viewerMessage, setViewerMessage] = React.useState("Cerca o apri una zona dell'Upper Web.");
  const [favorites, setFavorites] = React.useState<string[]>(["shop.demo"]);
  const [searchResults, setSearchResults] = React.useState<SearchCard[]>([]);
  const [publisherSitePath, setPublisherSitePath] = React.useState(demoSitePath);
  const [publisherAddress, setPublisherAddress] = React.useState("shop.demo");
  const [validation, setValidation] = React.useState<VeloraValidationResult | null>(null);
  const [packaged, setPackaged] = React.useState<PublisherPackageResponse | null>(null);
  const [releases, setReleases] = React.useState<PublisherReleaseRecord[]>([]);
  const [publishStage, setPublishStage] = React.useState<PublishStage>("idle");
  const [publishMessage, setPublishMessage] = React.useState("Seleziona una cartella del sito e avvia il controllo");
  const [session, setSession] = React.useState<AccountSession | null>(() => loadStoredSession());
  const [authMode, setAuthMode] = React.useState<AuthMode>("register");
  const [authForm, setAuthForm] = React.useState({ username: "", password: "" });
  const [authMessage, setAuthMessage] = React.useState("");
  const [mailAddress, setMailAddress] = React.useState("beta@velora");
  const [mailUserId, setMailUserId] = React.useState("");
  const [mailMessages, setMailMessages] = React.useState<MailMessage[]>([]);
  const [mailFolder, setMailFolder] = React.useState("INBOX");
  const [mailStatus, setMailStatus] = React.useState("Sincronizzazione VeloMail in attesa");
  const [mailDraft, setMailDraft] = React.useState({ to: "beta@velora", subject: "", body: "" });
  const [forumSections, setForumSections] = React.useState<ForumSection[]>([]);
  const [forumMessages, setForumMessages] = React.useState<ForumMessage[]>([]);
  const [forumDraft, setForumDraft] = React.useState("");
  const [forumStatus, setForumStatus] = React.useState("Forum in attesa");
  const [miningStatus, setMiningStatus] = React.useState<MiningLocalStatus | null>(null);
  const [miningMessage, setMiningMessage] = React.useState("Mining Partner non avviato");
  const [miningForm, setMiningFormState] = React.useState(() => loadStoredMiningForm());
  const [miningStats, setMiningStats] = React.useState<MiningUiStats>({ startedAt: null, elapsedSeconds: 0 });
  const [miningProgress, setMiningProgress] = React.useState<MiningProgress | null>(null);
  const [miningNetworkStats, setMiningNetworkStats] = React.useState<MiningNetworkStats | null>(null);
  const [miningHistory, setMiningHistory] = React.useState<any | null>(null);
  const [releaseCheck, setReleaseCheck] = React.useState<ReleaseCheck | null>(null);
  const [releaseMessage, setReleaseMessage] = React.useState("Controllo aggiornamenti in attesa");
  const [nodeIdentity, setNodeIdentity] = React.useState<{ peer_id: string; public_key: string } | null>(null);
  const [nodeEnrollMessage, setNodeEnrollMessage] = React.useState("Nodo utente non ancora attivato");
  const siteApi = createVeloraSiteApi(apiBaseUrl);

  function setMiningForm(form: MiningForm) {
    setMiningFormState(form);
    saveStoredMiningForm(form);
  }

  React.useEffect(() => {
    void prepareVelora();
    void refreshMiningStatus();
    void loadNodeIdentity();
    void checkForUpdates();
  }, []);

  React.useEffect(() => {
    if (!miningStatus?.running) {
      setMiningStats((current) => ({ startedAt: null, elapsedSeconds: current.elapsedSeconds }));
      return;
    }
    setMiningStats((current) => ({ startedAt: current.startedAt ?? Date.now(), elapsedSeconds: current.elapsedSeconds }));
    const timer = window.setInterval(() => {
      setMiningStats((current) => current.startedAt ? { ...current, elapsedSeconds: Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)) } : current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [miningStatus?.running]);

  React.useEffect(() => {
    if (!session) {
      return;
    }
    const slug = normalizeAccountSlug(session.user.username);
    setPublisherAddress(`shop.${slug}`);
    setMailDraft((current) => current.to === "beta@velora" || current.to === "alias@velora" ? { ...current, to: session.mail.address } : current);
    void loadForum(session);
  }, [session]);

  React.useEffect(() => {
    if (!session || workspace !== "forum") {
      return;
    }
    void loadForum(session);
    const timer = window.setInterval(() => void loadForum(session), 5000);
    return () => window.clearInterval(timer);
  }, [workspace, session?.token]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "VELORA_AUTH_REQUEST") {
        return;
      }
      handleSiteAuthRequest(event);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session]);

  async function prepareVelora() {
    try {
      setNodeMessage("Preparazione dei dati locali in corso");
      await invoke<string>("init_local_store");
      if (session) {
        applySession(session);
      }
      setNodeMessage("Connessione alla rete");
      await invoke("get_or_create_node_identity");
      setNetworkState("ready");
      setNodeMessage(session ? "Velora e pronta" : "Accedi o crea il tuo account Velora");
    } catch (error) {
      setNetworkState("limited");
      setNodeMessage("Velora sta preparando la connessione. Puoi continuare a esplorare.");
    }
  }

  async function submitAuth() {
    setAuthMessage("Connessione account in corso");
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/${authMode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: authForm.username.trim(), password: authForm.password })
      });
      if (!response.ok) {
        throw new Error(response.status === 409 ? "Alias gia utilizzato" : "Credenziali non valide");
      }
      const nextSession = await response.json() as AccountSession;
      saveStoredSession(nextSession);
      applySession(nextSession);
      setSession(nextSession);
      setAuthMessage("Account pronto");
      setNodeMessage("Velora e pronta");
      setNetworkState("ready");
      await enrollActiveDevice(nextSession);
      await loadMail("INBOX", nextSession);
      await loadForum(nextSession);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Accesso non riuscito");
    }
  }

  function logout() {
    localStorage.removeItem("velora.session");
    setSession(null);
    setMailUserId("");
    setMailAddress("alias@velora");
    setMailMessages([]);
    setForumMessages([]);
    setForumSections([]);
    setNodeMessage("Accedi o crea il tuo account Velora");
  }

  async function ensureFreshSession() {
    if (!session) {
      throw new Error("SESSION_REQUIRED");
    }
    const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : 0;
    if (!session.refreshToken || !expiresAt || expiresAt - Date.now() > 60_000) {
      return session;
    }
    const response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!response.ok) {
      logout();
      throw new Error("Sessione scaduta. Accedi di nuovo e riprova.");
    }
    const refreshed = await response.json() as Pick<AccountSession, "token" | "refreshToken" | "expiresAt">;
    const nextSession: AccountSession = {
      ...session,
      token: refreshed.token,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    };
    saveStoredSession(nextSession);
    setSession(nextSession);
    return nextSession;
  }

  function applySession(nextSession: AccountSession) {
    setMailUserId(nextSession.user.id);
    setMailAddress(nextSession.mail.address);
  }

  async function enrollActiveDevice(activeSession: AccountSession) {
    const freshSession = activeSession === session ? await ensureFreshSession() : activeSession;
    const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
    const response = await fetch(`${apiBaseUrl}/api/v1/devices/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(freshSession) },
      body: JSON.stringify({ peerId: identity.peer_id, publicKey: identity.public_key, deviceName: "Velora Desktop" })
    });
    if (response.status === 409) {
      setNodeMessage("Hai gia associato tre account a questo dispositivo.");
    }
  }

  function looksLikeTraditionalWeb(value: string) {
    return /^(https?:\/\/|www\.)/i.test(value.trim());
  }

  function looksLikeZone(value: string) {
    return /^[a-z0-9][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,30}$/i.test(value.trim());
  }

  async function openZone(zone = query || address) {
    const normalized = zone.trim().toLowerCase();
    if (!normalized) {
      setViewerState("idle");
      setViewerMessage("Inserisci una zona o una ricerca.");
      return;
    }
    if (looksLikeTraditionalWeb(normalized)) {
      setViewerState("blocked");
      setLoadedSite(null);
      setViewerMessage("Questo indirizzo non appartiene all'Upper Web.");
      return;
    }
    const toolMatch = veloraTools.find((item) => item.zone === normalized);
    if (toolMatch) {
      setActiveToolZone(toolMatch.zone);
      setWorkspace("tools");
      setQuery(normalized);
      setSearchResults(veloraTools.filter((item) => item.group === toolMatch.group));
      setViewerState("ready");
      setViewerMessage(`${toolMatch.title} pronto`);
      return;
    }
    if (!looksLikeZone(normalized)) {
      await runSearch(normalized);
      return;
    }

    setAddress(normalized);
    setWorkspace("explore");
    setViewerState("loading");
    setViewerMessage("Ricerca provider");
    try {
      setViewerMessage("Download contenuto");
      const result = await invoke<LoadedSiteDocument>("load_site_document", {
        input: {
          address: normalized
        }
      });
      setViewerMessage("Verifica firma");
      setLoadedSite(result);
      setViewerState("ready");
      setViewerMessage(`${result.title} pronto`);
    } catch (error) {
      setLoadedSite(null);
      setViewerState(normalized === "shop.demo" ? "error" : "not-found");
      setViewerMessage(normalized === "shop.demo" ? "Errore temporaneo nella preparazione della zona." : "Zona non trovata.");
    }
  }

  async function runSearch(value = query) {
    const normalized = value.trim().toLowerCase();
    if (looksLikeTraditionalWeb(normalized)) {
      setWorkspace("home");
      setViewerState("blocked");
      setViewerMessage("Questo indirizzo non appartiene all'Upper Web.");
      return;
    }
    if (looksLikeZone(normalized)) {
      await openZone(normalized);
      return;
    }

    setWorkspace("explore");
    const localTools = veloraTools.filter((toolItem) => {
      const haystack = `${toolItem.title} ${toolItem.zone} ${toolItem.description} ${toolItem.category} ${toolItem.publisher} ${toolItem.group}`.toLowerCase();
      return !normalized || haystack.includes(normalized);
    });
    const localResults = normalized ? localTools : [...defaultFeaturedSites, ...localTools].filter((site) => {
      const haystack = `${site.title} ${site.zone} ${site.description} ${site.category} ${site.publisher}`.toLowerCase();
      return !normalized || haystack.includes(normalized);
    });

    try {
      const result = normalized ? await siteApi.search(normalized) : { results: [] };
      const remoteResults = (result.results ?? []).map<SearchCard>((item) => ({
        title: item.title ?? item.address,
        zone: item.address,
        description: item.description ?? "Risultato indicizzato nella rete Velora.",
        category: item.category ?? "Upper Web",
        publisher: item.publisher ?? (item.category === "OCEANO" ? "Velora Oceano" : item.address.split(".").slice(-1)[0] ?? "Publisher verificato"),
        identityLevel: item.trust_level ? `Trust ${item.trust_level}` : "Livello 0",
        verified: Number(item.trust_level ?? 0) > 0 || item.category === "OCEANO",
        familySafe: item.family_safe !== false,
        availability: item.availability > 0 ? "Disponibile" : "Indicizzato",
        updatedAt: item.release_version ? `Release ${item.release_version}` : "Recente"
      }));
      setSearchResults(mergeSearchResults(remoteResults, localResults).slice(0, 12));
    } catch {
      setSearchResults(localResults);
    }
  }

  async function validateRelease() {
    setPublishStage("validating");
    setPublishMessage("Controllo dei contenuti in corso");
    try {
      const result = await invoke<VeloraValidationResult>("validate_local_release", {
        input: { sitePath: publisherSitePath }
      });
      setValidation(result);
      setPackaged(null);
      setPublishStage(result.valid ? "idle" : "error");
      setPublishMessage(result.valid ? "Controllo completato, il sito puo essere preparato" : "Controllo completato, correggi gli errori prima di pubblicare");
    } catch (error) {
      setPublishStage("error");
      setPublishMessage(error instanceof Error ? error.message : "Controllo non riuscito");
    }
  }

  async function packageRelease() {
    setPublishStage("packaging");
    setPublishMessage("Preparazione del pacchetto locale");
    try {
      await ensureFreshSession();
      const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
      const result = await invoke<PublisherPackageResponse>("package_local_release", {
        input: { sitePath: publisherSitePath, publisherPublicKey: identity.public_key }
      });
      setPackaged(result);
      await invoke("cache_packaged_release", {
        input: {
          ...result,
          releaseId: null,
          status: "PACKAGED_LOCAL"
        }
      });
      setPublishStage("idle");
      setPublishMessage("Pacchetto pronto, puoi inviare la pubblicazione");
    } catch (error) {
      setPublishStage("error");
      setPublishMessage(error instanceof Error ? error.message : "Preparazione non riuscita");
    }
  }

  async function choosePublisherFolder() {
    setPublishStage("selecting");
    setPublishMessage("Apertura selettore cartella");
    try {
      const result = await invoke<{ path: string | null }>("choose_site_folder");
      if (result.path) {
        setPublisherSitePath(result.path);
        setValidation(null);
        setPackaged(null);
        setPublishStage("validating");
        setPublishMessage("Cartella selezionata, controllo automatico in corso");
        const validationResult = await invoke<VeloraValidationResult>("validate_local_release", {
          input: { sitePath: result.path }
        });
        setValidation(validationResult);
        setPublishStage(validationResult.valid ? "idle" : "error");
        setPublishMessage(validationResult.valid ? "Controllo completato, il sito puo essere preparato" : "Controllo completato, correggi gli errori prima di pubblicare");
        return;
      }
      setPublishStage("idle");
      setPublishMessage("Selezione annullata");
    } catch (error) {
      setPublishStage("error");
      setPublishMessage(error instanceof Error ? error.message : "Selezione cartella non riuscita");
    }
  }

  async function openPublisherFolder() {
    if (!publisherSitePath) {
      return;
    }
    try {
      await invoke("open_site_folder", { path: publisherSitePath });
    } catch (error) {
      setPublishStage("error");
      setPublishMessage(error instanceof Error ? error.message : "Impossibile aprire la cartella");
    }
  }

  async function registerRelease() {
    if (!packaged) {
      return;
    }
    setPublishStage("publishing");
    setPublishMessage("Invio della pubblicazione a Velora");
    try {
      const freshSession = await ensureFreshSession();
      const userId = freshSession.user.id;
      const result = await siteApi.registerRelease({ ...packaged, token: freshSession.token, userId });
      await invoke("cache_packaged_release", {
        input: {
          ...packaged,
          releaseId: result.releaseId ?? null,
          status: result.status
        }
      });
      setNodeMessage(result.status === "ACTIVE" ? "Sito pubblicato su Velora" : "Pubblicazione inviata");
      setPublishStage("success");
      setPublishMessage(result.status === "ACTIVE" ? "Pubblicazione completata e release attiva" : "Pubblicazione inviata, attendi la review della rete");
      await loadReleases();
    } catch (error) {
      setPublishStage("error");
      setPublishMessage(error instanceof Error ? error.message : "Pubblicazione non riuscita");
    }
  }

  async function loadReleases() {
    const result = await siteApi.listReleases(publisherAddress);
    setReleases(result.releases ?? []);
  }

  function toggleFavorite(zone: string) {
    setFavorites((current) => current.includes(zone) ? current.filter((item) => item !== zone) : [...current, zone]);
  }

  async function loadMail(folder = mailFolder, activeSession = session) {
    setWorkspace("mail");
    setMailFolder(folder);
    setMailStatus("Sincronizzazione in corso");
    try {
      const freshSession = activeSession === session ? await ensureFreshSession() : activeSession;
      if (!freshSession) {
        throw new Error("SESSION_REQUIRED");
      }
      const accountResponse = await fetch(`${apiBaseUrl}/api/v1/mail/account`, { headers: authHeaders(freshSession) });
      if (accountResponse.ok) {
        const account = await accountResponse.json() as { address: string };
        setMailAddress(account.address);
      }
      const endpoint = folder === "INBOX" ? "/api/v1/mail/inbox" : `/api/v1/mail/folders/${encodeURIComponent(folder)}`;
      const response = await fetch(`${apiBaseUrl}${endpoint}`, { headers: authHeaders(freshSession) });
      if (!response.ok) {
        throw new Error("MAIL_SYNC_FAILED");
      }
      const result = await response.json() as { messages: MailMessage[] };
      setMailMessages(result.messages ?? []);
      setMailStatus("Sincronizzato");
    } catch (error) {
      setMailStatus(error instanceof Error && error.message === "SESSION_REQUIRED" ? "Accedi per usare VeloMail" : "VeloMail non disponibile in questo momento");
    }
  }

  async function sendMail() {
    setMailStatus("Invio in corso");
    try {
      const freshSession = await ensureFreshSession();
      const sealed = await sealVeloMailDraft(mailDraft.subject, mailDraft.body);
      const response = await fetch(`${apiBaseUrl}/api/v1/mail/send`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({
          to: mailDraft.to.split(",").map((item: string) => item.trim()).filter(Boolean),
          subject: mailDraft.subject,
          subjectCiphertext: sealed.subjectCiphertext,
          bodyCiphertext: sealed.bodyCiphertext,
          encryptedByClient: true
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { code?: string; message?: string; error?: string };
        throw new Error(payload.code ?? payload.message ?? payload.error ?? "MAIL_SEND_FAILED");
      }
      setMailDraft({ to: mailDraft.to, subject: "", body: "" });
      await loadMail("SENT");
    } catch (error) {
      setMailStatus(error instanceof Error && error.message === "SESSION_REQUIRED" ? "Accedi per inviare mail" : `Invio non riuscito: ${error instanceof Error ? error.message : "errore"}`);
    }
  }

  async function loadForum(activeSession = session) {
    if (!activeSession) {
      setForumStatus("Accedi per usare il Forum");
      return;
    }
    try {
      const freshSession = activeSession === session ? await ensureFreshSession() : activeSession;
      if (!freshSession) {
        throw new Error("SESSION_REQUIRED");
      }
      const sectionsResponse = await fetch(`${apiBaseUrl}/api/v1/forum/sections`, { headers: authHeaders(freshSession) });
      if (!sectionsResponse.ok) {
        throw new Error("FORUM_UNAVAILABLE");
      }
      const sectionsPayload = await sectionsResponse.json() as { sections: ForumSection[] };
      setForumSections(sectionsPayload.sections ?? []);
      const messagesResponse = await fetch(`${apiBaseUrl}/api/v1/forum/sections/global-chat/messages`, { headers: authHeaders(freshSession) });
      if (!messagesResponse.ok) {
        throw new Error("FORUM_MESSAGES_UNAVAILABLE");
      }
      const messagesPayload = await messagesResponse.json() as { messages: ForumMessage[] };
      setForumMessages(messagesPayload.messages ?? []);
      setForumStatus("Connesso");
    } catch (error) {
      setForumStatus(error instanceof Error && error.message === "SESSION_REQUIRED" ? "Accedi per usare il Forum" : "Riconnessione");
    }
  }

  async function sendForumMessage() {
    const body = forumDraft.trim();
    if (!body || body.length > 200) {
      return;
    }
    const previousDraft = forumDraft;
    setForumStatus("Invio");
    try {
      const freshSession = await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/forum/sections/global-chat/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({ body })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { code?: string };
        throw new Error(payload.code ?? "FORUM_SEND_FAILED");
      }
      setForumDraft("");
      setForumStatus("Connesso");
      await loadForum(freshSession);
    } catch (error) {
      setForumDraft(previousDraft);
      setForumStatus(error instanceof Error && error.message === "SESSION_REQUIRED" ? "Accedi per inviare messaggi" : error instanceof Error ? error.message : "Non inviato");
    }
  }

  async function refreshMiningStatus() {
    const status = await invoke<MiningLocalStatus>("mining_status");
    setMiningStatus(status);
    setMiningMessage(status.message);
    await loadMiningProgress();
  }

  async function loadMiningProgress(activeSession?: AccountSession) {
    const currentSession = activeSession ?? session;
    if (!currentSession) {
      setMiningProgress(null);
      setMiningNetworkStats(null);
      return;
    }
    try {
      const freshSession = activeSession ?? await ensureFreshSession();
      const [progressResponse, networkResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/mining/progress`, { headers: authHeaders(freshSession) }),
        fetch(`${apiBaseUrl}/api/mining/network/stats`, { headers: authHeaders(freshSession) })
      ]);
      if (progressResponse.ok) {
        setMiningProgress(await progressResponse.json() as MiningProgress);
      }
      if (networkResponse.ok) {
        setMiningNetworkStats(await networkResponse.json() as MiningNetworkStats);
      }
      const historyResponse = await fetch(`${apiBaseUrl}/api/v1/mining/history`, { headers: authHeaders(freshSession) });
      if (historyResponse.ok) {
        setMiningHistory(await historyResponse.json());
      }
    } catch {
      setMiningProgress(null);
      setMiningNetworkStats(null);
      setMiningHistory(null);
    }
  }

  async function checkForUpdates() {
    try {
      setReleaseMessage("Controllo aggiornamenti");
      const response = await fetch(`${apiBaseUrl}/api/v1/releases/check`);
      if (!response.ok) {
        throw new Error("Controllo aggiornamenti non disponibile");
      }
      const data = await response.json() as ReleaseCheck;
      setReleaseCheck(data);
      setReleaseMessage(`Versione ${data.latestVersion} ${data.channel}`);
    } catch (error) {
      setReleaseMessage(error instanceof Error ? error.message : "Aggiornamenti non disponibili");
    }
  }

  async function markRecoverySeen() {
    if (!session) {
      return;
    }
    try {
      const freshSession = await ensureFreshSession();
      await fetch(`${apiBaseUrl}/api/v1/auth/recovery-token/seen`, { method: "POST", headers: authHeaders(freshSession) });
      const nextSession = { ...freshSession, recovery: { required: false, visibleOnce: false } };
      saveStoredSession(nextSession);
      setSession(nextSession);
      setAuthMessage("Key token confermato e nascosto");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Conferma token non riuscita");
    }
  }

  async function loadNodeIdentity() {
    const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
    setNodeIdentity(identity);
  }

  async function activateUserNode() {
    if (!session) {
      setNodeEnrollMessage("Accedi o crea un account Velora prima di attivare il nodo");
      return;
    }
    try {
      setNodeEnrollMessage("Attivazione nodo utente in corso");
      const freshSession = await ensureFreshSession();
      const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
      setNodeIdentity(identity);
      const response = await fetch(`${apiBaseUrl}/api/v1/contribution/nodes/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({
          devicePeerId: identity.peer_id,
          publicKey: identity.public_key,
          module: "VELORA_NODE",
          resourceProfile: "STANDARD"
        })
      });
      if (!response.ok) {
        setNodeEnrollMessage(await response.text());
        return;
      }
      setNodeEnrollMessage("Nodo utente attivo e collegato al tuo account");
    } catch (error) {
      setNodeEnrollMessage(error instanceof Error ? error.message : "Attivazione nodo non riuscita");
    }
  }

  async function startMiningPartner() {
    if (!session) {
      setMiningMessage("Accedi o crea un account Velora prima di attivare il mining");
      return;
    }
    if (!miningForm.payoutWallet.trim()) {
      setMiningMessage("Inserisci il tuo wallet pubblico XMR o ZEPH");
      return;
    }
    try {
      setMiningMessage("Creo worker e preparo miner");
      const freshSession = await ensureFreshSession();
      const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
      const createWorker = await fetch(`${apiBaseUrl}/api/v1/mining/workers`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({
          coin: miningForm.coin,
          devicePeerId: identity.peer_id,
          publicKey: identity.public_key,
          payoutWallet: miningForm.payoutWallet,
          enabled: true
        })
      });
      if (!createWorker.ok) {
        setMiningMessage(await createWorker.text());
        return;
      }
      const workerPayload = await createWorker.json();
      let minerConfig = workerPayload.minerConfig;
      if (!minerConfig) {
        const workerId = workerPayload.worker?.id ?? workerPayload.worker?.workerId;
        const configResponse = await fetch(`${apiBaseUrl}/api/mining/workers/${workerId}/config`, { headers: authHeaders(freshSession) });
        if (!configResponse.ok) {
          setMiningMessage(await configResponse.text());
          return;
        }
        minerConfig = await configResponse.json();
      }
      const status = await invoke<MiningLocalStatus>("start_mining", {
        input: {
          poolUrl: minerConfig.poolUrl,
          username: minerConfig.poolUsername,
          password: minerConfig.poolPassword,
          threads: Number(miningForm.threads) || 2,
          cpuPriority: Number(miningForm.cpuPriority) || 1
        }
      });
      setMiningStatus(status);
      setMiningStats({ startedAt: status.running ? Date.now() : null, elapsedSeconds: 0 });
      setMiningMessage(status.running ? "Mining avviato. Velora sta usando XMRig locale con il tuo worker." : status.message);
      await loadMiningProgress(freshSession);
    } catch (error) {
      setMiningMessage(error instanceof Error ? error.message : "Avvio mining non riuscito");
    }
  }

  async function stopMiningPartner() {
    const status = await invoke<MiningLocalStatus>("stop_mining");
    setMiningStatus(status);
    setMiningStats((current) => ({ ...current, startedAt: null }));
    setMiningMessage("Mining fermato");
  }

  async function requestManualMiningPayout() {
    if (!session) {
      setMiningMessage("Accedi per richiedere payout");
      return;
    }
    if (!miningForm.payoutWallet.trim()) {
      setMiningMessage("Inserisci wallet pubblico payout");
      return;
    }
    try {
      const freshSession = await ensureFreshSession();
      const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
      const response = await fetch(`${apiBaseUrl}/api/v1/mining/payout-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({
          coin: miningForm.coin,
          devicePeerId: identity.peer_id,
          payoutWallet: miningForm.payoutWallet,
          note: "Richiesta payout manuale da desktop beta"
        })
      });
      if (!response.ok) {
        setMiningMessage(await response.text());
        return;
      }
      setMiningMessage("Richiesta payout inviata. Verifica manuale in pannello admin.");
      await loadMiningProgress(freshSession);
    } catch (error) {
      setMiningMessage(error instanceof Error ? error.message : "Richiesta payout non riuscita");
    }
  }

  function handleSiteAuthRequest(event?: MessageEvent) {
    if (session) {
      setNodeMessage(`Account Velora attivo: ${session.mail.address}`);
      event?.source?.postMessage({
        type: "VELORA_AUTH_STATE",
        loggedIn: true,
        mail: session.mail.address,
        username: session.user.username
      }, { targetOrigin: "*" });
      return;
    }
    setWorkspace("home");
    setAuthMode("register");
    setAuthMessage("Crea o accedi al tuo account Velora per continuare nel sito.");
  }

  async function requireSessionUserId() {
    if (mailUserId) {
      return mailUserId;
    }
    if (session) {
      applySession(session);
      return session.user.id;
    }
    throw new Error("Accedi al tuo account Velora");
  }

  async function verifyIdentity() {
    try {
      await requireSessionUserId();
      if (!session) {
        throw new Error("SESSION_REQUIRED");
      }
      const response = await fetch(`${apiBaseUrl}/api/v1/identity/verify-basic`, {
        method: "POST",
        headers: authHeaders(session)
      });
      if (!response.ok) {
        throw new Error("IDENTITY_VERIFICATION_FAILED");
      }
      const result = await response.json() as { identityLevel: number };
      const nextSession = session ? {
        ...session,
        user: { ...session.user, identityLevel: Number(result.identityLevel ?? 1) },
        mail: { ...session.mail, identityLevel: Number(result.identityLevel ?? 1) }
      } : null;
      if (nextSession) {
        saveStoredSession(nextSession);
        setSession(nextSession);
      }
      setNodeMessage("Identita verificata su questo dispositivo");
    } catch (error) {
      setNodeMessage("Verifica identita non riuscita");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar workspace={workspace} setWorkspace={setWorkspace} networkState={networkState} />
      <main className="main">
        <TopBar networkState={networkState} nodeMessage={nodeMessage} session={session} onLogout={logout} />
        {!session ? (
          <AccountGate
            mode={authMode}
            setMode={setAuthMode}
            form={authForm}
            setForm={setAuthForm}
            message={authMessage}
            onSubmit={() => void submitAuth()}
          />
        ) : null}
        {workspace === "home" ? (
          <Home query={query} setQuery={setQuery} onSubmit={() => void openZone()} onSearch={() => void runSearch()} onOpen={openZone} onMail={() => void loadMail("INBOX")} viewerState={viewerState} viewerMessage={viewerMessage} session={session} releaseCheck={releaseCheck} releaseMessage={releaseMessage} onCheckUpdates={() => void checkForUpdates()} />
        ) : null}
        {workspace === "explore" ? (
          <Explore
            address={address}
            query={query}
            setQuery={setQuery}
            loadedSite={loadedSite}
            viewerState={viewerState}
            viewerMessage={viewerMessage}
            searchResults={searchResults}
            favorites={favorites}
            onOpen={openZone}
            onSearch={runSearch}
            onFavorite={toggleFavorite}
          />
        ) : null}
        {workspace === "tools" ? (
          <VeloraTools
            tools={veloraTools}
            activeZone={activeToolZone}
            setActiveZone={setActiveToolZone}
            session={session}
            miningStatus={miningStatus}
            miningProgress={miningProgress}
            miningNetworkStats={miningNetworkStats}
            nodeIdentity={nodeIdentity}
            releaseCheck={releaseCheck}
            onOpenZone={openZone}
            onRefreshMining={() => void refreshMiningStatus()}
            onRefreshNode={() => void loadNodeIdentity()}
            onCheckUpdates={() => void checkForUpdates()}
          />
        ) : null}
        {workspace === "mail" ? (
          <VeloMail
            address={mailAddress}
            messages={mailMessages}
            folder={mailFolder}
            status={mailStatus}
            draft={mailDraft}
            setDraft={setMailDraft}
            onOpenFolder={(folder) => void loadMail(folder)}
            onSend={() => void sendMail()}
          />
        ) : null}
        {workspace === "forum" ? (
          <Forum
            sections={forumSections}
            messages={forumMessages}
            draft={forumDraft}
            setDraft={setForumDraft}
            status={forumStatus}
            session={session}
            onSend={() => void sendForumMessage()}
            onRefresh={() => void loadForum()}
          />
        ) : null}
        {workspace === "mining" ? (
          <MiningPartner
            status={miningStatus}
            message={miningMessage}
            form={miningForm}
            setForm={setMiningForm}
            stats={miningStats}
            progress={miningProgress}
            networkStats={miningNetworkStats}
            history={miningHistory}
            onRefresh={() => void refreshMiningStatus()}
            onStart={() => void startMiningPartner()}
            onStop={() => void stopMiningPartner()}
            onPayoutRequest={() => void requestManualMiningPayout()}
          />
        ) : null}
        {workspace === "nodes" ? <UserNodes identity={nodeIdentity} message={nodeEnrollMessage} onRefresh={() => void loadNodeIdentity()} onActivate={() => void activateUserNode()} /> : null}
        {workspace === "favorites" ? <SimpleCollection title="Preferiti" items={favorites} onOpen={openZone} /> : null}
        {workspace === "activity" ? <Activity /> : null}
        {workspace === "identity" ? <Identity session={session} onVerify={() => void verifyIdentity()} onRecoverySeen={() => void markRecoverySeen()} /> : null}
        {workspace === "notifications" ? <Notifications /> : null}
        {workspace === "settings" ? <Settings nodeMessage={nodeMessage} releaseCheck={releaseCheck} releaseMessage={releaseMessage} onRetry={() => void prepareVelora()} onCheckUpdates={() => void checkForUpdates()} /> : null}
        {workspace === "dev" ? (
          <VeloraDev
            sitePath={publisherSitePath}
            setSitePath={setPublisherSitePath}
            address={publisherAddress}
            setAddress={setPublisherAddress}
            validation={validation}
            packaged={packaged}
            releases={releases}
            publishStage={publishStage}
            publishMessage={publishMessage}
            session={session}
            onChooseFolder={choosePublisherFolder}
            onOpenFolder={openPublisherFolder}
            onValidate={validateRelease}
            onPackage={packageRelease}
            onRegister={registerRelease}
            onRefresh={loadReleases}
          />
        ) : null}
        {workspace === "control" ? <ControlCenter /> : null}
      </main>
    </div>
  );
  }

function Sidebar({ workspace, setWorkspace, networkState }: { workspace: Workspace; setWorkspace: (workspace: Workspace) => void; networkState: NetworkState }) {
  const primary: Array<[Workspace, string]> = [
    ["home", "Home"],
    ["explore", "Esplora"],
    ["tools", "Velora Tools"],
    ["mail", "VeloMail"],
    ["forum", "Forum"],
    ["mining", "Mining Partner"],
    ["nodes", "Nodi utente"],
    ["favorites", "Preferiti"],
    ["activity", "Attivita"],
    ["identity", "Identita"],
    ["notifications", "Notifiche"]
  ];
  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <span className="brand-v">V</span>
        <div>
          <strong>{desktopBranding.projectName}</strong>
          <small>L'Upper Web</small>
        </div>
      </div>
      <nav>
        {primary.map(([key, label]) => (
          <button key={key} className={workspace === key ? "active" : ""} onClick={() => setWorkspace(key)}>{label}</button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className={workspace === "dev" ? "active dev-entry" : "dev-entry"} onClick={() => setWorkspace("dev")}>Pubblica sito</button>
        {isAdminSessionEnabled ? <button className={workspace === "control" ? "active" : ""} onClick={() => setWorkspace("control")}>Control Center</button> : null}
        <button className={workspace === "settings" ? "active" : ""} onClick={() => setWorkspace("settings")}>Impostazioni</button>
        <span className={`network ${networkState}`}>{networkLabel(networkState)}</span>
      </div>
    </aside>
  );
}

function TopBar({ networkState, nodeMessage, session, onLogout }: { networkState: NetworkState; nodeMessage: string; session: AccountSession | null; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">VELORA <b>BETA</b></span>
        <p>{nodeMessage}</p>
      </div>
      <div className="top-actions">
        <span className={`status-dot ${networkState}`} />
        <button type="button" aria-label="Notifiche">Notifiche</button>
        {session ? <button type="button" aria-label="Profilo">{session.mail.address}</button> : null}
        {session ? <button type="button" className="secondary" onClick={onLogout}>Esci</button> : null}
      </div>
    </header>
  );
}

function AccountGate(props: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  form: { username: string; password: string };
  setForm: (form: { username: string; password: string }) => void;
  message: string;
  onSubmit: () => void;
}) {
  return (
    <section className="account-gate">
      <div>
        <span className="eyebrow">ACCOUNT VELORA</span>
        <h1>{props.mode === "register" ? "Crea il tuo accesso" : "Accedi a Velora"}</h1>
      </div>
      <div className="auth-controls">
        <button className={props.mode === "register" ? "active" : ""} type="button" onClick={() => props.setMode("register")}>Registrati</button>
        <button className={props.mode === "login" ? "active" : ""} type="button" onClick={() => props.setMode("login")}>Accedi</button>
      </div>
      <label>Alias<input value={props.form.username} onChange={(event) => props.setForm({ ...props.form, username: event.target.value })} placeholder="il-tuo-alias" /></label>
      <label>Password<input type="password" value={props.form.password} onChange={(event) => props.setForm({ ...props.form, password: event.target.value })} placeholder="Password" /></label>
      <button type="button" onClick={props.onSubmit}>{props.mode === "register" ? "Crea account" : "Accedi"}</button>
      {props.message ? <p>{props.message}</p> : null}
    </section>
  );
}

function Home({ query, setQuery, onSubmit, onSearch, onOpen, onMail, viewerState, viewerMessage, session, releaseCheck, releaseMessage, onCheckUpdates }: {
  query: string;
  setQuery: (query: string) => void;
  onSubmit: () => void;
  onSearch: () => void;
  onOpen: (zone: string) => void;
  onMail: () => void;
  viewerState: ViewerState;
  viewerMessage: string;
  session: AccountSession | null;
  releaseCheck: ReleaseCheck | null;
  releaseMessage: string;
  onCheckUpdates: () => void;
}) {
  return (
    <section className="home">
      <div className="hero">
        <div className="hero-orbit" />
        <span className="eyebrow">Sicuro. Veloce. Semplice. Per tutti.</span>
        <h1>Cosa vuoi trovare nell'Upper Web?</h1>
        <p>Cerca servizi, applicazioni e zone pubblicate su Velora.</p>
        <div className="search-hero">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSubmit();
              }
            }}
            placeholder="Cerca su Velora o inserisci una zona"
            aria-label="Cerca su Velora o inserisci una zona"
          />
          <button type="button" onClick={onSubmit}>Vai</button>
          <button type="button" className="secondary" onClick={onSearch}>Cerca</button>
        </div>
        {viewerState === "blocked" ? <p className="warning">{viewerMessage}</p> : null}
      </div>
      <section className="content-grid">
        <article className="glass-card velomail-card">
          <span className="app-pill">App Velora</span>
          <h2>VeloMail</h2>
          <p>{session ? `Casella attiva: ${session.mail.address}` : "Accedi per attivare la tua casella."}</p>
          <button type="button" onClick={onMail} disabled={!session}>Apri VeloMail</button>
        </article>
        <FeatureBlock title="Siti verificati" sites={featuredSites.filter((site) => site.verified)} onOpen={onOpen} />
        <article className="glass-card">
          <span className="app-pill">Aggiornamenti</span>
          <h2>Velora Beta</h2>
          <p>{releaseMessage}</p>
          <p>{releaseCheck?.latestVersion ? `Ultima versione: ${releaseCheck.latestVersion}` : "Premi controlla per leggere manifest e changelog."}</p>
          <button type="button" onClick={onCheckUpdates}>Controlla aggiornamenti</button>
        </article>
        <FeatureBlock title="Siti Emergenti" sites={featuredSites.slice(0, 2)} onOpen={onOpen} />
        <CategoryCloud />
        <Milestones />
      </section>
    </section>
  );
}

function Explore(props: {
  address: string;
  query: string;
  setQuery: (query: string) => void;
  loadedSite: LoadedSiteDocument | null;
  viewerState: ViewerState;
  viewerMessage: string;
  searchResults: SearchCard[];
  favorites: string[];
  onOpen: (zone: string) => void;
  onSearch: (query?: string) => void;
  onFavorite: (zone: string) => void;
}) {
  return (
    <section className="workspace-grid">
      <div className="zone-browser">
        <div className="zone-toolbar">
          <button type="button" aria-label="Indietro">Indietro</button>
          <button type="button" aria-label="Avanti">Avanti</button>
          <button type="button" aria-label="Ricarica" onClick={() => props.onOpen(props.address)}>Ricarica</button>
          <input
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.onOpen(props.query);
              }
            }}
            placeholder="Zona o ricerca Velora"
          />
          <span className="security-badge">Verifica Velora</span>
          <button type="button" onClick={() => props.onFavorite(props.address)}>{props.favorites.includes(props.address) ? "Preferito" : "Salva"}</button>
        </div>
        <div className="viewer">
          {props.viewerState === "ready" && props.loadedSite ? (
            <iframe className="site-frame" title={props.loadedSite.title} sandbox="allow-scripts allow-forms" srcDoc={props.loadedSite.html} />
          ) : (
            <ViewerStateCard state={props.viewerState} message={props.viewerMessage} />
          )}
        </div>
      </div>
      <SearchResults results={props.searchResults} onOpen={props.onOpen} />
    </section>
  );
}

function ViewerStateCard({ state, message }: { state: ViewerState; message: string }) {
  const title = {
    idle: "Upper Web pronto",
    loading: "Caricamento zona",
    verifying: "Verifica firma",
    ready: "Zona pronta",
    "not-found": "Zona non trovata",
    blocked: "Indirizzo non valido",
    unavailable: "Contenuto non disponibile",
    error: "Errore temporaneo"
  }[state];
  return (
    <div className={`viewer-state ${state}`}>
      <span className="loader" />
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

function SearchResults({ results, onOpen }: { results: SearchCard[]; onOpen: (zone: string) => void }) {
  return (
    <aside className="results-panel">
      <h2>Risultati Velora</h2>
      {results.length ? results.map((result) => <SiteCard key={result.zone} site={result} onOpen={onOpen} />) : (
        <div className="empty-state">
          <h3>Nessun risultato trovato</h3>
          <p>Prova un'altra parola o esplora le categorie.</p>
        </div>
      )}
    </aside>
  );
}

function VeloMail(props: {
  address: string;
  messages: MailMessage[];
  folder: string;
  status: string;
  draft: { to: string; subject: string; body: string };
  setDraft: (draft: { to: string; subject: string; body: string }) => void;
  onOpenFolder: (folder: string) => void;
  onSend: () => void;
}) {
  const folders = [
    ["INBOX", "Posta in arrivo"],
    ["SENT", "Inviati"],
    ["DRAFTS", "Bozze"],
    ["ARCHIVE", "Archivio"],
    ["SPAM", "Spam"],
    ["TRASH", "Cestino"]
  ];
  return (
    <section className="mail-shell">
      <aside className="mail-sidebar">
        <h2>VeloMail</h2>
        <p>{props.address}</p>
        <button type="button" className="compose-button">Nuovo messaggio</button>
        {folders.map(([folder, label]) => (
          <button key={folder} className={props.folder === folder ? "active" : ""} type="button" onClick={() => props.onOpenFolder(folder)}>{label}</button>
        ))}
      </aside>
      <div className="mail-list">
        <div className="mail-toolbar">
          <div>
            <span className="eyebrow">Posta Upper Web</span>
            <h1>{folders.find(([folder]) => folder === props.folder)?.[1] ?? "VeloMail"}</h1>
          </div>
          <span className="sync-badge">{props.status}</span>
        </div>
        {props.messages.length ? props.messages.map((message) => (
          <article key={message.id} className={message.isRead ? "mail-row" : "mail-row unread"}>
            <strong>{message.senderAddress}</strong>
            <div>
              <h3>{message.subject}</h3>
              <p>{message.bodyPreview || "Messaggio cifrato disponibile nella casella."}</p>
            </div>
            <span>{message.deliveryStatus}</span>
          </article>
        )) : (
          <div className="empty-state">
            <h3>Nessun messaggio in questa cartella</h3>
            <p>La casella e pronta. I messaggi VeloMail arrivano qui quando la rete li consegna.</p>
          </div>
        )}
      </div>
      <aside className="composer">
        <h2>Componi</h2>
        <label>Destinatari</label>
        <input value={props.draft.to} onChange={(event) => props.setDraft({ ...props.draft, to: event.target.value })} placeholder="alias@velora" />
        <label>Oggetto</label>
        <input value={props.draft.subject} onChange={(event) => props.setDraft({ ...props.draft, subject: event.target.value })} placeholder="Oggetto" />
        <label>Messaggio</label>
        <textarea value={props.draft.body} onChange={(event) => props.setDraft({ ...props.draft, body: event.target.value })} placeholder="Scrivi un messaggio VeloMail" />
        <button type="button" onClick={props.onSend}>Invia</button>
      </aside>
    </section>
  );
}

function SiteCard({ site, onOpen }: { site: SearchCard; onOpen: (zone: string) => void }) {
  return (
    <article className="site-card">
      <div className="site-icon">{site.title.slice(0, 1)}</div>
      <div>
        <h3>{site.title}</h3>
        <p>{site.description}</p>
        <div className="meta-row">
          <span>{site.zone}</span>
          <span>{site.category}</span>
          <span>{site.identityLevel}</span>
          {site.verified ? <span className="verified">Verificato</span> : null}
          {site.familySafe ? <span>Family safe</span> : null}
        </div>
      </div>
      <button type="button" onClick={() => onOpen(site.zone)}>Apri</button>
    </article>
  );
}

function VeloraTools(props: {
  tools: ToolDefinition[];
  activeZone: string;
  setActiveZone: (zone: string) => void;
  session: AccountSession | null;
  miningStatus: MiningLocalStatus | null;
  miningProgress: MiningProgress | null;
  miningNetworkStats: MiningNetworkStats | null;
  nodeIdentity: { peer_id: string; public_key: string } | null;
  releaseCheck: ReleaseCheck | null;
  onOpenZone: (zone: string) => void;
  onRefreshMining: () => void;
  onRefreshNode: () => void;
  onCheckUpdates: () => void;
}) {
  const activeTool = props.tools.find((item) => item.zone === props.activeZone) ?? props.tools[0];
  const [input, setInput] = React.useState("");
  const [output, setOutput] = React.useState("Scegli un tool e premi Esegui.");
  const [busy, setBusy] = React.useState(false);
  const grouped = groupTools(props.tools);

  React.useEffect(() => {
    setInput("");
    setOutput(`${activeTool.title} pronto.`);
  }, [activeTool.zone]);

  async function execute() {
    setBusy(true);
    try {
      const result = await runToolAction(activeTool, input, {
        session: props.session,
        miningStatus: props.miningStatus,
        miningProgress: props.miningProgress,
        miningNetworkStats: props.miningNetworkStats,
        nodeIdentity: props.nodeIdentity,
        releaseCheck: props.releaseCheck,
        onOpenZone: props.onOpenZone,
        onRefreshMining: props.onRefreshMining,
        onRefreshNode: props.onRefreshNode,
        onCheckUpdates: props.onCheckUpdates
      });
      setOutput(result);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Operazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dev-workspace">
      <header className="workspace-heading">
        <span className="eyebrow">VELORA TOOLS</span>
        <h1>40 strumenti pronti</h1>
        <p>Utility Velora, strumenti quotidiani, sicurezza e creator studio indicizzati nell'Upper Web.</p>
      </header>
      <div className="tools-layout">
        <aside className="tools-groups">
          {Object.entries(grouped).map(([group, tools]) => (
            <article key={group} className="glass-card">
              <h2>{group}</h2>
              {tools.map((item) => (
                <button key={item.zone} type="button" className={activeTool.zone === item.zone ? "feature-row active" : "feature-row"} onClick={() => props.setActiveZone(item.zone)}>
                  <span>{item.title}</span>
                  <small>{item.zone}</small>
                </button>
              ))}
            </article>
          ))}
        </aside>
        <article className="page-card tool-runner">
          <div className="meta-row">
            <span>{activeTool.group}</span>
            <span>{activeTool.zone}</span>
            <span>{activeTool.category}</span>
            <span className="verified">Pronto</span>
          </div>
          <h1>{activeTool.title}</h1>
          <p>{activeTool.description}</p>
          <label>{activeTool.inputLabel}</label>
          <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={activeTool.placeholder} />
          <div className="button-row">
            <button type="button" onClick={execute} disabled={busy}>{busy ? "Esecuzione" : "Esegui"}</button>
            <button type="button" className="secondary" onClick={() => setInput("")}>Pulisci</button>
          </div>
          <pre>{output}</pre>
        </article>
      </div>
    </section>
  );
}

function FeatureBlock({ title, sites, onOpen }: { title: string; sites: SearchCard[]; onOpen: (zone: string) => void }) {
  return (
    <article className="glass-card">
      <h2>{title}</h2>
      {sites.map((site) => (
        <button key={site.zone} className="feature-row" type="button" onClick={() => onOpen(site.zone)}>
          <span>{site.title}</span>
          <small>{site.zone}</small>
        </button>
      ))}
    </article>
  );
}

function CategoryCloud() {
  return (
    <article className="glass-card">
      <h2>Categorie</h2>
      <div className="tag-cloud">
        {["Oceano", "Conoscenza", "Commercio", "Salute", "Creativita", "Istruzione", "Servizi", "Sistema"].map((item) => <span key={item}>{item}</span>)}
      </div>
    </article>
  );
}

function Milestones() {
  return (
    <article className="glass-card achievement">
      <span>Folletto</span>
      <h2>A BOMBAITA!</h2>
      <p>Gli achievement compariranno solo per milestone reali: primo accesso, prima zona approvata e primo sito pubblicato.</p>
    </article>
  );
}

function Forum(props: {
  sections: ForumSection[];
  messages: ForumMessage[];
  draft: string;
  setDraft: (value: string) => void;
  status: string;
  session: AccountSession | null;
  onSend: () => void;
  onRefresh: () => void;
}) {
  const global = props.sections.find((section) => section.slug === "global-chat");
  const trimmed = props.draft.trim();
  const blockedReason = !props.session ? "Accedi per partecipare" : !trimmed ? "Scrivi un messaggio" : props.draft.length > 200 ? "Limite 200 caratteri" : "";
  return (
    <section className="forum-workspace">
      <header className="workspace-heading">
        <span className="eyebrow">FORUM</span>
        <h1>Chat Globale</h1>
        <p>{global?.description ?? "La prima chat pubblica della Beta Velora"}</p>
      </header>
      <div className="dev-layout">
        <article className="page-card">
          <div className="button-row">
            <span className="safe-detail">Stato: {props.status}</span>
            <span className="safe-detail">Online: {global?.onlineCount ?? 0}</span>
            <button onClick={props.onRefresh}>Aggiorna</button>
          </div>
          <div className="chat-log" aria-live="polite">
            {props.messages.length ? props.messages.map((message) => (
              <article key={message.id} className="chat-message">
                <strong>{message.author}</strong>
                <time>{formatDateTime(message.createdAt)}</time>
                <p>{message.body}</p>
              </article>
            )) : <p>Nessun messaggio nella Chat Globale.</p>}
          </div>
          <label>Messaggio
            <textarea
              value={props.draft}
              maxLength={200}
              onChange={(event) => props.setDraft(event.target.value)}
              placeholder="Scrivi nella Chat Globale"
            />
          </label>
          <div className="button-row">
            <span className={props.draft.length > 200 ? "safe-detail danger" : "safe-detail"}>{props.draft.length} / 200</span>
            <button onClick={props.onSend} disabled={Boolean(blockedReason)}>Invia</button>
          </div>
          {blockedReason ? <p className="safe-detail">{blockedReason}</p> : null}
        </article>
      </div>
    </section>
  );
}

function MiningPartner(props: {
  status: MiningLocalStatus | null;
  message: string;
  form: MiningForm;
  setForm: (form: MiningForm) => void;
  stats: MiningUiStats;
  progress: MiningProgress | null;
  networkStats: MiningNetworkStats | null;
  history: any | null;
  onRefresh: () => void;
  onStart: () => void;
  onStop: () => void;
  onPayoutRequest: () => void;
}) {
  const runtime = formatDuration(props.stats.elapsedSeconds);
  const currentProgress = props.progress?.workers.find((worker) => worker.coin === props.form.coin) ?? props.progress?.workers[0];
  const progressPercent = currentProgress ? Math.max(0, Math.min(100, Number(currentProgress.payout_progress_percent ?? 0))) : 0;
  const maxThreads = Math.max(1, Number(props.status?.maxThreads ?? navigator.hardwareConcurrency ?? 2));
  const selectedThreads = Math.max(1, Math.min(maxThreads, Number(props.form.threads) || 2));
  const selectedPriority = Math.max(0, Math.min(5, Number(props.form.cpuPriority) || 1));
  function applyPowerProfile(profile: MiningPowerProfile) {
    const targetThreads = profile === "eco"
      ? Math.max(1, Math.floor(maxThreads * 0.25))
      : profile === "balanced"
        ? Math.max(1, Math.ceil(maxThreads * 0.5))
        : profile === "boost"
          ? Math.max(1, Math.ceil(maxThreads * 0.75))
          : maxThreads;
    props.setForm({
      ...props.form,
      powerProfile: profile,
      threads: String(targetThreads),
      cpuPriority: profile === "eco" ? "1" : profile === "balanced" ? "2" : profile === "boost" ? "3" : "4"
    });
  }
  return (
    <section className="dev-workspace">
      <header className="workspace-heading">
        <span>Velora Mining Network</span>
        <h1>Mining Partner</h1>
        <p>Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.</p>
      </header>
      <div className="workspace-grid">
        <article className="panel">
          <h2>Attiva e mina</h2>
          <p>Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.</p>
          <a className="ghost-link" href="https://xmrig.com/download">Scarica XMRig ufficiale</a>
          <label>Coin</label>
          <select value={props.form.coin} onChange={(event) => props.setForm({ ...props.form, coin: event.target.value })}>
            <option value="XMR">Monero XMR</option>
            <option value="ZEPH">Zephyr ZEPH</option>
          </select>
          <label>Wallet pubblico payout</label>
          <input value={props.form.payoutWallet} onChange={(event) => props.setForm({ ...props.form, payoutWallet: event.target.value })} placeholder="Incolla indirizzo pubblico" />
          <label>Potenza di calcolo</label>
          <div className="power-profile-grid">
            <button type="button" className={props.form.powerProfile === "eco" ? "selected" : ""} onClick={() => applyPowerProfile("eco")}>Eco</button>
            <button type="button" className={props.form.powerProfile === "balanced" ? "selected" : ""} onClick={() => applyPowerProfile("balanced")}>Bilanciato</button>
            <button type="button" className={props.form.powerProfile === "boost" ? "selected" : ""} onClick={() => applyPowerProfile("boost")}>Spinto</button>
            <button type="button" className={props.form.powerProfile === "max" ? "selected" : ""} onClick={() => applyPowerProfile("max")}>Massimo</button>
          </div>
          <label>Thread CPU: {selectedThreads} di {maxThreads}</label>
          <input
            type="range"
            min={1}
            max={maxThreads}
            value={selectedThreads}
            onChange={(event) => props.setForm({ ...props.form, threads: event.target.value, powerProfile: "balanced" })}
          />
          <label>Priorita CPU: {selectedPriority}</label>
          <input
            type="range"
            min={0}
            max={5}
            value={selectedPriority}
            onChange={(event) => props.setForm({ ...props.form, cpuPriority: event.target.value })}
          />
          <p className="safe-detail">Eco consuma meno. Massimo usa tutta la CPU disponibile e puo rendere il PC lento o caldo.</p>
          <div className="action-row">
            <button onClick={props.onRefresh}>Controlla</button>
            <button onClick={props.onStart}>Avvia mining</button>
            <button onClick={props.onStop}>Stop</button>
          </div>
          <p>{props.message}</p>
        </article>
        <article className="panel">
          <h2>Stato mining</h2>
          <div className={props.status?.running ? "mining-live on" : "mining-live"}>
            <strong>{props.status?.running ? "Mining in corso" : "Mining fermo"}</strong>
            <span>{props.status?.running ? `Attivo da ${runtime}` : "Premi Avvia mining per iniziare"}</span>
          </div>
          <p>Miner pronto: {props.status?.ready ? "si" : "no"}</p>
          <p>Processo locale: {props.status?.running ? "attivo" : "non attivo"}</p>
          <p>Coin selezionata: {props.form.coin}</p>
          <p>Potenza: {props.form.powerProfile} - {selectedThreads}/{maxThreads} thread - priorita {selectedPriority}</p>
          <p>Wallet salvato: {props.form.payoutWallet ? maskLocalWallet(props.form.payoutWallet) : "non inserito"}</p>
          <h3>Potenza collettiva Velora</h3>
          <div className="mining-live on">
            <strong>{formatHashrate(props.networkStats?.pool?.hash ?? props.networkStats?.network?.total_hashrate_hs ?? 0)}</strong>
            <span>Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo</span>
          </div>
          <p>Share collettive pool: {props.networkStats?.pool?.validShares ?? props.networkStats?.network?.accepted_shares ?? 0} ok, {props.networkStats?.pool?.invalidShares ?? props.networkStats?.network?.rejected_shares ?? 0} ko</p>
          <p>Hash totali pool: {formatNumber(props.networkStats?.pool?.totalHashes ?? 0)}</p>
          <p>Worker registrati: {props.networkStats?.network?.active_workers ?? 0} - dispositivi registrati: {props.networkStats?.network?.active_devices ?? 0}</p>
          <p className="safe-detail">{props.networkStats?.pool?.reachable === false ? props.networkStats.pool.error : props.networkStats?.warning ?? "Premi Controlla per aggiornare la potenza collettiva."}</p>
          <h3>Progresso payout</h3>
          <p>Soglia: {currentProgress?.payout_threshold_label ?? props.progress?.threshold.xmrLabel ?? "0.05 XMR"}</p>
          <p>Da pagare: {currentProgress?.pending_label ?? "0 XMR"}</p>
          <p>Pagato: {currentProgress?.paid_label ?? "0 XMR"}</p>
          <div className="mining-live">
            <strong>{progressPercent.toFixed(2)}% della soglia</strong>
            <span>{currentProgress?.payout_ready ? "Soglia raggiunta: puoi richiedere payout" : "Soglia non ancora raggiunta"}</span>
            <progress value={progressPercent} max={100} />
          </div>
          <p>Share verificate: {currentProgress?.accepted_pool_shares ?? 0} ok, {currentProgress?.rejected_pool_shares ?? 0} ko, {currentProgress?.stale_pool_shares ?? 0} stale</p>
          <p className="safe-detail">{currentProgress?.accounting_note ?? props.progress?.note ?? "Accedi e premi Controlla per vedere il progresso."}</p>
          <p>Cartella miner:</p>
          <code>{props.status?.minerPath ?? "Premi Controlla per vedere il percorso"}</code>
          <p>Log miner:</p>
          <code>{props.status?.logPath ?? "Premi Controlla per vedere il percorso log"}</code>
          <p className="safe-detail">Se Windows Security o macOS chiudono il miner, installa solo XMRig ufficiale, autorizza manualmente quel file e riavvia da Velora. Velora non disattiva antivirus e non aggira protezioni di sistema.</p>
          <p>Divisione: 50% utente, 50% Velora. Il payout viene richiesto e autorizzato manualmente dal pannello admin.</p>
          <button type="button" onClick={props.onPayoutRequest} disabled={!props.form.payoutWallet}>Richiedi payout manuale</button>
          <p className="safe-detail">La richiesta payout usa il wallet salvato e viene verificata prima dell'invio.</p>
          <h3>Storico mining</h3>
          <p>Richieste payout: {props.history?.payoutRequests?.length ?? 0}</p>
          <p>Metriche recenti: {props.history?.metrics?.length ?? 0}</p>
          <p>Movimenti ledger: {props.history?.ledger?.length ?? 0}</p>
          {props.history?.payoutRequests?.slice(0, 5).map((item: any) => (
            <p key={item.id} className="safe-detail">{item.coin} - {item.status} - {formatDateTime(item.requested_at)}</p>
          ))}
        </article>
      </div>
    </section>
  );
}

function UserNodes(props: {
  identity: { peer_id: string; public_key: string } | null;
  message: string;
  onRefresh: () => void;
  onActivate: () => void;
}) {
  return (
    <section className="dev-workspace">
      <header className="workspace-heading">
        <span>Rete Velora</span>
        <h1>Nodi utente</h1>
        <p>Collega questo dispositivo alla rete Velora come nodo beta del tuo account.</p>
      </header>
      <div className="workspace-grid">
        <article className="panel">
          <h2>Dispositivo</h2>
          <p>{props.message}</p>
          <p>Peer ID:</p>
          <code>{props.identity?.peer_id ?? "Non ancora creato"}</code>
          <div className="action-row">
            <button type="button" onClick={props.onRefresh}>Controlla</button>
            <button type="button" onClick={props.onActivate}>Attiva nodo utente</button>
          </div>
        </article>
        <article className="panel">
          <h2>Cosa fa</h2>
          <p>Registra il dispositivo sul tuo account.</p>
          <p>Permette heartbeat, contributi beta e futura replica autorizzata.</p>
          <p>Non usa file personali e non apre accessi esterni al computer.</p>
        </article>
      </div>
    </section>
  );
}

function SimpleCollection({ title, items, onOpen }: { title: string; items: string[]; onOpen: (zone: string) => void }) {
  return (
    <section className="page-card">
      <h1>{title}</h1>
      {items.length ? items.map((item) => <button className="feature-row" key={item} onClick={() => onOpen(item)}>{item}</button>) : <p>Nessun elemento salvato.</p>}
    </section>
  );
}

function Activity() {
  return <section className="page-card"><h1>Attivita</h1><p>Le visite e le pubblicazioni recenti appariranno qui quando disponibili.</p></section>;
}

function Identity({ session, onVerify, onRecoverySeen }: { session: AccountSession | null; onVerify: () => void; onRecoverySeen: () => void }) {
  return (
    <section className="page-card">
      <h1>Identita Velora</h1>
      <p>{session ? `Account: ${session.user.username} - Livello ${session.user.identityLevel}` : "Accedi per verificare il dispositivo."}</p>
      <button type="button" onClick={onVerify} disabled={!session || session.user.identityLevel >= 1}>Verifica dispositivo</button>
      {session?.recovery?.required ? (
        <div className="review-box warn">
          <strong>Key token personale</strong>
          <p>{session.recovery.message ?? "Salva il token di recupero account."}</p>
          {session.recovery.token ? <code>{session.recovery.token}</code> : <p>Token gia generato. Se lo hai salvato, conferma la presa visione.</p>}
          <button type="button" onClick={onRecoverySeen}>Ho salvato il key token</button>
        </div>
      ) : null}
      <div className="plan-grid">
        {identityLevels.map(([level, title, text]) => <article key={level}><b>{level}</b><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>
  );
}

function Notifications() {
  return <section className="page-card"><h1>Notifiche</h1><p>Nessuna notifica. Velora ti avvisera quando una zona, release o replica richiede attenzione.</p></section>;
}

function Settings({ nodeMessage, releaseCheck, releaseMessage, onRetry, onCheckUpdates }: { nodeMessage: string; releaseCheck: ReleaseCheck | null; releaseMessage: string; onRetry: () => void; onCheckUpdates: () => void }) {
  return (
    <section className="page-card">
      <h1>Impostazioni</h1>
      <p>{nodeMessage}</p>
      <button type="button" onClick={onRetry}>Riprova preparazione</button>
      <div className="review-box ok">
        <strong>Aggiornatore desktop</strong>
        <p>{releaseMessage}</p>
        <p>Manifest: {releaseCheck?.latestVersion ?? "non ancora letto"}</p>
        <button type="button" onClick={onCheckUpdates}>Controlla aggiornamenti</button>
        {releaseCheck?.changelog?.length ? releaseCheck.changelog.map((item) => <p key={item} className="safe-detail">{item}</p>) : null}
      </div>
    </section>
  );
}

function VeloraDev(props: {
  sitePath: string;
  setSitePath: (path: string) => void;
  address: string;
  setAddress: (address: string) => void;
  validation: VeloraValidationResult | null;
  packaged: PublisherPackageResponse | null;
  releases: PublisherReleaseRecord[];
  publishStage: PublishStage;
  publishMessage: string;
  session: AccountSession | null;
  onChooseFolder: () => void;
  onOpenFolder: () => void;
  onValidate: () => void;
  onPackage: () => void;
  onRegister: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="dev-workspace">
      <header className="workspace-heading">
        <span className="eyebrow">VELORA</span>
        <h1>Pubblica un sito</h1>
        <p>Prepara una zona, verifica i contenuti e rendila disponibile su Velora.</p>
      </header>
      <div className="dev-layout">
        <article className="page-card">
          <h2>Studio di pubblicazione</h2>
          <ol className="flow-list">
            {["Scegli la zona", "Seleziona la cartella del sito", "Controlla i contenuti", "Conferma identita", "Pubblica"].map((step) => <li key={step}>{step}</li>)}
          </ol>
          <label>Zona<input value={props.address} onChange={(event) => props.setAddress(event.target.value)} /></label>
          <label>Cartella progetto<input value={props.sitePath} readOnly placeholder="Seleziona la cartella del sito" /></label>
          <div className="button-row">
            <button onClick={props.onChooseFolder}>{props.sitePath ? "Cambia cartella" : "Seleziona cartella"}</button>
            <button onClick={props.onOpenFolder} disabled={!props.sitePath}>Apri cartella</button>
            <button onClick={props.onValidate}>Controlla</button>
            <button onClick={props.onPackage} disabled={!props.session}>Prepara</button>
            <button onClick={props.onRegister} disabled={!props.packaged || !props.session}>Pubblica</button>
            <button onClick={props.onRefresh}>Release</button>
          </div>
          <p className="safe-detail">Stato pubblicazione: {renderPublishStage(props.publishStage)}</p>
          <p className="safe-detail">{props.publishMessage}</p>
          {props.validation ? <ReviewBox validation={props.validation} /> : null}
          {props.packaged ? <p className="safe-detail">Pacchetto pronto con CID e manifest locale</p> : null}
          {!props.session ? <p>Accedi per inviare una pubblicazione.</p> : null}
        </article>
        <article className="page-card">
          <h2>Piani publisher</h2>
          <div className="plan-grid">
            {publisherPlans.map(([name, price, text]) => <article key={name}><b>{name}</b><h3>{price}</h3><p>{text}</p></article>)}
          </div>
        </article>
        <article className="page-card">
          <h2>Review workflow</h2>
          <div className="tag-cloud">
            {["DRAFT", "SUBMITTED", "AUTOMATED_REVIEW", "MANUAL_REVIEW", "CHANGES_REQUIRED", "APPROVED", "REJECTED", "PUBLISHED", "SUSPENDED"].map((item) => <span key={item}>{item}</span>)}
          </div>
          {props.releases.map((release) => <p key={release.id}>{release.version} - {release.status}</p>)}
        </article>
      </div>
    </section>
  );
}

function ReviewBox({ validation }: { validation: VeloraValidationResult }) {
  return (
    <div className={validation.valid ? "review-box ok" : "review-box warn"}>
      <strong>{validation.valid ? "Pronto per l'invio" : "Problemi rilevati"}</strong>
      <p>File analizzati: {validation.totalFiles}</p>
      <p>{validation.errors.length ? validation.errors.join(" | ") : "Nessun errore bloccante."}</p>
      <p>{validation.warnings.length ? validation.warnings.join(" | ") : "Nessun avviso."}</p>
    </div>
  );
}

function renderPublishStage(stage: PublishStage) {
  switch (stage) {
    case "selecting":
      return "Selezione cartella";
    case "validating":
      return "Controllo contenuti";
    case "packaging":
      return "Preparazione release";
    case "publishing":
      return "Invio a Velora";
    case "success":
      return "Completato";
    case "error":
      return "Errore";
    default:
      return "In attesa";
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function ControlCenter() {
  return (
    <section className="page-card restricted">
      <h1>{desktopBranding.controlCenterName}</h1>
      <p>Ambiente amministrativo riservato. In questa beta desktop non e mostrato agli utenti normali.</p>
      <div className="tag-cloud">
        {["Panoramica", "Richieste zone", "Revisioni", "Publisher", "Sicurezza", "Audit", "Revoche"].map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  );
}

function networkLabel(state: NetworkState) {
  return {
    ready: "Connesso a Velora",
    syncing: "Riconnessione in corso",
    limited: "Connessione limitata",
    offline: "Offline"
  }[state];
}

function tool(title: string, zone: string, group: ToolGroup, description: string, action: ToolAction, inputLabel: string, placeholder: string): ToolDefinition {
  return {
    title,
    zone,
    description,
    group,
    action,
    inputLabel,
    placeholder,
    category: group,
    publisher: "Velora Tools",
    identityLevel: "Tool",
    verified: true,
    familySafe: true,
    availability: "Pronto",
    updatedAt: "Build corrente"
  };
}

function groupTools(tools: ToolDefinition[]) {
  return tools.reduce<Record<string, ToolDefinition[]>>((groups, item) => {
    groups[item.group] = [...(groups[item.group] ?? []), item];
    return groups;
  }, {});
}

async function runToolAction(toolItem: ToolDefinition, input: string, context: {
  session: AccountSession | null;
  miningStatus: MiningLocalStatus | null;
  miningProgress: MiningProgress | null;
  miningNetworkStats: MiningNetworkStats | null;
  nodeIdentity: { peer_id: string; public_key: string } | null;
  releaseCheck: ReleaseCheck | null;
  onOpenZone: (zone: string) => void;
  onRefreshMining: () => void;
  onRefreshNode: () => void;
  onCheckUpdates: () => void;
}) {
  const text = input.trim();
  switch (toolItem.action) {
    case "wallet-check":
      return walletCheck(text);
    case "mining-summary":
      context.onRefreshMining();
      return [
        `Stato locale: ${context.miningStatus?.running ? "mining in corso" : "fermo"}`,
        `Miner pronto: ${context.miningStatus?.ready ? "si" : "no"}`,
        `Hashrate pool: ${formatHashrate(context.miningNetworkStats?.pool?.hash ?? context.miningNetworkStats?.network?.total_hashrate_hs ?? 0)}`,
        `Share accettate: ${context.miningNetworkStats?.pool?.validShares ?? context.miningNetworkStats?.network?.accepted_shares ?? 0}`,
        `Worker attivi: ${context.miningNetworkStats?.network?.active_workers ?? 0}`,
        `Soglia: ${context.miningProgress?.threshold?.xmrLabel ?? "0.05 XMR"}`
      ].join("\n");
    case "publisher-validator":
      return publisherQuickCheck(text);
    case "zone-open":
      if (!looksLikeToolZoneInput(text)) {
        return "Inserisci una zona valida, esempio happy.meter";
      }
      context.onOpenZone(text.toLowerCase());
      return `Apertura zona: ${text.toLowerCase()}`;
    case "login-test":
      return loginSdkCheck(text);
    case "mail-test":
      return context.session ? `Messaggio test pronto per ${text || context.session.mail.address}\nOggetto: Test VeloMail\nCorpo: Se ricevi questo messaggio, VeloMail e operativo.` : "Accedi prima di usare Mail Tester.";
    case "node-health":
      context.onRefreshNode();
      return `Nodo locale: ${context.nodeIdentity?.peer_id ?? "non ancora creato"}\nChiave pubblica: ${context.nodeIdentity?.public_key ? "presente" : "assente"}\nStato: ${context.nodeIdentity ? "pronto" : "da attivare"}`;
    case "hash":
      return `SHA-256:\n${await sha256Text(text)}`;
    case "recovery":
      return context.session?.recovery?.required ? "Key token ancora da confermare nella sezione Identita." : "Key token non visibile. Se lo hai confermato, resta nascosto per sicurezza.";
    case "report":
      return `Segnalazione pronta\nTipo: sito/mail/chat/utente\nDettagli: ${text || "nessun dettaglio inserito"}\nInviala dal pannello segnalazioni quando disponibile.`;
    case "tts":
      return speakText(text || "Velora Tools pronto");
    case "translate":
      return translateText(text);
    case "summary":
      return summarizeText(text);
    case "rewrite":
      return rewriteText(text);
    case "spell":
      return cleanText(text);
    case "dictation-note":
      return makeNote(text);
    case "focus-timer":
      return focusPlan(text);
    case "checklist":
      return makeChecklist(text);
    case "percent":
      return percentCalc(text);
    case "unit":
      return unitConvert(text);
    case "link-check":
      return linkCheck(text);
    case "difesa-check":
      return difesaTotaleCheck(text);
    case "password":
      return passwordStrength(text);
    case "privacy-clean":
      return privacyClean(text);
    case "qr-safe":
      return `Contenuto QR\n${linkCheck(text)}\nAprilo solo se riconosci destinazione e scopo.`;
    case "phishing":
      return phishingCheck(text);
    case "permission":
      return permissionExplain(text);
    case "file-signature":
      return fileSignature(text);
    case "breach-note":
      return breachPlan(text);
    case "safe-message":
      return privacyClean(rewriteText(text));
    case "manifest":
      return manifestGenerator(text);
    case "landing":
      return landingBuilder(text);
    case "seo":
      return seoVelora(text);
    case "accessibility":
      return accessibilityCheck(text);
    case "changelog":
      return makeChangelog(text);
    case "logo":
      return logoConcept(text);
    case "cover":
      return coverBrief(text);
    case "content-pack":
      return contentPack(text);
    case "prompt-site":
      return promptSite(text);
    case "publish-plan":
      return publishPlan(text);
    default:
      return `${toolItem.title} pronto.`;
  }
}

function looksLikeToolZoneInput(value: string) {
  return /^[a-z0-9][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,30}$/i.test(value.trim());
}

function walletCheck(value: string) {
  const trimmed = value.trim();
  const xmr = /^[48][1-9A-HJ-NP-Za-km-z]{94,105}$/.test(trimmed);
  const zeph = /^ZEPH[A-Za-z0-9]{60,120}$/.test(trimmed) || /^[1-9A-HJ-NP-Za-km-z]{90,120}$/.test(trimmed);
  return xmr ? "Wallet XMR valido come indirizzo pubblico." : zeph ? "Wallet ZEPH valido come indirizzo pubblico." : "Wallet non valido. Incolla solo indirizzo pubblico, mai seed o chiavi private.";
}

function publisherQuickCheck(value: string) {
  const hasManifest = /velora-site\.json|\"address\"|\"title\"/i.test(value);
  const address = /[a-z0-9][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,30}/i.exec(value)?.[0];
  return [`Manifest: ${hasManifest ? "presente" : "manca velora-site.json o campi address/title"}`, `Zona: ${address ?? "non trovata"}`, `Esito: ${hasManifest && address ? "pronto per controllo Publisher" : "correggi prima di pubblicare"}`].join("\n");
}

function loginSdkCheck(value: string) {
  const hasBridge = /VELORA_AUTH_REQUEST|velora|login velora|@velora\/sdk/i.test(value);
  return hasBridge ? "Login Velora rilevato. Il sito sembra predisposto per identita unificata." : "Login Velora non rilevato. Aggiungi SDK o bridge VELORA_AUTH_REQUEST.";
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function speakText(value: string) {
  if (!("speechSynthesis" in window)) {
    return "TTS non disponibile su questo dispositivo.";
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value.slice(0, 5000));
  utterance.lang = "it-IT";
  window.speechSynthesis.speak(utterance);
  return `Lettura avviata: ${Math.min(value.length, 5000)} caratteri.`;
}

async function translateText(value: string) {
  const match = /^(it|en|es|fr|de)>(it|en|es|fr|de)\s+([\s\S]+)/i.exec(value);
  const from = match?.[1] ?? "it";
  const to = match?.[2] ?? "en";
  const text = match?.[3] ?? value;
  if (!text.trim()) {
    return "Inserisci testo, esempio: it>en Ciao mondo";
  }
  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=${from}|${to}`);
    const data = await response.json() as { responseData?: { translatedText?: string } };
    return data.responseData?.translatedText || simpleTranslateFallback(text);
  } catch {
    return simpleTranslateFallback(text);
  }
}

function simpleTranslateFallback(value: string) {
  const dict: Record<string, string> = { ciao: "hello", mondo: "world", grazie: "thank you", sicurezza: "security", sito: "site", pubblica: "publish" };
  return value.split(/\b/).map((part) => dict[part.toLowerCase()] ?? part).join("");
}

function summarizeText(value: string) {
  const sentences = value.split(/[.!?\n]+/).map((item) => item.trim()).filter(Boolean);
  return sentences.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join("\n") || "Inserisci un testo da riassumere.";
}

function rewriteText(value: string) {
  const cleaned = cleanText(value);
  return cleaned ? `Versione chiara:\n${cleaned.replace(/\bforse\b/gi, "probabilmente").replace(/\bdevo\b/gi, "serve").replace(/\s+/g, " ")}` : "Inserisci testo da riscrivere.";
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/(^|[.!?]\s+)([a-zà-ÿ])/g, (m) => m.toUpperCase()).trim();
}

function makeNote(value: string) {
  return `Titolo: Nota Velora\nPunti:\n${makeChecklist(value)}\nProssima azione: scegli il primo punto e completalo.`;
}

function focusPlan(value: string) {
  const minutes = Math.max(5, Math.min(120, Number(/\d+/.exec(value)?.[0] ?? 25)));
  return `Focus ${minutes} minuti\n1. Chiudi distrazioni\n2. Lavora su un solo obiettivo\n3. Pausa ${Math.max(5, Math.round(minutes / 5))} minuti\n4. Scrivi cosa hai completato`;
}

function makeChecklist(value: string) {
  const items = value.split(/[\n,;.]+/).map((item) => item.trim()).filter(Boolean);
  return (items.length ? items : ["Definisci obiettivo", "Controlla materiale", "Esegui", "Verifica risultato"]).map((item) => `- [ ] ${item}`).join("\n");
}

function percentCalc(value: string) {
  const numbers = value.match(/-?\d+(?:[.,]\d+)?/g)?.map((n) => Number(n.replace(",", "."))) ?? [];
  if (numbers.length < 2) return "Esempi: 20% di 150 oppure 150 + 20%";
  const [a, b] = numbers;
  return `${a}% di ${b} = ${(b * a / 100).toFixed(2)}\n${b} + ${a}% = ${(b * (1 + a / 100)).toFixed(2)}\n${b} - ${a}% = ${(b * (1 - a / 100)).toFixed(2)}`;
}

function unitConvert(value: string) {
  const n = Number((value.match(/-?\d+(?:[.,]\d+)?/)?.[0] ?? "0").replace(",", "."));
  const lower = value.toLowerCase();
  if (lower.includes("km")) return `${n} km = ${(n * 0.621371).toFixed(3)} mi`;
  if (lower.includes("mi")) return `${n} mi = ${(n / 0.621371).toFixed(3)} km`;
  if (lower.includes("kg")) return `${n} kg = ${(n * 2.20462).toFixed(3)} lb`;
  if (lower.includes("lb")) return `${n} lb = ${(n / 2.20462).toFixed(3)} kg`;
  if (lower.includes("f")) return `${n} F = ${((n - 32) * 5 / 9).toFixed(2)} C`;
  return `${n} C = ${(n * 9 / 5 + 32).toFixed(2)} F`;
}

function linkCheck(value: string) {
  const suspicious = [/bit\.ly|tinyurl|t\.co/i, /login|verify|urgent|wallet|seed|bonus/i, /xn--/i, /@/];
  const score = suspicious.reduce((total, pattern) => total + (pattern.test(value) ? 1 : 0), 0);
  return `Rischio: ${score >= 3 ? "alto" : score >= 1 ? "medio" : "basso"}\nHTTPS: ${/^https:\/\//i.test(value) ? "si" : "no"}\nApri solo se riconosci dominio e mittente.`;
}

function difesaTotaleCheck(value: string) {
  const indicators = ["seed", "private key", "password", "bonifico", "urgente", ".exe", ".scr", "macro", "abilita contenuto"].filter((word) => value.toLowerCase().includes(word));
  return `Difesa Totale Check\nIndicatori trovati: ${indicators.length ? indicators.join(", ") : "nessuno evidente"}\nEsito: ${indicators.length >= 2 ? "attenzione alta" : indicators.length ? "controlla prima di procedere" : "nessun segnale evidente"}\nNota: non inviare mai seed, chiavi private o password.`;
}

function passwordStrength(value: string) {
  const score = [value.length >= 12, /[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  return `Forza: ${score}/5\nConsiglio: usa almeno 12 caratteri, mai parole personali, meglio frase lunga con simboli.`;
}

function privacyClean(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefono]")
    .replace(/[48][1-9A-HJ-NP-Za-km-z]{30,}/g, "[wallet]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[ip]");
}

function phishingCheck(value: string) {
  const flags = ["urgente", "password", "verifica account", "clicca", "wallet", "seed", "premio", "scade"].filter((word) => value.toLowerCase().includes(word));
  return `Segnali phishing: ${flags.length ? flags.join(", ") : "nessuno evidente"}\nRischio: ${flags.length >= 3 ? "alto" : flags.length ? "medio" : "basso"}`;
}

function permissionExplain(value: string) {
  return value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean).map((item) => `${item}: consenti solo se serve davvero alla funzione che vuoi usare`).join("\n") || "Inserisci permessi da spiegare.";
}

function fileSignature(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("%pdf") || lower.endsWith(".pdf")) return "PDF: apri solo da fonte nota, attenzione a link interni.";
  if (/\.(exe|scr|bat|cmd|ps1|msi)$/.test(lower)) return "Eseguibile/script: controlla firma, hash e provenienza prima di avviare.";
  if (/\.(jpg|jpeg|png|webp)$/.test(lower)) return "Immagine: prima di pubblicare rimuovi metadati se contiene dati privati.";
  return "Tipo non riconosciuto. Controlla estensione, origine e hash.";
}

function breachPlan(value: string) {
  return `Piano sicurezza per ${value || "account"}\n1. Cambia password\n2. Chiudi sessioni aperte\n3. Attiva 2FA\n4. Controlla email/telefono di recupero\n5. Verifica movimenti e messaggi inviati\n6. Segnala se necessario`;
}

function manifestGenerator(value: string) {
  const zone = /zona:\s*([a-z0-9.-]+)/i.exec(value)?.[1] ?? "mia.zona";
  const title = /titolo:\s*([^;\n]+)/i.exec(value)?.[1] ?? zone;
  return JSON.stringify({ address: zone, title, description: "Sito pubblicato su Velora", entry: "index.html", category: "Community", tags: ["velora"], auth: { veloraLogin: true } }, null, 2);
}

function landingBuilder(value: string) {
  const title = cleanText(value.split(/[,;\n]/)[0] || "Nuova zona Velora");
  return `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(title)}</title><style>body{font-family:Arial,sans-serif;background:#071525;color:white;margin:0;padding:40px}main{max-width:860px;margin:auto}.card{background:#10253b;border:1px solid #d8ae55;border-radius:24px;padding:28px}</style></head><body><main><div class="card"><h1>${escapeText(title)}</h1><p>Pagina pronta per Velora con login unificato.</p><button>Accedi con Velora</button></div></main></body></html>`;
}

function seoVelora(value: string) {
  const words = value.toLowerCase().match(/[a-zà-ÿ0-9]{4,}/g)?.slice(0, 8) ?? ["velora", "upperweb"];
  return `Titolo: ${cleanText(value).slice(0, 58) || "Sito Velora"}\nDescrizione: ${cleanText(value).slice(0, 150)}\nTag: ${Array.from(new Set(words)).join(", ")}`;
}

function accessibilityCheck(value: string) {
  const hasAlt = /alt=/i.test(value);
  const hasH1 = /<h1|^#\s/m.test(value);
  const longText = value.length > 120;
  return `Titolo principale: ${hasH1 ? "presente" : "da aggiungere"}\nTesti alternativi immagini: ${hasAlt ? "presenti" : "da controllare"}\nContenuto leggibile: ${longText ? "si" : "aggiungi descrizione piu chiara"}`;
}

function makeChangelog(value: string) {
  return makeChecklist(value).replace(/\[ \]/g, "Aggiunto");
}

function logoConcept(value: string) {
  const name = value || "Velora Project";
  return `Logo ${name}\nForma: monogramma iniziale + cerchio luminoso\nPalette: oro Velora, blu notte, ciano\nStile: pulito, leggibile anche piccolo`;
}

function coverBrief(value: string) {
  return `Copertina\nTema: ${value || "Upper Web"}\nComposizione: titolo grande, sfondo sfumato, simbolo centrale, 3 parole chiave\nFormato: 16:9 e quadrato`;
}

function contentPack(value: string) {
  const heavy = value.split(/\n|,/).filter((item) => /\.(png|jpg|jpeg|mp4|mov|zip)$/i.test(item));
  return `File pesanti rilevati: ${heavy.length}\nAzioni: comprimi immagini, rimuovi video non essenziali, usa index.html leggero, mantieni velora-site.json valido.`;
}

function promptSite(value: string) {
  return `Adatta il sito "${value || "cartella sito"}" per Velora senza modificare l'originale. Crea una copia pubblicabile con index.html, assets leggeri, velora-site.json valido, login Velora tramite bridge VELORA_AUTH_REQUEST, nessun account parallelo obbligatorio, testi chiari e controlla con Publisher Validator.`;
}

function publishPlan(value: string) {
  const zone = value || "mia.zona";
  return `Piano pubblicazione ${zone}\n1. Crea copia sito\n2. Aggiungi velora-site.json\n3. Collega Login Velora\n4. Alleggerisci assets\n5. Controlla con Publisher Validator\n6. Pubblica da Velora\n7. Apri zona dal motore di ricerca`;
}

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function mergeSearchResults(primary: SearchCard[], secondary: SearchCard[]) {
  const seen = new Set<string>();
  const merged: SearchCard[] = [];
  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.zone)) {
      continue;
    }
    seen.add(item.zone);
    merged.push(item);
  }
  return merged;
}

function authHeaders(session: AccountSession) {
  return { authorization: `Bearer ${session.token}` };
}

async function sealVeloMailDraft(subject: string, body: string) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const seal = async (value: string) => {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(value));
    return `v1.${base64Url(nonce)}.${base64Url(new Uint8Array(ciphertext))}`;
  };
  return {
    subjectCiphertext: await seal(subject),
    bodyCiphertext: await seal(body)
  };
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function loadStoredSession(): AccountSession | null {
  try {
    const raw = localStorage.getItem("velora.session");
    return raw ? JSON.parse(raw) as AccountSession : null;
  } catch {
    return null;
  }
}

function saveStoredSession(session: AccountSession) {
  localStorage.setItem("velora.session", JSON.stringify(session));
}

function loadStoredMiningForm(): MiningForm {
  try {
    const raw = localStorage.getItem("velora.mining.form");
    const parsed = raw ? JSON.parse(raw) as Partial<MiningForm> : {};
    return {
      coin: parsed.coin === "ZEPH" ? "ZEPH" : "XMR",
      payoutWallet: String(parsed.payoutWallet ?? ""),
      threads: String(parsed.threads ?? "2"),
      cpuPriority: String(parsed.cpuPriority ?? "1"),
      powerProfile: normalizeMiningPowerProfile(parsed.powerProfile)
    };
  } catch {
    return { coin: "XMR", payoutWallet: "", threads: "2", cpuPriority: "1", powerProfile: "balanced" };
  }
}

function saveStoredMiningForm(form: MiningForm) {
  localStorage.setItem("velora.mining.form", JSON.stringify(form));
}

function normalizeMiningPowerProfile(profile: unknown): MiningPowerProfile {
  return profile === "eco" || profile === "boost" || profile === "max" ? profile : "balanced";
}

function maskLocalWallet(wallet: string) {
  const normalized = wallet.trim();
  if (normalized.length <= 14) {
    return normalized;
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function formatHashrate(value: number) {
  const rate = Number(value || 0);
  if (rate >= 1_000_000) {
    return `${(rate / 1_000_000).toFixed(2)} MH/s`;
  }
  if (rate >= 1_000) {
    return `${(rate / 1_000).toFixed(2)} KH/s`;
  }
  return `${rate.toFixed(2)} H/s`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function normalizeAccountSlug(value: string) {
  return value.trim().toLowerCase().normalize("NFKC").replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "publisher";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
