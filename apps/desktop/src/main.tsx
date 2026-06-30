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

type Workspace = "home" | "explore" | "mail" | "favorites" | "activity" | "identity" | "notifications" | "dev" | "settings" | "control";
type ViewerState = "idle" | "loading" | "verifying" | "ready" | "not-found" | "blocked" | "unavailable" | "error";
type NetworkState = "ready" | "syncing" | "limited" | "offline";

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

const identityLevels = [
  ["Livello 0", "Informativo", "Landing page, portfolio e pagine senza account. SDK non obbligatorio."],
  ["Livello 1", "Account base", "Email verificata, password e Login Velora obbligatorio."],
  ["Livello 2", "Identita verificata", "Documento verificato tramite infrastruttura sicura. 1,99 EUR/mese."],
  ["Livello 3", "Operazioni sensibili", "OTP, pagamenti e wallet predisposti. 4,99 EUR/mese, non operativo in beta."]
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
  const [searchResults, setSearchResults] = React.useState<SearchCard[]>(featuredSites);
  const [publisherSitePath, setPublisherSitePath] = React.useState(demoSitePath);
  const [publisherAddress, setPublisherAddress] = React.useState("shop.demo");
  const [validation, setValidation] = React.useState<VeloraValidationResult | null>(null);
  const [packaged, setPackaged] = React.useState<PublisherPackageResponse | null>(null);
  const [releases, setReleases] = React.useState<PublisherReleaseRecord[]>([]);
  const [diagnostics, setDiagnostics] = React.useState("I dettagli tecnici sono disponibili solo qui.");
  const [mailAddress, setMailAddress] = React.useState("beta@velora");
  const [mailUserId, setMailUserId] = React.useState("");
  const [mailMessages, setMailMessages] = React.useState<MailMessage[]>([]);
  const [mailFolder, setMailFolder] = React.useState("INBOX");
  const [mailStatus, setMailStatus] = React.useState("Sincronizzazione VeloMail in attesa");
  const [mailDraft, setMailDraft] = React.useState({ to: "beta@velora", subject: "", body: "" });
  const siteApi = createVeloraSiteApi(apiBaseUrl);

  React.useEffect(() => {
    void prepareVelora();
  }, []);

  async function prepareVelora() {
    try {
      setNodeMessage("Preparazione dei dati locali in corso");
      await invoke<string>("init_local_store");
      await ensureBetaSession();
      setNodeMessage("Connessione alla rete");
      await invoke("get_or_create_node_identity");
      setNetworkState("ready");
      setNodeMessage("Velora e pronta");
    } catch (error) {
      setNetworkState("limited");
      setNodeMessage("Connessione limitata. Puoi continuare a esplorare i contenuti locali.");
      setDiagnostics(String(error));
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
          address: normalized,
          sitePath: demoSitePath
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
      setDiagnostics(String(error));
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
    const localResults = featuredSites.filter((site) => {
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
        publisher: item.address.split(".").slice(-1)[0] ?? "Publisher verificato",
        identityLevel: "Livello 0",
        verified: true,
        familySafe: true,
        availability: item.availability > 0 ? "Disponibile" : "Indicizzato",
        updatedAt: item.release_version ? `Release ${item.release_version}` : "Recente"
      }));
      setSearchResults([...remoteResults, ...localResults].slice(0, 12));
    } catch {
      setSearchResults(localResults);
    }
  }

  async function validateRelease() {
    setValidation(await siteApi.validateRelease({ sitePath: publisherSitePath }));
  }

  async function packageRelease() {
    const identity = await invoke<{ peer_id: string; public_key: string }>("get_or_create_node_identity");
    const result = await siteApi.packageRelease({ sitePath: publisherSitePath, publisherPublicKey: identity.public_key, userId: "beta-publisher" });
    setPackaged(result);
    await invoke("cache_packaged_release", {
      input: {
        ...result,
        releaseId: null,
        status: "PACKAGED_LOCAL"
      }
    });
  }

  async function registerRelease() {
    if (!packaged) {
      return;
    }
    const result = await siteApi.registerRelease({ ...packaged, userId: "beta-publisher" });
    await invoke("cache_packaged_release", {
      input: {
        ...packaged,
        releaseId: result.releaseId ?? null,
        status: result.status
      }
    });
    setDiagnostics(`Release registrata: ${JSON.stringify(result)}`);
    await loadReleases();
  }

  async function loadReleases() {
    const result = await siteApi.listReleases(publisherAddress);
    setReleases(result.releases ?? []);
  }

  function toggleFavorite(zone: string) {
    setFavorites((current) => current.includes(zone) ? current.filter((item) => item !== zone) : [...current, zone]);
  }

  async function loadMail(folder = mailFolder) {
    setWorkspace("mail");
    setMailFolder(folder);
    setMailStatus("Sincronizzazione in corso");
    try {
      const userId = await ensureBetaSession();
      const accountResponse = await fetch(`${apiBaseUrl}/api/v1/mail/account`, { headers: { "x-user-id": userId } });
      if (accountResponse.ok) {
        const account = await accountResponse.json() as { address: string };
        setMailAddress(account.address);
      }
      const endpoint = folder === "INBOX" ? "/api/v1/mail/inbox" : `/api/v1/mail/folders/${encodeURIComponent(folder)}`;
      const response = await fetch(`${apiBaseUrl}${endpoint}`, { headers: { "x-user-id": userId } });
      if (!response.ok) {
        throw new Error("MAIL_SYNC_FAILED");
      }
      const result = await response.json() as { messages: MailMessage[] };
      setMailMessages(result.messages ?? []);
      setMailStatus("Sincronizzato");
    } catch (error) {
      setMailStatus("VeloMail non disponibile in questo momento");
      setDiagnostics(String(error));
    }
  }

  async function sendMail() {
    setMailStatus("Invio in corso");
    try {
      const userId = await ensureBetaSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/mail/send`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": userId },
        body: JSON.stringify({
          to: mailDraft.to.split(",").map((item: string) => item.trim()).filter(Boolean),
          subject: mailDraft.subject,
          body: mailDraft.body
        })
      });
      if (!response.ok) {
        throw new Error("MAIL_SEND_FAILED");
      }
      setMailDraft({ to: mailDraft.to, subject: "", body: "" });
      await loadMail("SENT");
    } catch (error) {
      setMailStatus("Invio non riuscito");
      setDiagnostics(String(error));
    }
  }

  async function ensureBetaSession() {
    if (mailUserId) {
      return mailUserId;
    }
    const identity = await invoke<{ peer_id: string }>("get_or_create_node_identity");
    const response = await fetch(`${apiBaseUrl}/api/v1/beta/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId: identity.peer_id })
    });
    if (!response.ok) {
      throw new Error("BETA_SESSION_FAILED");
    }
    const session = await response.json() as { user: { id: string }; mail: { address: string } };
    setMailUserId(session.user.id);
    setMailAddress(session.mail.address);
    return session.user.id;
  }

  return (
    <div className="app-shell">
      <Sidebar workspace={workspace} setWorkspace={setWorkspace} networkState={networkState} />
      <main className="main">
        <TopBar networkState={networkState} nodeMessage={nodeMessage} />
        {workspace === "home" ? (
          <Home query={query} setQuery={setQuery} onSubmit={() => void openZone()} onSearch={() => void runSearch()} onOpen={openZone} onMail={() => void loadMail("INBOX")} viewerState={viewerState} viewerMessage={viewerMessage} />
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
        {workspace === "favorites" ? <SimpleCollection title="Preferiti" items={favorites} onOpen={openZone} /> : null}
        {workspace === "activity" ? <Activity /> : null}
        {workspace === "identity" ? <Identity /> : null}
        {workspace === "notifications" ? <Notifications /> : null}
        {workspace === "settings" ? <Settings diagnostics={diagnostics} nodeMessage={nodeMessage} networkState={networkState} onRetry={() => void prepareVelora()} /> : null}
        {workspace === "dev" ? (
          <VeloraDev
            sitePath={publisherSitePath}
            setSitePath={setPublisherSitePath}
            address={publisherAddress}
            setAddress={setPublisherAddress}
            validation={validation}
            packaged={packaged}
            releases={releases}
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
        <button className={workspace === "dev" ? "active dev-entry" : "dev-entry"} onClick={() => setWorkspace("dev")}>Velora Dev</button>
        {isAdminSessionEnabled ? <button className={workspace === "control" ? "active" : ""} onClick={() => setWorkspace("control")}>Control Center</button> : null}
        <button className={workspace === "settings" ? "active" : ""} onClick={() => setWorkspace("settings")}>Impostazioni</button>
        <span className={`network ${networkState}`}>{networkLabel(networkState)}</span>
      </div>
    </aside>
  );
}

function TopBar({ networkState, nodeMessage }: { networkState: NetworkState; nodeMessage: string }) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">VELORA <b>BETA</b></span>
        <p>{nodeMessage}</p>
      </div>
      <div className="top-actions">
        <span className={`status-dot ${networkState}`} />
        <button type="button" aria-label="Notifiche">Notifiche</button>
        <button type="button" aria-label="Profilo">Profilo beta</button>
      </div>
    </header>
  );
}

function Home({ query, setQuery, onSubmit, onSearch, onOpen, onMail, viewerState, viewerMessage }: {
  query: string;
  setQuery: (query: string) => void;
  onSubmit: () => void;
  onSearch: () => void;
  onOpen: (zone: string) => void;
  onMail: () => void;
  viewerState: ViewerState;
  viewerMessage: string;
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
          <p>La tua posta nell'Upper Web, collegata all'account Velora.</p>
          <button type="button" onClick={onMail}>Apri VeloMail</button>
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
        {["Commercio", "Salute", "Creativita", "Istruzione", "Servizi", "Sistema"].map((item) => <span key={item}>{item}</span>)}
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

function Identity() {
  return (
    <section className="page-card">
      <h1>Identita Velora</h1>
      <div className="plan-grid">
        {identityLevels.map(([level, title, text]) => <article key={level}><b>{level}</b><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>
  );
}

function Notifications() {
  return <section className="page-card"><h1>Notifiche</h1><p>Nessuna notifica. Velora ti avvisera quando una zona, release o replica richiede attenzione.</p></section>;
}

function Settings({ diagnostics, nodeMessage, networkState, onRetry }: { diagnostics: string; nodeMessage: string; networkState: NetworkState; onRetry: () => void }) {
  return (
    <section className="page-card">
      <h1>Impostazioni</h1>
      <p>{nodeMessage}</p>
      <button type="button" onClick={onRetry}>Riprova preparazione</button>
      <details>
        <summary>Avanzate / Diagnostica</summary>
        <pre>{JSON.stringify({ networkState, diagnostics }, null, 2)}</pre>
      </details>
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
  onValidate: () => void;
  onPackage: () => void;
  onRegister: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="dev-workspace">
      <header className="workspace-heading">
        <span className="eyebrow">VELORA DEV</span>
        <h1>Publisher ecosystem</h1>
        <p>Zona, manifest, SDK e review sono separati dall'esperienza dell'utente normale.</p>
      </header>
      <div className="dev-layout">
        <article className="page-card">
          <h2>Publisher Studio guidato</h2>
          <ol className="flow-list">
            {["Seleziona la zona", "Seleziona progetto o dist", "Analisi del progetto", "Configura identita e permessi", "Verifica manifest", "Anteprima", "Crea pacchetto", "Invia alla revisione"].map((step) => <li key={step}>{step}</li>)}
          </ol>
          <label>Zona<input value={props.address} onChange={(event) => props.setAddress(event.target.value)} /></label>
          <label>Cartella progetto<input value={props.sitePath} onChange={(event) => props.setSitePath(event.target.value)} /></label>
          <div className="button-row">
            <button onClick={props.onValidate}>Analizza</button>
            <button onClick={props.onPackage}>Crea pacchetto</button>
            <button onClick={props.onRegister} disabled={!props.packaged}>Invia revisione</button>
            <button onClick={props.onRefresh}>Release</button>
          </div>
          {props.validation ? <ReviewBox validation={props.validation} /> : null}
          {props.packaged ? <p className="safe-detail">Pacchetto pronto. Content CID e hash completi sono disponibili in diagnostica Dev.</p> : null}
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

function ControlCenter() {
  return (
    <section className="page-card restricted">
      <h1>{desktopBranding.controlCenterName}</h1>
      <p>Ambiente amministrativo riservato. In questa beta desktop non e mostrato agli utenti normali.</p>
      <div className="tag-cloud">
        {["Panoramica", "Richieste zone", "Revisioni", "Publisher", "Sicurezza", "Audit", "Revoche", "Diagnostica"].map((item) => <span key={item}>{item}</span>)}
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
