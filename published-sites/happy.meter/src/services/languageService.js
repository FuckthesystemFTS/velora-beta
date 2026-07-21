const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE || "it";
const SUPPORTED_LANGUAGES = String(process.env.SUPPORTED_LANGUAGES || "it,en,de")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const translations = {
  it: {
    appName: "HappyMeter",
    appTagline: "Misura la tua felicita quotidiana",
    splashTitle: "Benvenuto su HappyMeter",
    splashSubtitle: "Piccole azioni - Grandi cambiamenti",
    start: "Inizia",
    login: "Accedi",
    register: "Registrati",
    dashboard: "Oggi",
    diary: "Diario",
    activities: "Attivita",
    insights: "Insight",
    profile: "Profilo",
    community: "Community",
    premium: "Premium",
    badges: "Premi",
    logout: "Esci",
    happyGesture: "Gesto felice del giorno",
    createMeter: "Crea il tuo Feliciometro",
    homeClaim: "Piccole azioni - Grandi cambiamenti",
    homeClaimDisplay: "Piccole azioni - Grandi cambiamenti",
    disclaimerShort: "HappyMeter e uno strumento digitale di auto osservazione del benessere personale",
    termsLabel: "Termini e condizioni",
    cookieLabel: "Cookie policy",
    privacyLabel: "Privacy policy"
  },
  en: {
    appName: "HappyMeter",
    appTagline: "Measure your daily happiness",
    splashTitle: "Welcome to HappyMeter",
    splashSubtitle: "Small actions - Big changes",
    start: "Start",
    login: "Log in",
    register: "Sign up",
    dashboard: "Today",
    diary: "Diary",
    activities: "Activities",
    insights: "Insights",
    profile: "Profile",
    community: "Community",
    premium: "Premium",
    badges: "Badges",
    logout: "Log out",
    happyGesture: "Happy gesture of the day",
    createMeter: "Create your HappyMeter",
    homeClaim: "Small actions - Big changes",
    homeClaimDisplay: "Small actions - Big changes",
    disclaimerShort: "HappyMeter is a digital tool for personal wellbeing awareness",
    termsLabel: "Terms and conditions",
    cookieLabel: "Cookie policy",
    privacyLabel: "Privacy policy"
  },
  de: {
    appName: "HappyMeter",
    appTagline: "Miss dein taegliches Glueck",
    splashTitle: "Willkommen bei HappyMeter",
    splashSubtitle: "Kleine Taten - Große Veränderungen",
    start: "Starten",
    login: "Anmelden",
    register: "Registrieren",
    dashboard: "Heute",
    diary: "Tagebuch",
    activities: "Aktivitaeten",
    insights: "Einblicke",
    profile: "Profil",
    community: "Community",
    premium: "Premium",
    badges: "Badges",
    logout: "Abmelden",
    happyGesture: "Gluecksgeste des Tages",
    createMeter: "Erstelle dein HappyMeter",
    homeClaim: "Kleine Taten - Große Veränderungen",
    homeClaimDisplay: "Kleine Taten - Große Veränderungen",
    disclaimerShort: "HappyMeter ist ein digitales Werkzeug zur persoenlichen Wahrnehmung des Wohlbefindens",
    termsLabel: "Nutzungsbedingungen",
    cookieLabel: "Cookie Richtlinie",
    privacyLabel: "Datenschutz"
  }
};

function parseCookieLanguage(headerValue) {
  const cookieHeader = String(headerValue || "");
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("happymeter-language="));

  if (!pair) {
    return null;
  }

  return decodeURIComponent(pair.split("=")[1] || "");
}

function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

function translate(lang, key) {
  const resolved = normalizeLanguage(lang);
  return translations[resolved]?.[key] || translations[DEFAULT_LANGUAGE]?.[key] || key;
}

function resolveLanguage(req, user) {
  const candidate =
    req.query.lang ||
    req.body?.preferred_language ||
    req.body?.lang ||
    user?.preferred_language ||
    req.session.language ||
    parseCookieLanguage(req.headers.cookie) ||
    DEFAULT_LANGUAGE;

  const lang = normalizeLanguage(candidate);
  req.session.language = lang;
  return lang;
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  resolveLanguage,
  translate,
  translations
};
