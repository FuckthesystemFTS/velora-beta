const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/services/affiliateDealsService.js", "/photos", "tentativo pubblicazione immagine Facebook mancante");
assertIncludes("src/services/affiliateDealsService.js", "/feed", "fallback feed Facebook mancante");
assertIncludes("src/services/affiliateDealsService.js", "pages_manage_posts", "permessi Meta non indicati");
assertIncludes("src/services/affiliateDealsService.js", "publish_daily_special_teaser", "teaser Telegram post Facebook mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_facebook_post_1_time", "orario Facebook 1 mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_facebook_post_2_time", "orario Facebook 2 mancante");

const service = read("src/services/affiliateDealsService.js");
if (service.includes("console.log(process.env.META_PAGE_ACCESS_TOKEN)")) {
  throw new Error("token Facebook esposto nei log");
}

console.log("check-facebook-deals-publishing ok");
