const fs = require("fs");
const path = require("path");

const root = process.cwd();
const filesToScan = [
  "views/layout-public.ejs",
  "views/index.ejs",
  "views/public-page.ejs",
  "views/percorsi.ejs",
  "views/contatti.ejs",
  "views/login.ejs",
  "views/register.ejs",
  "views/cart.ejs",
  "views/checkout.ejs",
  "views/order-success.ejs",
  "views/policies.ejs",
  "views/404.ejs",
  "views/partials/site-header.ejs",
  "views/partials/site-footer.ejs",
  "public/js/app.js",
  "public/js/cart.js"
];

const bannedPatterns = [
  "Aggiungi al carrello",
  "Carrello",
  "Shop",
  "Shopping",
  "Checkout",
  "Compra",
  "Acquista",
  "Admin",
  "Token",
  "API key",
  "Provider demo",
  "Debug",
  "Credenziali admin",
  "Streamit",
  "ThemeForest",
  "Netflix"
];

const allowList = [
  "amministrativo",
  "amministrativa",
  "istruzioni amministrative"
];

const leaks = [];

for (const relativeFile of filesToScan) {
  const absoluteFile = path.join(root, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    continue;
  }

  const lines = fs.readFileSync(absoluteFile, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw) {
      return;
    }
    if (allowList.some((entry) => raw.toLowerCase().includes(entry.toLowerCase()))) {
      return;
    }

    bannedPatterns.forEach((pattern) => {
      if (raw.includes(pattern)) {
        leaks.push(`${relativeFile}:${index + 1} -> ${pattern}`);
      }
    });
  });
}

if (leaks.length) {
  console.error("Public clean check failed.");
  leaks.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log("Public clean check passed.");
