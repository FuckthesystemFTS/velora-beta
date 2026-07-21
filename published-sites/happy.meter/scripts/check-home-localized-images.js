const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const port = process.env.CHECK_HOME_PORT || "3100";
const baseUrl = process.env.CHECK_HOME_BASE_URL || `http://127.0.0.1:${port}`;
const imagePaths = {
  it: "/images/happymeter/home-it-v2.png",
  en: "/images/happymeter/home-en-v2.png",
  de: "/images/happymeter/home-de-v2.png"
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchText(route) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { Accept: "text/html" }
  });
  assert(response.status === 200, `${route} ha restituito ${response.status}`);
  return response.text();
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Server locale non raggiungibile per il controllo home");
}

async function ensureServer() {
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (response.ok) {
      return null;
    }
  } catch (error) {
    void error;
  }

  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: port },
    stdio: "ignore"
  });
  await waitForServer();
  return child;
}

function checkImageFiles() {
  Object.entries(imagePaths).forEach(([lang, publicPath]) => {
    const filePath = path.join(projectRoot, "public", publicPath.replace(/^\//, ""));
    assert(fs.existsSync(filePath), `Immagine ${lang} mancante: ${publicPath}`);
  });
}

function checkNoBrokenText(html, route) {
  const forbidden = ["undefined", "null", "attivitàsplicite", "attivitàsplici", "homeClaimDisplay"];
  forbidden.forEach((text) => {
    assert(!html.includes(text), `${route} contiene testo non valido: ${text}`);
  });
}

function checkCommonItalianText(html) {
  assert(html.includes("Piccole azioni - Grandi cambiamenti"), "Slogan italiano mancante");
  assert(html.includes("attività semplici"), "Testo italiano attività semplici mancante");
  assert(html.includes("Un test immediato per misurare l’attuale stato di felicità"), "Titolo test immediato italiano mancante");
  assert(html.includes("Chiunque voglia vivere con consapevolezza"), "Voce A chi serve italiana 1 mancante");
  assert(html.includes("Team &amp; Gruppi orientati al benessere") || html.includes("Team & Gruppi orientati al benessere"), "Voce A chi serve italiana 2 mancante");
  assert(html.includes("Accompagnatori di vita che vogliono fare la differenza"), "Voce A chi serve italiana 3 mancante");
}

function checkHome(html, lang, expectedImage, expectedSlogan) {
  assert(html.includes(`src="${expectedImage}"`), `Immagine ${lang} non caricata`);
  assert(html.includes(expectedSlogan), `Slogan ${lang} mancante`);
  checkNoBrokenText(html, lang);
}

async function run() {
  checkImageFiles();
  const server = await ensureServer();
  try {
    const htmlIt = await fetchText("/?lang=it");
    const htmlEn = await fetchText("/?lang=en");
    const htmlDe = await fetchText("/?lang=de");
    const htmlFallback = await fetchText("/?lang=fr");
    const css = fs.readFileSync(path.join(projectRoot, "public", "css", "styles.css"), "utf8");

    checkHome(htmlIt, "it", imagePaths.it, "Piccole azioni - Grandi cambiamenti");
    checkHome(htmlEn, "en", imagePaths.en, "Small actions - Big changes");
    checkHome(htmlDe, "de", imagePaths.de, "Kleine Taten - Große Veränderungen");
    checkHome(htmlFallback, "fallback", imagePaths.it, "Piccole azioni - Grandi cambiamenti");
    checkCommonItalianText(htmlIt);

    assert(css.includes("overflow-x: hidden"), "CSS senza protezione overflow-x");
    assert(css.includes(".home-promo-image"), "CSS immagine home mancante");
    assert(css.includes("object-fit: contain"), "Immagine home senza object-fit contain");

    console.log("Home localizzata verificata: immagini IT/EN/DE, fallback, testi e CSS responsive base OK");
  } finally {
    if (server) {
      server.kill();
    }
  }
}

run().catch((error) => {
  console.error("[HappyMeter Home Check]", error.message);
  process.exit(1);
});
