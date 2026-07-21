const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/middleware/adminOnly.js", "outreach.view", "permesso staff outreach mancante");
assertIncludes("src/routes/outreachRoutes.js", "requirePermission", "controllo permessi mancante");
assertIncludes("src/routes/outreachRoutes.js", "/api/outreach/contacts/:id/approve", "API approvazione mancante");
assertIncludes("src/routes/outreachRoutes.js", "/outreach/unsubscribe/:token", "unsubscribe pubblico mancante");
assertIncludes("src/services/outreachService.js", "assertSafeUrl", "validazione URL SSRF mancante");
assertIncludes("src/services/outreachService.js", "isPrivateIp", "blocco IP privati mancante");
assertIncludes("src/services/outreachService.js", "localhost", "blocco localhost mancante");
assertIncludes("src/services/outreachService.js", "169 && parts[1] === 254", "blocco metadata endpoint mancante");
assertIncludes("src/services/outreachService.js", "approval_status !== \"approved\"", "invio contatto non approvato non bloccato");
assertIncludes("src/db/index.js", "idx_outreach_list_contacts_unique", "duplicati lista non coperti");
assertIncludes("src/services/outreachService.js", "javascript:", "sanitizzazione javascript mancante");

console.log("check-outreach-security ok");
