const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/services/amazonCreatorsApiService.js", "searchProducts", "adapter Amazon Creators API mancante");
assertIncludes("src/services/amazonCreatorsApiService.js", "getProductDetails", "dettaglio prodotto Amazon mancante");
assertIncludes("src/services/amazonCreatorsApiService.js", "buildAffiliateUrl", "link affiliato non gestito");
assertIncludes("src/services/amazonCreatorsApiService.js", "Creators API", "riferimento Creators API mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_price_observations", "storico prezzi interno mancante");
assertIncludes("src/services/affiliateDealsService.js", "computeScores", "deal score mancante");
assertIncludes("src/services/affiliateDealsService.js", "discountScore", "componente sconto mancante");
assertIncludes("src/services/affiliateDealsService.js", "priceHistoryScore", "componente storico prezzi mancante");
assertIncludes("src/services/affiliateDealsService.js", "affiliate_products WHERE amazon_asin = ? AND marketplace = ?", "deduplica ASIN mancante");
assertIncludes("src/services/affiliateDealsService.js", "Dati essenziali mancanti", "offerte senza dati non filtrate");

const amazonService = read("src/services/amazonCreatorsApiService.js");
if (/puppeteer|playwright|selenium|cheerio|amazon\.it\/s\?/i.test(amazonService)) {
  throw new Error("rilevato scraping Amazon non consentito");
}

console.log("check-amazon-deals-integration ok");
