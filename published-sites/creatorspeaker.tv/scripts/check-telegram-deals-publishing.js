const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/services/affiliateDealsService.js", "sendPhoto", "invio foto Telegram mancante");
assertIncludes("src/services/affiliateDealsService.js", "sendMessage", "fallback testuale Telegram mancante");
assertIncludes("src/services/affiliateDealsService.js", "Vedi offerta su Amazon", "bottone Telegram mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_disclosure", "disclosure affiliate mancante");
assertIncludes("src/services/affiliateDealsService.js", "countPublishedForProduct", "cooldown prodotto Telegram mancante");
assertIncludes("src/routes/affiliateDealsRoutes.js", "affiliate_deals.publish", "permesso pubblicazione Telegram mancante");

const service = read("src/services/affiliateDealsService.js");
if (service.includes("console.log(process.env.TELEGRAM_BOT_TOKEN)")) {
  throw new Error("token Telegram esposto nei log");
}

console.log("check-telegram-deals-publishing ok");
