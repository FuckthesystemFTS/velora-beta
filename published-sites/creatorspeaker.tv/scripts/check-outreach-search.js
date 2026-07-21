const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/db/index.js", "outreach_searches", "tabella ricerche mancante");
assertIncludes("src/db/index.js", "outreach_contacts", "tabella contatti mancante");
assertIncludes("src/db/index.js", "idx_outreach_contacts_normalized_email", "deduplica email mancante");
assertIncludes("src/services/outreachService.js", "https://www.googleapis.com/customsearch/v1", "Google CSE API ufficiale mancante");
assertIncludes("src/services/outreachService.js", "https://www.bing.com/search", "fallback web mirato senza chiavi mancante");
assertIncludes("src/services/outreachService.js", "places.googleapis.com/v1/places:searchText", "Places API New mancante");
assertIncludes("src/services/outreachService.js", "https://overpass-api.de/api/interpreter", "fallback OpenStreetMap senza chiavi mancante");
assertIncludes("src/services/outreachService.js", "targetQuery", "ricerca mirata mancante");
assertIncludes("src/services/outreachService.js", "MAX_PAGES_PER_DOMAIN = 5", "limite 5 pagine dominio mancante");
assertIncludes("src/services/outreachService.js", "robotsAllowed", "controllo robots mancante");
assertIncludes("src/services/outreachService.js", "source_url", "fonte email non salvata");
assertIncludes("src/services/outreachService.js", "PERSONAL_DOMAINS", "classificazione provider personali mancante");
assertIncludes("src/services/outreachService.js", "contactType = \"pec\"", "esclusione PEC mancante");
assertIncludes("views/admin-outreach.ejs", "Avvia ricerca", "UI ricerca mancante");
assertIncludes("views/admin-outreach.ejs", "OpenStreetMap", "UI fallback OpenStreetMap mancante");
assertIncludes("views/admin-outreach.ejs", "Ricerca mirata nome azienda o persona", "UI ricerca mirata mancante");

const outreach = read("src/services/outreachService.js");
if (outreach.includes("google.com/search") || outreach.includes("maps.google.com")) {
  throw new Error("vietato scraping diretto Google o Maps");
}

console.log("check-outreach-search ok");
