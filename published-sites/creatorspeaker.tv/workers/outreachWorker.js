const db = require("../src/db");
const outreach = require("../src/services/outreachService");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await db.initialize();
  const config = outreach.outreachConfig();
  console.log("outreach worker ready");
  while (true) {
    try {
      const result = await outreach.processQueueOnce();
      const waitSeconds = result.processed ? config.minDelaySeconds : 30;
      await sleep(waitSeconds * 1000);
    } catch (error) {
      console.error("outreach worker error:", error.message);
      await sleep(60 * 1000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
