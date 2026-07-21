const db = require("../src/db");
const outreach = require("../src/services/outreachService");
const affiliateDeals = require("../src/services/affiliateDealsService");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await db.initialize();
  console.log("platform worker ready");
  while (true) {
    try {
      const [affiliateResult, outreachResult] = await Promise.allSettled([
        affiliateDeals.processBackgroundJobOnce("platform-worker"),
        outreach.processQueueOnce()
      ]);

      const affiliateProcessed =
        affiliateResult.status === "fulfilled" && affiliateResult.value && affiliateResult.value.processed;
      const outreachProcessed =
        outreachResult.status === "fulfilled" && outreachResult.value && outreachResult.value.processed;

      if (affiliateResult.status === "rejected") {
        console.error("affiliate worker error:", affiliateResult.reason.message);
      }
      if (outreachResult.status === "rejected") {
        console.error("outreach worker error:", outreachResult.reason.message);
      }

      await sleep(affiliateProcessed || outreachProcessed ? 5000 : 30000);
    } catch (error) {
      console.error("platform worker fatal error:", error.message);
      await sleep(60000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
