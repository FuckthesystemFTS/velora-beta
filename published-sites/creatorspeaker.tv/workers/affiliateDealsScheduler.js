const db = require("../src/db");
const affiliateDeals = require("../src/services/affiliateDealsService");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await db.initialize();
  console.log("affiliate deals scheduler ready");
  while (true) {
    try {
      await affiliateDeals.runSchedulerTick();
      await sleep(30000);
    } catch (error) {
      console.error("affiliate scheduler error:", error.message);
      await sleep(60000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
