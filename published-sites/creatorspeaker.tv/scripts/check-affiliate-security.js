const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/middleware/adminOnly.js", "affiliate_deals.view", "permessi affiliate mancanti");
assertIncludes("src/routes/affiliateDealsRoutes.js", "requireAffiliate", "protezione route affiliate mancante");
assertIncludes("views/admin-affiliate-deals.ejs", "partials/csrf-fields", "CSRF form affiliate mancante");
assertIncludes("src/services/affiliateDealsService.js", "maskSecret", "mascheramento segreti mancante");
assertIncludes("src/services/affiliateDealsService.js", "sanitizeText", "sanitizzazione template mancante");
assertIncludes("src/services/affiliateDealsService.js", "isSafeUrl", "validazione URL mancante");

const publicView = read("views/admin-affiliate-deals.ejs");
if (publicView.includes("META_PAGE_ACCESS_TOKEN") || publicView.includes("TELEGRAM_BOT_TOKEN")) {
  throw new Error("segreti esposti nel frontend affiliate");
}

console.log("check-affiliate-security ok");
