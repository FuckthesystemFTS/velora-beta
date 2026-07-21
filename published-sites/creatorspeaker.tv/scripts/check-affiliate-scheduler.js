const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("Procfile", "worker: node workers/platformWorker.js", "worker Procfile mancante");
assertIncludes("Procfile", "clock: node workers/affiliateDealsScheduler.js", "clock Procfile mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_background_jobs", "coda job dedicata mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_clock_lock", "lock scheduler mancante");
assertIncludes("src/services/affiliateDealsService.js", "max_attempts", "retry massimo mancante");
assertIncludes("src/services/affiliateDealsService.js", "300000", "backoff progressivo mancante");
assertIncludes("src/services/affiliateDealsService.js", "Europe/Rome", "timezone affiliate mancante");
assertIncludes("src/services/affiliateDealsService.js", "30", "intervallo 30 minuti mancante");
assertIncludes(".env.example", "AFFILIATE_AUTOMATION_ENABLED=false", "automazione default non disattivata");

console.log("check-affiliate-scheduler ok");
