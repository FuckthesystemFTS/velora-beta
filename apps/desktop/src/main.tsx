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

type Workspace = "home" | "explore" | "mail" | "forum" | "mining" | "nodes" | "favorites" | "activity" | "identity" | "notifications" | "dev" | "settings" | "control";
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
  message: string;
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
  const [nodeIdentity, setNodeIdentity] = React.useState<{ peer_id: string; public_key: string } | null>(null);
  const [nodeEnrollMessage, setNodeEnrollMessage] = React.useState("Nodo utente non ancora attivato");
  const siteApi = createVeloraSiteApi(apiBaseUrl);

  function setMiningForm(form: { coin: string; payoutWallet: string; threads: string }) {
    setMiningFormState(form);
    saveStoredMiningForm(form);
  }

  React.useEffect(() => {
    void prepareVelora();
    void refreshMiningStatus();
    void loadNodeIdentity();
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
    const localResults = normalized ? [] : defaultFeaturedSites.filter((site) => {
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
      return;
    }
    try {
      const freshSession = activeSession ?? await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/mining/progress`, { headers: authHeaders(freshSession) });
      if (!response.ok) {
        return;
      }
      setMiningProgress(await response.json() as MiningProgress);
    } catch {
      setMiningProgress(null);
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
          threads: Number(miningForm.threads) || 2
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
          <Home query={query} setQuery={setQuery} onSubmit={() => void openZone()} onSearch={() => void runSearch()} onOpen={openZone} onMail={() => void loadMail("INBOX")} viewerState={viewerState} viewerMessage={viewerMessage} session={session} />
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
            onRefresh={() => void refreshMiningStatus()}
            onStart={() => void startMiningPartner()}
            onStop={() => void stopMiningPartner()}
            onPayoutRequest={() => void requestManualMiningPayout()}
          />
        ) : null}
        {workspace === "nodes" ? <UserNodes identity={nodeIdentity} message={nodeEnrollMessage} onRefresh={() => void loadNodeIdentity()} onActivate={() => void activateUserNode()} /> : null}
        {workspace === "favorites" ? <SimpleCollection title="Preferiti" items={favorites} onOpen={openZone} /> : null}
        {workspace === "activity" ? <Activity /> : null}
        {workspace === "identity" ? <Identity session={session} onVerify={() => void verifyIdentity()} /> : null}
        {workspace === "notifications" ? <Notifications /> : null}
        {workspace === "settings" ? <Settings nodeMessage={nodeMessage} onRetry={() => void prepareVelora()} /> : null}
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

function Home({ query, setQuery, onSubmit, onSearch, onOpen, onMail, viewerState, viewerMessage, session }: {
  query: string;
  setQuery: (query: string) => void;
  onSubmit: () => void;
  onSearch: () => void;
  onOpen: (zone: string) => void;
  onMail: () => void;
  viewerState: ViewerState;
  viewerMessage: string;
  session: AccountSession | null;
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
  form: { coin: string; payoutWallet: string; threads: string };
  setForm: (form: { coin: string; payoutWallet: string; threads: string }) => void;
  stats: MiningUiStats;
  progress: MiningProgress | null;
  onRefresh: () => void;
  onStart: () => void;
  onStop: () => void;
  onPayoutRequest: () => void;
}) {
  const runtime = formatDuration(props.stats.elapsedSeconds);
  const currentProgress = props.progress?.workers.find((worker) => worker.coin === props.form.coin) ?? props.progress?.workers[0];
  const progressPercent = currentProgress ? Math.max(0, Math.min(100, Number(currentProgress.payout_progress_percent ?? 0))) : 0;
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
          <label>Thread CPU</label>
          <input value={props.form.threads} onChange={(event) => props.setForm({ ...props.form, threads: event.target.value })} />
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
          <p>Thread CPU: {props.form.threads || "2"}</p>
          <p>Wallet salvato: {props.form.payoutWallet ? maskLocalWallet(props.form.payoutWallet) : "non inserito"}</p>
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

function Identity({ session, onVerify }: { session: AccountSession | null; onVerify: () => void }) {
  return (
    <section className="page-card">
      <h1>Identita Velora</h1>
      <p>{session ? `Account: ${session.user.username} - Livello ${session.user.identityLevel}` : "Accedi per verificare il dispositivo."}</p>
      <button type="button" onClick={onVerify} disabled={!session || session.user.identityLevel >= 1}>Verifica dispositivo</button>
      <div className="plan-grid">
        {identityLevels.map(([level, title, text]) => <article key={level}><b>{level}</b><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>
  );
}

function Notifications() {
  return <section className="page-card"><h1>Notifiche</h1><p>Nessuna notifica. Velora ti avvisera quando una zona, release o replica richiede attenzione.</p></section>;
}

function Settings({ nodeMessage, onRetry }: { nodeMessage: string; onRetry: () => void }) {
  return (
    <section className="page-card">
      <h1>Impostazioni</h1>
      <p>{nodeMessage}</p>
      <button type="button" onClick={onRetry}>Riprova preparazione</button>
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

function loadStoredMiningForm() {
  try {
    const raw = localStorage.getItem("velora.mining.form");
    const parsed = raw ? JSON.parse(raw) as { coin?: string; payoutWallet?: string; threads?: string } : {};
    return {
      coin: parsed.coin === "ZEPH" ? "ZEPH" : "XMR",
      payoutWallet: String(parsed.payoutWallet ?? ""),
      threads: String(parsed.threads ?? "2")
    };
  } catch {
    return { coin: "XMR", payoutWallet: "", threads: "2" };
  }
}

function saveStoredMiningForm(form: { coin: string; payoutWallet: string; threads: string }) {
  localStorage.setItem("velora.mining.form", JSON.stringify(form));
}

function maskLocalWallet(wallet: string) {
  const normalized = wallet.trim();
  if (normalized.length <= 14) {
    return normalized;
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
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
