const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertIncludes = (file, text, message) => {
  if (!read(file).includes(text)) {
    throw new Error(`${message}: ${file}`);
  }
};

assertIncludes("src/services/outreachService.js", "OUTREACH_ENABLED", "gating OUTREACH_ENABLED mancante");
assertIncludes("src/services/outreachService.js", "createTransport", "SMTP nodemailer mancante");
assertIncludes("src/services/outreachService.js", "verifySmtpAndSendTest", "test SMTP admin mancante");
assertIncludes("src/services/outreachService.js", "processQueueOnce", "coda persistente mancante");
assertIncludes("src/services/outreachService.js", "List-Unsubscribe", "header unsubscribe mancante");
assertIncludes("src/services/outreachService.js", "outreach_suppression_list", "suppression list mancante");
assertIncludes("src/services/outreachService.js", "attempt_count", "retry massimo tracciato mancante");
assertIncludes("src/services/outreachService.js", "sanitizeTemplateHtml", "sanitizzazione template mancante");
assertIncludes("workers/outreachWorker.js", "processQueueOnce", "worker outreach mancante");
assertIncludes("Procfile", "worker: node workers/outreachWorker.js", "Procfile worker mancante");

const service = read("src/services/outreachService.js");
if (/tracking pixel|open tracking|<img[^>]+width=["']?1/i.test(service)) {
  throw new Error("tracking nascosto non consentito");
}
if (service.includes("OUTREACH_SMTP_PASS") && service.includes("console.log(process.env.OUTREACH_SMTP_PASS)")) {
  throw new Error("password SMTP nei log");
}

console.log("check-outreach-email ok");
