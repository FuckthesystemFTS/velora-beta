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

type Workspace = "home" | "explore" | "oceano-upload" | "tools" | "cloud" | "mail" | "forum" | "mining" | "nodes" | "favorites" | "activity" | "identity" | "notifications" | "dev" | "settings" | "control";
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

type OceanoSubmission = { id: string; address?: string | null; title: string; summary: string; content_type: string; status: string; admin_note?: string | null; submitted_at: string; published_at?: string | null };

type CloudFile = { id: string; name: string; mime_type: string; size_bytes: number; sha256: string; guardian_status?: string; multisig_required?: boolean; created_at: string; updated_at: string };
type CloudQuota = { quotaBytes: number; usedBytes: number; remainingBytes: number; quotaLabel: string; storage: string; nasFallback: string };
type CloudProtection = {
  guardian?: { status: string; breachedLevels: number; totalLevels: number; cloud?: { layers: number; multisigAvailable: boolean } };
  cloud?: { encryption: string; layers: number; multisig?: { id: string; cosigner_username: string; status: string } | null; pendingActions?: Array<{ id: string; action: string; target_file_id: string; status: string; cosigner_username: string }> };
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

type VeloraLanguage = "it" | "en" | "fr" | "de" | "es" | "ru" | "zh";

const veloraLanguages: Array<[VeloraLanguage, string]> = [
  ["it", "Italiano"],
  ["en", "English"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ru", "Русский"],
  ["zh", "中文"]
];

const veloraDesktopDictionary: Record<Exclude<VeloraLanguage, "it">, Record<string, string>> = {
  en: {
    "L'Upper Web": "The Upper Web", "Home": "Home", "Esplora": "Explore", "Carica su Oceano": "Upload to Oceano", "Velora Tools": "Velora Tools", "Velora Cloud": "Velora Cloud", "Mining Partner": "Mining Partner", "Nodi utente": "User nodes", "Preferiti": "Favorites", "Attivita": "Activity", "Identita": "Identity", "Notifiche": "Notifications", "Pubblica sito": "Publish site", "Impostazioni": "Settings", "Esci": "Sign out",
    "Crea il tuo accesso": "Create your access", "Accedi a Velora": "Sign in to Velora", "Registrati": "Register", "Accedi": "Sign in", "Crea account": "Create account", "Alias": "Alias", "Password": "Password",
    "Sicuro. Veloce. Semplice. Per tutti.": "Safe. Fast. Simple. For everyone.", "Cosa vuoi trovare nell'Upper Web?": "What do you want to find in the Upper Web?", "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Search services, apps and zones published on Velora.", "Vai": "Go", "Cerca": "Search",
    "Lingua": "Language", "Riprova preparazione": "Retry setup", "Aggiornatore desktop": "Desktop updater", "Controlla aggiornamenti": "Check for updates", "Mining in corso": "Mining active", "Mining fermo": "Mining stopped", "Avvia mining": "Start mining", "Controlla": "Check", "Stato mining": "Mining status", "Potenza collettiva Velora": "Velora collective power"
  },
  fr: {
    "L'Upper Web": "L’Upper Web", "Home": "Accueil", "Esplora": "Explorer", "Carica su Oceano": "Envoyer vers Oceano", "Velora Tools": "Outils Velora", "Velora Cloud": "Cloud Velora", "Mining Partner": "Mining Partner", "Nodi utente": "Nœuds utilisateur", "Preferiti": "Favoris", "Attivita": "Activité", "Identita": "Identité", "Notifiche": "Notifications", "Pubblica sito": "Publier un site", "Impostazioni": "Réglages", "Esci": "Déconnexion",
    "Crea il tuo accesso": "Créer votre accès", "Accedi a Velora": "Connexion à Velora", "Registrati": "S’inscrire", "Accedi": "Connexion", "Crea account": "Créer un compte", "Alias": "Alias", "Password": "Mot de passe",
    "Sicuro. Veloce. Semplice. Per tutti.": "Sûr. Rapide. Simple. Pour tous.", "Cosa vuoi trovare nell'Upper Web?": "Que voulez-vous trouver dans l’Upper Web ?", "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Recherchez services, applications et zones publiées sur Velora.", "Vai": "Ouvrir", "Cerca": "Rechercher",
    "Lingua": "Langue", "Riprova preparazione": "Relancer la préparation", "Aggiornatore desktop": "Mise à jour desktop", "Controlla aggiornamenti": "Rechercher les mises à jour", "Mining in corso": "Mining actif", "Mining fermo": "Mining arrêté", "Avvia mining": "Démarrer le mining", "Controlla": "Vérifier", "Stato mining": "État du mining", "Potenza collettiva Velora": "Puissance collective Velora"
  },
  de: {
    "L'Upper Web": "Das Upper Web", "Home": "Start", "Esplora": "Entdecken", "Carica su Oceano": "Zu Oceano hochladen", "Velora Tools": "Velora Tools", "Velora Cloud": "Velora Cloud", "Mining Partner": "Mining Partner", "Nodi utente": "Benutzerknoten", "Preferiti": "Favoriten", "Attivita": "Aktivität", "Identita": "Identität", "Notifiche": "Benachrichtigungen", "Pubblica sito": "Website veröffentlichen", "Impostazioni": "Einstellungen", "Esci": "Abmelden",
    "Crea il tuo accesso": "Zugang erstellen", "Accedi a Velora": "Bei Velora anmelden", "Registrati": "Registrieren", "Accedi": "Anmelden", "Crea account": "Konto erstellen", "Alias": "Alias", "Password": "Passwort",
    "Sicuro. Veloce. Semplice. Per tutti.": "Sicher. Schnell. Einfach. Für alle.", "Cosa vuoi trovare nell'Upper Web?": "Was möchten Sie im Upper Web finden?", "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Suchen Sie Dienste, Apps und veröffentlichte Velora-Zonen.", "Vai": "Öffnen", "Cerca": "Suchen",
    "Lingua": "Sprache", "Riprova preparazione": "Setup erneut versuchen", "Aggiornatore desktop": "Desktop-Updater", "Controlla aggiornamenti": "Updates prüfen", "Mining in corso": "Mining aktiv", "Mining fermo": "Mining gestoppt", "Avvia mining": "Mining starten", "Controlla": "Prüfen", "Stato mining": "Mining-Status", "Potenza collettiva Velora": "Kollektive Velora-Leistung"
  },
  es: {
    "L'Upper Web": "La Upper Web", "Home": "Inicio", "Esplora": "Explorar", "Carica su Oceano": "Subir a Oceano", "Velora Tools": "Herramientas Velora", "Velora Cloud": "Cloud Velora", "Mining Partner": "Mining Partner", "Nodi utente": "Nodos de usuario", "Preferiti": "Favoritos", "Attivita": "Actividad", "Identita": "Identidad", "Notifiche": "Notificaciones", "Pubblica sito": "Publicar sitio", "Impostazioni": "Ajustes", "Esci": "Salir",
    "Crea il tuo accesso": "Crea tu acceso", "Accedi a Velora": "Acceder a Velora", "Registrati": "Registrarse", "Accedi": "Entrar", "Crea account": "Crear cuenta", "Alias": "Alias", "Password": "Contraseña",
    "Sicuro. Veloce. Semplice. Per tutti.": "Seguro. Rápido. Simple. Para todos.", "Cosa vuoi trovare nell'Upper Web?": "¿Qué quieres encontrar en la Upper Web?", "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Busca servicios, aplicaciones y zonas publicadas en Velora.", "Vai": "Ir", "Cerca": "Buscar",
    "Lingua": "Idioma", "Riprova preparazione": "Reintentar preparación", "Aggiornatore desktop": "Actualizador desktop", "Controlla aggiornamenti": "Buscar actualizaciones", "Mining in corso": "Mining activo", "Mining fermo": "Mining detenido", "Avvia mining": "Iniciar mining", "Controlla": "Comprobar", "Stato mining": "Estado mining", "Potenza collettiva Velora": "Potencia colectiva Velora"
  },
  ru: {
    "L'Upper Web": "Upper Web", "Home": "Главная", "Esplora": "Обзор", "Carica su Oceano": "Загрузить в Oceano", "Velora Tools": "Инструменты Velora", "Velora Cloud": "Cloud Velora", "Mining Partner": "Mining Partner", "Nodi utente": "Узлы пользователя", "Preferiti": "Избранное", "Attivita": "Активность", "Identita": "Идентичность", "Notifiche": "Уведомления", "Pubblica sito": "Опубликовать сайт", "Impostazioni": "Настройки", "Esci": "Выйти",
    "Crea il tuo accesso": "Создайте доступ", "Accedi a Velora": "Войти в Velora", "Registrati": "Регистрация", "Accedi": "Войти", "Crea account": "Создать аккаунт", "Alias": "Alias", "Password": "Пароль",
    "Sicuro. Veloce. Semplice. Per tutti.": "Безопасно. Быстро. Просто. Для всех.", "Cosa vuoi trovare nell'Upper Web?": "Что вы хотите найти в Upper Web?", "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Ищите сервисы, приложения и зоны, опубликованные в Velora.", "Vai": "Открыть", "Cerca": "Поиск",
    "Lingua": "Язык", "Riprova preparazione": "Повторить подготовку", "Aggiornatore desktop": "Обновление desktop", "Controlla aggiornamenti": "Проверить обновления", "Mining in corso": "Майнинг активен", "Mining fermo": "Майнинг остановлен", "Avvia mining": "Запустить mining", "Controlla": "Проверить", "Stato mining": "Статус mining", "Potenza collettiva Velora": "Общая мощность Velora"
  },
  zh: {
    "L'Upper Web": "Upper Web", "Home": "首页", "Esplora": "探索", "Carica su Oceano": "上传到 Oceano", "Velora Tools": "Velora 工具", "Velora Cloud": "Velora 云", "Mining Partner": "Mining Partner", "Nodi utente": "用户节点", "Preferiti": "收藏", "Attivita": "活动", "Identita": "身份", "Notifiche": "通知", "Pubblica sito": "发布网站", "Impostazioni": "设置", "Esci": "退出",
    "Crea il tuo accesso": "创建访问权限", "Accedi a Velora": "登录 Velora", "Registrati": "注册", "Accedi": "登录", "Crea account": "创建账户", "Alias": "别名", "Password": "密码",
    "Sicuro. Veloce. Semplice. Per tutti.": "安全。快速。简单。面向所有人。", "Cosa vuoi trovare nell'Upper Web?": "你想在 Upper Web 中找到什么？", "Cerca servizi, applicazioni e zone pubblicate su Velora.": "搜索 Velora 上发布的服务、应用和区域。", "Vai": "打开", "Cerca": "搜索",
    "Lingua": "语言", "Riprova preparazione": "重试准备", "Aggiornatore desktop": "桌面更新器", "Controlla aggiornamenti": "检查更新", "Mining in corso": "正在挖矿", "Mining fermo": "挖矿已停止", "Avvia mining": "启动挖矿", "Controlla": "检查", "Stato mining": "挖矿状态", "Potenza collettiva Velora": "Velora 集体算力"
  }
};

const veloraDesktopPhraseDictionary: Record<Exclude<VeloraLanguage, "it">, Record<string, string>> = {
  en: {
    "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Search services, apps and zones published on Velora.",
    "Accedi o crea il tuo account Velora": "Sign in or create your Velora account",
    "Preparazione di Velora": "Preparing Velora",
    "Cerca o apri una zona dell'Upper Web.": "Search or open an Upper Web zone.",
    "Compila il contenuto e invialo alla revisione admin.": "Fill in the content and submit it for admin review.",
    "Seleziona una cartella del sito e avvia il controllo": "Select a site folder and start the check",
    "Sincronizzazione VeloMail in attesa": "VeloMail sync waiting",
    "Forum in attesa": "Forum waiting",
    "Mining Partner non avviato": "Mining Partner not started",
    "Controllo aggiornamenti in attesa": "Update check waiting",
    "Nodo utente non ancora attivato": "User node not activated yet",
    "Cloud beta pronto: 25 MB per account registrato.": "Cloud beta ready: 25 MB per registered account.",
    "Prepara una zona, verifica i contenuti e rendila disponibile su Velora.": "Prepare a zone, verify the content and make it available on Velora.",
    "Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.": "Start the local miner, view real-time status and use your public wallet for manual payout after admin verification.",
    "Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.": "Download XMRig from the official site, extract it and place the miner file in the indicated folder. Velora does not download miners automatically and never asks for seed, private key or wallet password.",
    "Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo": "All active PCs mine to the same Velora operational wallet, with separate workers for each device"
  },
  fr: {
    "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Recherchez services, applications et zones publiées sur Velora.",
    "Accedi o crea il tuo account Velora": "Connectez-vous ou créez votre compte Velora",
    "Preparazione di Velora": "Préparation de Velora",
    "Cerca o apri una zona dell'Upper Web.": "Recherchez ou ouvrez une zone de l’Upper Web.",
    "Compila il contenuto e invialo alla revisione admin.": "Complétez le contenu et envoyez-le en révision admin.",
    "Seleziona una cartella del sito e avvia il controllo": "Sélectionnez un dossier de site et lancez le contrôle",
    "Sincronizzazione VeloMail in attesa": "Synchronisation VeloMail en attente",
    "Forum in attesa": "Forum en attente",
    "Mining Partner non avviato": "Mining Partner non démarré",
    "Controllo aggiornamenti in attesa": "Recherche de mises à jour en attente",
    "Nodo utente non ancora attivato": "Nœud utilisateur pas encore activé",
    "Cloud beta pronto: 25 MB per account registrato.": "Cloud bêta prêt : 25 MB par compte enregistré.",
    "Prepara una zona, verifica i contenuti e rendila disponibile su Velora.": "Préparez une zone, vérifiez les contenus et rendez-la disponible sur Velora.",
    "Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.": "Lancez le miner local, suivez l’état en temps réel et utilisez votre wallet public pour recevoir un payout manuel après vérification admin.",
    "Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.": "Téléchargez XMRig depuis le site officiel, extrayez-le et placez le fichier miner dans le dossier indiqué. Velora ne télécharge pas de miner automatiquement et ne demande jamais seed, private key ou mot de passe wallet.",
    "Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo": "Tous les PC actifs minent vers le même wallet opérationnel Velora, avec des workers séparés pour chaque appareil"
  },
  de: {
    "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Suchen Sie Dienste, Apps und veröffentlichte Velora-Zonen.",
    "Accedi o crea il tuo account Velora": "Melden Sie sich an oder erstellen Sie Ihr Velora-Konto",
    "Preparazione di Velora": "Velora wird vorbereitet",
    "Cerca o apri una zona dell'Upper Web.": "Suchen oder öffnen Sie eine Upper-Web-Zone.",
    "Compila il contenuto e invialo alla revisione admin.": "Füllen Sie den Inhalt aus und senden Sie ihn zur Admin-Prüfung.",
    "Seleziona una cartella del sito e avvia il controllo": "Wählen Sie einen Website-Ordner und starten Sie die Prüfung",
    "Sincronizzazione VeloMail in attesa": "VeloMail-Synchronisierung wartet",
    "Forum in attesa": "Forum wartet",
    "Mining Partner non avviato": "Mining Partner nicht gestartet",
    "Controllo aggiornamenti in attesa": "Update-Prüfung wartet",
    "Nodo utente non ancora attivato": "Benutzerknoten noch nicht aktiviert",
    "Cloud beta pronto: 25 MB per account registrato.": "Cloud-Beta bereit: 25 MB pro registriertem Konto.",
    "Prepara una zona, verifica i contenuti e rendila disponibile su Velora.": "Bereiten Sie eine Zone vor, prüfen Sie die Inhalte und machen Sie sie auf Velora verfügbar.",
    "Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.": "Starten Sie den lokalen Miner, sehen Sie den Echtzeitstatus und nutzen Sie Ihre öffentliche Wallet für manuelle Auszahlung nach Admin-Prüfung.",
    "Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.": "Laden Sie XMRig von der offiziellen Website, entpacken Sie es und legen Sie die Miner-Datei in den angegebenen Ordner. Velora lädt Miner nicht automatisch herunter und fragt nie nach Seed, Private Key oder Wallet-Passwort.",
    "Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo": "Alle aktiven PCs minen zur selben operativen Velora-Wallet, mit getrennten Workern pro Gerät"
  },
  es: {
    "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Busca servicios, aplicaciones y zonas publicadas en Velora.",
    "Accedi o crea il tuo account Velora": "Entra o crea tu cuenta Velora",
    "Preparazione di Velora": "Preparando Velora",
    "Cerca o apri una zona dell'Upper Web.": "Busca o abre una zona de la Upper Web.",
    "Compila il contenuto e invialo alla revisione admin.": "Completa el contenido y envíalo a revisión admin.",
    "Seleziona una cartella del sito e avvia il controllo": "Selecciona una carpeta del sitio e inicia el control",
    "Sincronizzazione VeloMail in attesa": "Sincronización VeloMail en espera",
    "Forum in attesa": "Foro en espera",
    "Mining Partner non avviato": "Mining Partner no iniciado",
    "Controllo aggiornamenti in attesa": "Comprobación de actualizaciones en espera",
    "Nodo utente non ancora attivato": "Nodo de usuario aún no activado",
    "Cloud beta pronto: 25 MB per account registrato.": "Cloud beta listo: 25 MB por cuenta registrada.",
    "Prepara una zona, verifica i contenuti e rendila disponibile su Velora.": "Prepara una zona, verifica el contenido y publícala en Velora.",
    "Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.": "Inicia el miner local, mira el estado en tiempo real y usa tu wallet público para recibir payout manual tras verificación admin.",
    "Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.": "Descarga XMRig desde el sitio oficial, extráelo y coloca el archivo miner en la carpeta indicada. Velora no descarga miners automáticamente y nunca pide seed, private key ni contraseña wallet.",
    "Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo": "Todos los PC activos minan hacia el mismo wallet operativo Velora, con workers separados por dispositivo"
  },
  ru: {
    "Cerca servizi, applicazioni e zone pubblicate su Velora.": "Ищите сервисы, приложения и зоны, опубликованные в Velora.",
    "Accedi o crea il tuo account Velora": "Войдите или создайте аккаунт Velora",
    "Preparazione di Velora": "Подготовка Velora",
    "Cerca o apri una zona dell'Upper Web.": "Найдите или откройте зону Upper Web.",
    "Compila il contenuto e invialo alla revisione admin.": "Заполните контент и отправьте его на проверку admin.",
    "Seleziona una cartella del sito e avvia il controllo": "Выберите папку сайта и запустите проверку",
    "Sincronizzazione VeloMail in attesa": "Синхронизация VeloMail ожидает",
    "Forum in attesa": "Форум ожидает",
    "Mining Partner non avviato": "Mining Partner не запущен",
    "Controllo aggiornamenti in attesa": "Проверка обновлений ожидает",
    "Nodo utente non ancora attivato": "Узел пользователя ещё не активирован",
    "Cloud beta pronto: 25 MB per account registrato.": "Cloud beta готов: 25 MB на зарегистрированный аккаунт.",
    "Prepara una zona, verifica i contenuti e rendila disponibile su Velora.": "Подготовьте зону, проверьте контент и сделайте её доступной в Velora.",
    "Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.": "Запустите локальный miner, смотрите статус в реальном времени и используйте публичный wallet для ручного payout после проверки admin.",
    "Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.": "Скачайте XMRig с официального сайта, распакуйте и поместите miner в указанную папку. Velora не скачивает miners автоматически и никогда не просит seed, private key или пароль wallet.",
    "Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo": "Все активные ПК майнят в один операционный wallet Velora, с отдельными workers для каждого устройства"
  },
  zh: {
    "Cerca servizi, applicazioni e zone pubblicate su Velora.": "搜索 Velora 上发布的服务、应用和区域。",
    "Accedi o crea il tuo account Velora": "登录或创建 Velora 账户",
    "Preparazione di Velora": "正在准备 Velora",
    "Cerca o apri una zona dell'Upper Web.": "搜索或打开 Upper Web 区域。",
    "Compila il contenuto e invialo alla revisione admin.": "填写内容并提交 admin 审核。",
    "Seleziona una cartella del sito e avvia il controllo": "选择网站文件夹并开始检查",
    "Sincronizzazione VeloMail in attesa": "VeloMail 同步等待中",
    "Forum in attesa": "论坛等待中",
    "Mining Partner non avviato": "Mining Partner 未启动",
    "Controllo aggiornamenti in attesa": "更新检查等待中",
    "Nodo utente non ancora attivato": "用户节点尚未激活",
    "Cloud beta pronto: 25 MB per account registrato.": "Cloud beta 已就绪：每个注册账户 25 MB。",
    "Prepara una zona, verifica i contenuti e rendila disponibile su Velora.": "准备区域，验证内容，并在 Velora 上发布。",
    "Avvia il miner locale, guarda lo stato in tempo reale e usa il wallet pubblico per ricevere payout manuale dopo verifica admin.": "启动本地 miner，查看实时状态，并使用公开 wallet 在 admin 验证后接收手动 payout。",
    "Scarica XMRig dal sito ufficiale, estrailo e metti il file miner nella cartella indicata. Velora non scarica miner in automatico e non chiede seed, private key o password wallet.": "从官方网站下载 XMRig，解压并将 miner 文件放入指定文件夹。Velora 不会自动下载 miner，也不会索要 seed、private key 或 wallet 密码。",
    "Tutti i PC attivi minano nello stesso wallet operativo Velora, con worker separati per ogni dispositivo": "所有活跃 PC 都挖到同一个 Velora operational wallet，每台设备使用独立 worker"
  }
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
    title: "Velora Search",
    zone: "velora.search",
    description: "Motore interno per trovare zone, strumenti, guide e servizi Velora.",
    category: "Sistema",
    publisher: "Velora",
    identityLevel: "Livello 0",
    verified: true,
    familySafe: true,
    availability: "Online",
    updatedAt: "Pubblicato"
  },
  {
    title: "VeloMail",
    zone: "velora.mail",
    description: "Messaggi tra account Velora con sessione unica e stato persistente.",
    category: "Comunicazione",
    publisher: "Velora",
    identityLevel: "Livello 1",
    verified: true,
    familySafe: true,
    availability: "Online",
    updatedAt: "Pubblicato"
  },
  {
    title: "Velora Cloud",
    zone: "velora.cloud",
    description: "Spazio personale collegato all'account Velora e protetto da Guardian.",
    category: "Cloud",
    publisher: "Velora",
    identityLevel: "Livello 1",
    verified: true,
    familySafe: true,
    availability: "Online",
    updatedAt: "Pubblicato"
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
  tool("Zone Explorer", "tools.zone-explorer", "Velora Core", "Apre una zona Velora valida dalla sezione Esplora.", "zone-open", "Zona", "velora.guide"),
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
  tool("Manifest Generator", "tools.manifest", "Creator Studio", "Genera velora-site.json base valido per pubblicazione.", "manifest", "Dati sito", "zona: velora.guide; titolo: Velora Guide"),
  tool("Landing Builder", "tools.landing", "Creator Studio", "Crea HTML landing minimale pronta per Velora.", "landing", "Idea pagina", "Titolo, sottotitolo, sezioni"),
  tool("SEO Velora", "tools.seo", "Creator Studio", "Genera titolo, descrizione e tag per ricerca interna.", "seo", "Descrizione sito", "Incolla descrizione del sito"),
  tool("Accessibility Check", "tools.accessibility", "Creator Studio", "Controlla leggibilita base, contrasto testuale e alternative.", "accessibility", "HTML o testo", "Incolla HTML o testo pagina"),
  tool("Changelog Writer", "tools.changelog", "Creator Studio", "Crea changelog leggibile per sito o app.", "changelog", "Modifiche", "Incolla elenco modifiche"),
  tool("Mini Logo Maker", "tools.logo", "Creator Studio", "Genera concept testuale per logo e palette.", "logo", "Nome progetto", "Velora Tools"),
  tool("Cover Builder", "tools.cover", "Creator Studio", "Genera brief copertina per sito/zona.", "cover", "Tema", "Benessere quotidiano"),
  tool("Content Packager", "tools.content-pack", "Creator Studio", "Suggerisce alleggerimento contenuti prima della pubblicazione.", "content-pack", "Lista file", "Incolla nomi file o dimensioni"),
  tool("Prompt Sito Velora", "tools.prompt-site", "Creator Studio", "Crea prompt per adattare un sito a Velora.", "prompt-site", "Percorso o nome sito", "C:\\\\sito-da-convertire"),
  tool("Publish Plan", "tools.publish-plan", "Creator Studio", "Crea piano pubblicazione: controllo, manifest, upload, indicizzazione.", "publish-plan", "Zona", "nome.zona")
];

const defaultFeaturedSites = featuredSites.filter((site) => site.availability === "Online" || site.verified);

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
  ["Publisher Pro", "19,90 EUR/mese", "Supporto prioritario, strumenti avanzati e visibilita publisher."]
];

function initialVeloraLanguage(): VeloraLanguage {
  const saved = window.localStorage.getItem("velora.language") as VeloraLanguage | null;
  if (saved && veloraLanguages.some(([code]) => code === saved)) return saved;
  const browser = window.navigator.language.slice(0, 2).toLowerCase() as VeloraLanguage;
  return veloraLanguages.some(([code]) => code === browser) ? browser : "it";
}

function applyDesktopLanguage(language: VeloraLanguage) {
  window.localStorage.setItem("velora.language", language);
  document.documentElement.lang = language;
  const dictionary = language === "it" ? {} : veloraDesktopDictionary[language];
  const phrases = language === "it" ? {} : veloraDesktopPhraseDictionary[language];
  const translate = (value: string) => {
    const source = value.trim();
    const exact = dictionary[source];
    if (exact) return exact;
    return Object.entries(phrases)
      .sort((a, b) => b[0].length - a[0].length)
      .reduce((translated, [from, to]) => translated.split(from).join(to), source);
  };
  document.querySelectorAll<HTMLElement>("button,a,b,span,p,h1,h2,h3,label,small,strong,li,option").forEach((element) => {
    if (element.closest("[data-no-translate]") || element.childElementCount > 0) return;
    const source = element.dataset.vlSrc || element.textContent?.trim() || "";
    if (!source) return;
    element.dataset.vlSrc = source;
    element.textContent = translate(source);
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach((element) => {
    const source = element.dataset.vlPhSrc || element.placeholder;
    if (!source) return;
    element.dataset.vlPhSrc = source;
    element.placeholder = translate(source);
  });
}

function App() {
  const [workspace, setWorkspace] = React.useState<Workspace>("home");
  const [language, setLanguage] = React.useState<VeloraLanguage>(() => initialVeloraLanguage());
  const [networkState, setNetworkState] = React.useState<NetworkState>("syncing");
  const [nodeMessage, setNodeMessage] = React.useState("Preparazione di Velora");
  const [query, setQuery] = React.useState("");
  const [address, setAddress] = React.useState("velora.guide");
  const [loadedSite, setLoadedSite] = React.useState<LoadedSiteDocument | null>(null);
  const [activeToolZone, setActiveToolZone] = React.useState("tools.tts");
  const [viewerState, setViewerState] = React.useState<ViewerState>("idle");
  const [viewerMessage, setViewerMessage] = React.useState("Cerca o apri una zona dell'Upper Web.");
  const [favorites, setFavorites] = React.useState<string[]>(["velora.guide"]);
  const [searchResults, setSearchResults] = React.useState<SearchCard[]>([]);
  const [hasSearchResults, setHasSearchResults] = React.useState(false);
  const [searchCategory, setSearchCategory] = React.useState("");
  const [oceanoDraft, setOceanoDraft] = React.useState({ title: "", summary: "", body: "", contentType: "ARTICLE", sourceUrl: "", tags: "" });
  const [oceanoSubmissions, setOceanoSubmissions] = React.useState<OceanoSubmission[]>([]);
  const [oceanoUploadMessage, setOceanoUploadMessage] = React.useState("Compila il contenuto e invialo alla revisione admin.");
  const [publisherSitePath, setPublisherSitePath] = React.useState(demoSitePath);
  const [publisherAddress, setPublisherAddress] = React.useState("velora.guide");
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
  const [cloudFiles, setCloudFiles] = React.useState<CloudFile[]>([]);
  const [cloudQuota, setCloudQuota] = React.useState<CloudQuota | null>(null);
  const [cloudMessage, setCloudMessage] = React.useState("Cloud beta pronto: 25 MB per account registrato.");
  const [cloudBusy, setCloudBusy] = React.useState(false);
  const [cloudProtection, setCloudProtection] = React.useState<CloudProtection | null>(null);
  const [cloudCosigner, setCloudCosigner] = React.useState("");
  const siteApi = createVeloraSiteApi(apiBaseUrl);

  React.useEffect(() => {
    window.setTimeout(() => applyDesktopLanguage(language), 0);
  });

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
    void loadCloud(session);
  }, [session]);

  React.useEffect(() => {
    if (!session || workspace !== "cloud") {
      return;
    }
    void loadCloud(session);
  }, [workspace, session?.token]);

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
    const indexedResult = searchResults.find((item) => item.zone.toLowerCase() === normalized);
    if (normalized.startsWith("guide.") || indexedResult?.category.toUpperCase() === "GUIDA") {
      const slug = normalized.replace(/^guide\./, "");
      setAddress(normalized);
      setWorkspace("explore");
      setViewerState("loading");
      setViewerMessage("Apertura guida Velora");
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/guide/${encodeURIComponent(slug)}`);
        if (!response.ok) throw new Error("Guida non trovata");
        const payload = await response.json() as { section: { title: string; description: string; body: string; category: string } };
        setLoadedSite({ address: normalized, title: payload.section.title, html: renderOceanoDocument({ title: payload.section.title, summary: payload.section.description, body: payload.section.body, content_type: "GUIDA" }), source: "velora-guide" });
        setViewerState("ready");
        setViewerMessage(`${payload.section.title} aperta`);
      } catch {
        setLoadedSite({ address: normalized, title: indexedResult?.title ?? "Guida Velora", html: renderOceanoDocument({ title: indexedResult?.title ?? "Guida Velora", summary: indexedResult?.description ?? "Guida Velora", body: indexedResult?.description ?? "Contenuto guida non disponibile.", content_type: "GUIDA" }), source: "velora-guide-index" });
        setViewerState("ready");
        setViewerMessage("Guida aperta dall'indice");
      }
      return;
    }
    if (normalized.startsWith("oceano.") || indexedResult?.category.toUpperCase() === "OCEANO") {
      setAddress(normalized);
      setWorkspace("explore");
      setViewerState("loading");
      setViewerMessage("Apertura contenuto Oceano");
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/oceano/content/${encodeURIComponent(normalized)}`);
        const payload = response.ok ? await response.json() as { content: { title: string; summary: string; body: string; content_type: string; source_url?: string | null; published_at?: string } } : null;
        setLoadedSite({
          address: normalized,
          title: payload?.content.title ?? indexedResult?.title ?? normalized,
          html: renderOceanoDocument(payload?.content ?? { title: indexedResult?.title ?? normalized, summary: indexedResult?.description ?? "Contenuto Oceano indicizzato.", body: indexedResult?.description ?? "Contenuto Oceano indicizzato.", content_type: "OCEANO" }),
          source: "oceano"
        });
        setViewerState("ready");
        setViewerMessage(`${payload?.content.title ?? indexedResult?.title ?? normalized} aperto da Oceano`);
      } catch {
        setLoadedSite({ address: normalized, title: indexedResult?.title ?? normalized, html: renderOceanoDocument({ title: indexedResult?.title ?? normalized, summary: indexedResult?.description ?? "Contenuto Oceano indicizzato.", body: indexedResult?.description ?? "Contenuto Oceano indicizzato.", content_type: "OCEANO" }), source: "oceano-index" });
        setViewerState("ready");
        setViewerMessage(`${indexedResult?.title ?? normalized} aperto dall'indice Oceano`);
      }
      return;
    }
    if (!looksLikeZone(normalized)) {
      await runSearch(normalized);
      return;
    }

    setAddress(normalized);
    setWorkspace("explore");
    setHasSearchResults(false);
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
      setViewerState("not-found");
      setViewerMessage("Zona non trovata.");
    }
  }

  async function runSearch(value = query, category = searchCategory) {
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
    setLoadedSite(null);
    setHasSearchResults(true);
    setViewerState("idle");
    setViewerMessage("Seleziona un risultato per aprirlo a pagina intera.");
    const localTools = veloraTools.filter((toolItem) => {
      const haystack = `${toolItem.title} ${toolItem.zone} ${toolItem.description} ${toolItem.category} ${toolItem.publisher} ${toolItem.group}`.toLowerCase();
      const matchesCategory = !category || toolItem.category.toLowerCase() === category || toolItem.group.toLowerCase().includes(category);
      return matchesCategory && (!normalized || haystack.includes(normalized));
    });
    const localResults = normalized ? localTools : [...defaultFeaturedSites, ...localTools].filter((site) => {
      const haystack = `${site.title} ${site.zone} ${site.description} ${site.category} ${site.publisher}`.toLowerCase();
      const matchesCategory = !category || site.category.toLowerCase() === category;
      return matchesCategory && (!normalized || haystack.includes(normalized));
    });

    try {
      const searchRemote = siteApi.search as (searchQuery: string, searchCategory?: string) => Promise<{ query: string; results: PublisherSearchResult[] }>;
      const result = normalized || category ? await searchRemote(normalized, category) : { results: [] };
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

  async function loadOceanoSubmissions() {
    if (!session) return;
    const response = await fetch(`${apiBaseUrl}/api/v1/oceano/submissions/mine`, { headers: authHeaders(session) });
    if (response.ok) setOceanoSubmissions(((await response.json()) as { submissions: OceanoSubmission[] }).submissions ?? []);
  }

  async function submitOceanoContent() {
    if (!session) { setOceanoUploadMessage("Accedi prima di inviare un contenuto."); return; }
    setOceanoUploadMessage("Invio alla revisione in corso...");
    const response = await fetch(`${apiBaseUrl}/api/v1/oceano/submissions`, {
      method: "POST", headers: { "content-type": "application/json", ...authHeaders(session) },
      body: JSON.stringify({ ...oceanoDraft, tags: oceanoDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) })
    });
    if (!response.ok) { setOceanoUploadMessage("Controlla titolo, riepilogo e contenuto prima di inviare."); return; }
    setOceanoDraft({ title: "", summary: "", body: "", contentType: "ARTICLE", sourceUrl: "", tags: "" });
    setOceanoUploadMessage("Contenuto inviato. Ora è in revisione admin.");
    await loadOceanoSubmissions();
  }

  async function loadCloud(activeSession = session) {
    if (!activeSession) {
      setCloudMessage("Accedi a Velora per usare il Cloud beta.");
      return;
    }
    try {
      const freshSession = activeSession === session ? await ensureFreshSession() : activeSession;
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/files`, { headers: authHeaders(freshSession) });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json() as { files: CloudFile[]; quota: CloudQuota };
      const protectionResponse = await fetch(`${apiBaseUrl}/api/v1/cloud/protection`, { headers: authHeaders(freshSession) });
      if (protectionResponse.ok) {
        setCloudProtection(await protectionResponse.json() as CloudProtection);
      }
      setCloudFiles(payload.files ?? []);
      setCloudQuota(payload.quota);
      setCloudMessage("Cloud beta sincronizzato.");
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Cloud non raggiungibile.");
    }
  }

  async function uploadCloudFile(file: File | null) {
    if (!file) return;
    if (!session) {
      setCloudMessage("Accedi a Velora per caricare file.");
      return;
    }
    setCloudBusy(true);
    setCloudMessage("Upload in corso");
    try {
      const freshSession = await ensureFreshSession();
      const contentBase64 = await fileToBase64(file);
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/files`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", contentBase64 })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? "Upload non riuscito");
      }
      await loadCloud(freshSession);
      setCloudMessage(`${file.name} caricato nel Cloud beta.`);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Upload non riuscito.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function deleteCloudFile(id: string) {
    if (!session) return;
    setCloudBusy(true);
    try {
      const freshSession = await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders(freshSession) });
      if (!response.ok) throw new Error("Eliminazione non riuscita");
      await loadCloud(freshSession);
      setCloudMessage("File rimosso.");
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Eliminazione non riuscita.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function downloadCloudFile(file: CloudFile) {
    if (!session) {
      setCloudMessage("Accedi a Velora per scaricare file.");
      return;
    }
    try {
      const freshSession = await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/files/${encodeURIComponent(file.id)}/download`, { headers: authHeaders(freshSession) });
      if (!response.ok) throw new Error("Download non riuscito");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      setCloudMessage(`${file.name} scaricato.`);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Download non riuscito.");
    }
  }

  async function requestCloudMultisig() {
    if (!session) {
      setCloudMessage("Accedi a Velora per attivare la multifirma.");
      return;
    }
    try {
      const freshSession = await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/multisig/request`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({ cosignerUsername: cloudCosigner })
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "Multifirma non attivata.");
      setCloudMessage(payload?.message ?? "Richiesta multifirma inviata.");
      await loadCloud(freshSession);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Multifirma non attivata.");
    }
  }

  async function approveCloudMultisig(policyId?: string, actionId?: string) {
    if (!session) return;
    try {
      const freshSession = await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/multisig/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(freshSession) },
        body: JSON.stringify({ policyId, actionId })
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "Approvazione non riuscita.");
      setCloudMessage(payload?.message ?? "Approvazione registrata.");
      await loadCloud(freshSession);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Approvazione non riuscita.");
    }
  }

  async function revokeCloudMultisig() {
    if (!session) return;
    try {
      const freshSession = await ensureFreshSession();
      const response = await fetch(`${apiBaseUrl}/api/v1/cloud/multisig/revoke`, { method: "POST", headers: authHeaders(freshSession) });
      if (!response.ok) throw new Error("Revoca non riuscita.");
      setCloudMessage("Multifirma Cloud revocata.");
      await loadCloud(freshSession);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Revoca non riuscita.");
    }
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
        <TopBar networkState={networkState} nodeMessage={nodeMessage} session={session} language={language} setLanguage={setLanguage} onLogout={logout} />
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
            hasSearchResults={hasSearchResults}
            searchCategory={searchCategory}
            setSearchCategory={setSearchCategory}
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
        {workspace === "cloud" ? <VeloraCloud files={cloudFiles} quota={cloudQuota} protection={cloudProtection} cosigner={cloudCosigner} setCosigner={setCloudCosigner} message={cloudMessage} busy={cloudBusy} session={session} onRefresh={() => void loadCloud()} onUpload={(file) => void uploadCloudFile(file)} onDownload={(file) => void downloadCloudFile(file)} onDelete={(id) => void deleteCloudFile(id)} onRequestMultisig={() => void requestCloudMultisig()} onApproveMultisig={(policyId, actionId) => void approveCloudMultisig(policyId, actionId)} onRevokeMultisig={() => void revokeCloudMultisig()} /> : null}
        {workspace === "oceano-upload" ? <OceanoUpload draft={oceanoDraft} setDraft={setOceanoDraft} submissions={oceanoSubmissions} message={oceanoUploadMessage} session={session} onSubmit={() => void submitOceanoContent()} onRefresh={() => void loadOceanoSubmissions()} /> : null}
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
        {workspace === "settings" ? <Settings nodeMessage={nodeMessage} releaseCheck={releaseCheck} releaseMessage={releaseMessage} language={language} setLanguage={setLanguage} onRetry={() => void prepareVelora()} onCheckUpdates={() => void checkForUpdates()} /> : null}
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
    ["oceano-upload", "Carica su Oceano"],
    ["tools", "Velora Tools"],
    ["cloud", "Velora Cloud"],
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

function LanguageSelect({ language, setLanguage }: { language: VeloraLanguage; setLanguage: (language: VeloraLanguage) => void }) {
  return (
    <label className="language-select">Lingua
      <select value={language} onChange={(event) => setLanguage(event.target.value as VeloraLanguage)}>
        {veloraLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
    </label>
  );
}

function TopBar({ networkState, nodeMessage, session, language, setLanguage, onLogout }: { networkState: NetworkState; nodeMessage: string; session: AccountSession | null; language: VeloraLanguage; setLanguage: (language: VeloraLanguage) => void; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">VELORA <b>BETA</b></span>
        <p>{nodeMessage}</p>
      </div>
      <div className="top-actions">
        <span className={`status-dot ${networkState}`} />
        <LanguageSelect language={language} setLanguage={setLanguage} />
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
        <FeatureBlock title="Siti verificati" sites={featuredSites.filter((site) => site.verified && !site.zone.includes("demo") && !site.zone.includes("shop"))} onOpen={onOpen} />
        <article className="glass-card">
          <span className="app-pill">Aggiornamenti</span>
          <h2>Velora Beta</h2>
          <p>{releaseMessage}</p>
          <p>{releaseCheck?.latestVersion ? `Ultima versione: ${releaseCheck.latestVersion}` : "Premi controlla per leggere manifest e changelog."}</p>
          <button type="button" onClick={onCheckUpdates}>Controlla aggiornamenti</button>
        </article>
        <FeatureBlock title="Siti emergenti" sites={featuredSites.filter((site) => !site.verified && site.availability === "Online")} onOpen={onOpen} />
        <CategoryCloud />
        <NetworkHighlights />
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
  hasSearchResults: boolean;
  searchCategory: string;
  setSearchCategory: (category: string) => void;
  favorites: string[];
  onOpen: (zone: string) => void;
  onSearch: (query?: string, category?: string) => void;
  onFavorite: (zone: string) => void;
}) {
  return (
    <section className={`workspace-grid explore-layout ${props.loadedSite && props.viewerState === "ready" ? "is-viewing" : ""}`}>
      <div className="zone-browser">
        <div className="zone-toolbar">
          <button type="button" aria-label="Indietro" onClick={() => props.onSearch(props.query)}>Risultati</button>
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
      <SearchResults
        results={props.searchResults}
        visible={props.hasSearchResults && !(props.loadedSite && props.viewerState === "ready")}
        activeCategory={props.searchCategory}
        onCategory={(category) => {
          props.setSearchCategory(category);
          void props.onSearch(props.query, category);
        }}
        onOpen={props.onOpen}
      />
    </section>
  );
}

function VeloraCloud(props: { files: CloudFile[]; quota: CloudQuota | null; protection: CloudProtection | null; cosigner: string; setCosigner: (value: string) => void; message: string; busy: boolean; session: AccountSession | null; onRefresh: () => void; onUpload: (file: File | null) => void; onDownload: (file: CloudFile) => void; onDelete: (id: string) => void; onRequestMultisig: () => void; onApproveMultisig: (policyId?: string, actionId?: string) => void; onRevokeMultisig: () => void }) {
  const usedPercent = props.quota ? Math.min(100, Math.round((props.quota.usedBytes / Math.max(1, props.quota.quotaBytes)) * 100)) : 0;
  const multisig = props.protection?.cloud?.multisig;
  const pendingActions = props.protection?.cloud?.pendingActions ?? [];
  return (
    <section className="dev-workspace cloud-workspace">
      <header className="workspace-heading">
        <span className="eyebrow">VELORA CLOUD</span>
        <h1>Spazio personale beta</h1>
        <p>Ogni account registrato ha 25 MB di spazio test. Il NAS fallback è predisposto per replica contenuti e backup di rete.</p>
      </header>
      <div className="workspace-grid cloud-grid">
        <article className="page-card">
          <h2>Quota</h2>
          <div className="quota-bar"><span style={{ width: `${usedPercent}%` }} /></div>
          <p><strong>{formatBytes(props.quota?.usedBytes ?? 0)}</strong> usati su {props.quota?.quotaLabel ?? "25 MB"}</p>
          <p className="safe-detail">{props.message}</p>
          <div className="button-row">
            <label className={`upload-button ${props.busy || !props.session ? "disabled" : ""}`}>
              Carica file
              <input type="file" disabled={props.busy || !props.session} onChange={(event) => props.onUpload(event.currentTarget.files?.[0] ?? null)} />
            </label>
            <button type="button" onClick={props.onRefresh} disabled={!props.session || props.busy}>Aggiorna</button>
          </div>
        </article>
        <article className="page-card">
          <h2>Guardian</h2>
          <p><strong>{props.protection?.guardian?.status ?? "In attesa"}</strong></p>
          <p className="safe-detail">Cifratura Cloud: {props.protection?.cloud?.layers ?? 10} livelli concatenati.</p>
          <p className="safe-detail">Multifirma: {multisig ? `${multisig.status} con ${multisig.cosigner_username}` : "non attiva"}</p>
          <label>Secondo account Velora
            <input value={props.cosigner} onChange={(event) => props.setCosigner(event.target.value)} placeholder="utente Velora" disabled={!props.session || props.busy} />
          </label>
          <div className="button-row">
            <button type="button" onClick={props.onRequestMultisig} disabled={!props.session || props.busy || props.cosigner.trim().length < 3}>Richiedi multifirma</button>
            {multisig?.status === "PENDING" ? <button type="button" onClick={() => props.onApproveMultisig(multisig.id)} disabled={!props.session || props.busy}>Approva</button> : null}
            {multisig ? <button type="button" onClick={props.onRevokeMultisig} disabled={!props.session || props.busy}>Revoca</button> : null}
          </div>
          {pendingActions.length ? <div className="pending-actions">
            <h3>Azioni da confermare</h3>
            {pendingActions.map((action) => <button key={action.id} type="button" onClick={() => props.onApproveMultisig(undefined, action.id)}>{action.action} {action.target_file_id.slice(0, 8)}</button>)}
          </div> : null}
        </article>
        <article className="page-card">
          <h2>File</h2>
          {props.files.length ? props.files.map((file) => (
            <div className="cloud-file" key={file.id}>
              <div>
                <strong>{file.name}</strong>
                <small>{formatBytes(file.size_bytes)} · SHA-256 {file.sha256.slice(0, 12)}...</small>
              </div>
              <div className="button-row">
                <button type="button" onClick={() => props.onDownload(file)} disabled={props.busy}>Scarica</button>
                <button type="button" onClick={() => props.onDelete(file.id)} disabled={props.busy}>Elimina</button>
              </div>
            </div>
          )) : <p>Nessun file caricato.</p>}
        </article>
      </div>
    </section>
  );
}

function OceanoUpload(props: { draft: { title: string; summary: string; body: string; contentType: string; sourceUrl: string; tags: string }; setDraft: (draft: any) => void; submissions: OceanoSubmission[]; message: string; session: AccountSession | null; onSubmit: () => void; onRefresh: () => void }) {
  return <section className="dev-workspace oceano-upload">
    <header className="workspace-heading"><span className="eyebrow">OCEANO CREATOR</span><h1>Carica contenuti su Oceano</h1><p>Invia articoli, guide e risorse. Ogni contenuto passa dalla revisione admin prima di entrare nell'indice pubblico.</p></header>
    <div className="dev-layout">
      <article className="page-card upload-form"><h2>Nuovo contenuto</h2>
        <ol className="flow-list"><li>Compila</li><li>Invia</li><li>Revisione admin</li><li>Pubblicazione in Oceano</li></ol>
        <label>Titolo<input value={props.draft.title} maxLength={140} onChange={(e) => props.setDraft({ ...props.draft, title: e.target.value })} /></label>
        <label>Riepilogo<textarea value={props.draft.summary} maxLength={500} onChange={(e) => props.setDraft({ ...props.draft, summary: e.target.value })} /></label>
        <label>Tipo<select value={props.draft.contentType} onChange={(e) => props.setDraft({ ...props.draft, contentType: e.target.value })}><option>ARTICLE</option><option>GUIDE</option><option>RESOURCE</option><option>NEWS</option></select></label>
        <label>Contenuto<textarea className="content-editor" value={props.draft.body} maxLength={100000} onChange={(e) => props.setDraft({ ...props.draft, body: e.target.value })} placeholder="Scrivi qui il contenuto completo..." /></label>
        <label>Fonte opzionale<input value={props.draft.sourceUrl} onChange={(e) => props.setDraft({ ...props.draft, sourceUrl: e.target.value })} placeholder="https://..." /></label>
        <label>Tag<input value={props.draft.tags} onChange={(e) => props.setDraft({ ...props.draft, tags: e.target.value })} placeholder="tecnologia, guida, comunità" /></label>
        <div className="button-row"><button disabled={!props.session || props.draft.title.trim().length < 3 || props.draft.summary.trim().length < 10 || props.draft.body.trim().length < 30} onClick={props.onSubmit}>Invia in revisione</button><button className="secondary" onClick={props.onRefresh}>Aggiorna stato</button></div><p className="safe-detail">{props.message}</p>
      </article>
      <article className="page-card"><h2>I tuoi invii</h2>{props.submissions.length ? props.submissions.map((item) => <article className="submission-row" key={item.id}><div><strong>{item.title}</strong><p>{item.summary}</p></div><span className={`submission-status ${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span>{item.admin_note ? <small>Nota admin: {item.admin_note}</small> : null}</article>) : <p>Nessun contenuto inviato.</p>}</article>
    </div>
  </section>;
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

const searchFilterCategories = [
  ["", "Tutte"],
  ["merchant", "Merchant"],
  ["shop", "Shop"],
  ["auto", "Auto"],
  ["tv", "TV"],
  ["sport", "Sport"],
  ["culture", "Culture"],
  ["info", "Info"],
  ["news", "News"],
  ["tools", "Tools"],
  ["health", "Health"]
] as const;

function SearchResults({ results, visible, activeCategory, onCategory, onOpen }: { results: SearchCard[]; visible: boolean; activeCategory: string; onCategory: (category: string) => void; onOpen: (zone: string) => void }) {
  if (!visible) {
    return null;
  }
  return (
    <section className="results-panel">
      <header className="results-heading">
        <div>
          <h2>Risultati Velora</h2>
          <p>Filtra per categoria e apri la zona nel browser.</p>
        </div>
        <span>{results.length} risultati</span>
      </header>
      <div className="search-filters" aria-label="Filtri ricerca">
        {searchFilterCategories.map(([code, label]) => (
          <button key={code || "all"} type="button" className={activeCategory === code ? "active" : ""} onClick={() => onCategory(code)}>
            {label}
          </button>
        ))}
      </div>
      {results.length ? <div className="results-list">{results.map((result) => <SiteCard key={result.zone} site={result} onOpen={onOpen} />)}</div> : (
        <div className="empty-state">
          <h3>Nessun risultato trovato</h3>
          <p>Prova un'altra parola o esplora le categorie.</p>
        </div>
      )}
    </section>
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

function renderOceanoDocument(content: { title: string; summary: string; body: string; content_type: string; source_url?: string | null; published_at?: string }) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const paragraphs = escape(content.body).split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`).join("");
  const source = content.source_url ? `<a href="${escape(content.source_url)}" target="_blank" rel="noreferrer">Consulta la fonte</a>` : "";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(content.title)}</title><style>body{margin:0;background:#f7f8fb;color:#18202d;font:17px/1.75 system-ui,sans-serif}main{max-width:920px;margin:auto;padding:clamp(28px,7vw,88px) clamp(20px,6vw,72px);min-height:100vh;box-sizing:border-box;background:#fff}header{border-bottom:1px solid #dce3ec;padding-bottom:28px;margin-bottom:34px}.kind{color:#536bf6;font-weight:800;letter-spacing:.12em;font-size:12px}h1{font-size:clamp(36px,7vw,68px);line-height:1.05;margin:12px 0 20px;color:#101522}.summary{font-size:21px;color:#536071}article p{margin:0 0 1.4em}a{display:inline-block;margin-top:32px;color:#4059e8;font-weight:700}</style></head><body><main><header><span class="kind">OCEANO · ${escape(content.content_type)}</span><h1>${escape(content.title)}</h1><p class="summary">${escape(content.summary)}</p></header><article>${paragraphs}</article>${source}</main></body></html>`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lettura file non riuscita"));
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
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

function NetworkHighlights() {
  return (
    <article className="glass-card">
      <span className="app-pill">Rete Velora</span>
      <h2>Zone online</h2>
      <p>Apri i siti pubblicati, salva i preferiti e controlla nuove zone direttamente dal motore di ricerca.</p>
      <div className="tag-cloud">
        <span>velora.search</span>
        <span>velora.mail</span>
        <span>velora.cloud</span>
      </div>
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

function Settings({ nodeMessage, releaseCheck, releaseMessage, language, setLanguage, onRetry, onCheckUpdates }: { nodeMessage: string; releaseCheck: ReleaseCheck | null; releaseMessage: string; language: VeloraLanguage; setLanguage: (language: VeloraLanguage) => void; onRetry: () => void; onCheckUpdates: () => void }) {
  return (
    <section className="page-card">
      <h1>Impostazioni</h1>
      <p>{nodeMessage}</p>
      <LanguageSelect language={language} setLanguage={setLanguage} />
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
        return "Inserisci una zona valida, esempio velora.guide";
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
