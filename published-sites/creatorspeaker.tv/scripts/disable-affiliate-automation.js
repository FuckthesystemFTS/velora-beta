const db = require("../src/db");
const affiliate = require("../src/services/affiliateDealsService");

async function main() {
  await db.initialize();
  const keys = [
    ["affiliate_automation_enabled", "false", "boolean", "automation"],
    ["affiliate_amazon_search_enabled", "false", "boolean", "automation"],
    ["affiliate_telegram_enabled", "false", "boolean", "telegram"],
    ["affiliate_facebook_enabled", "false", "boolean", "facebook"],
    ["affiliate_daily_special_enabled", "false", "boolean", "facebook"]
  ];

  for (const [key, value, type, group] of keys) {
    await affiliate.setSetting(key, value, type, group, null);
  }

  await db.run(
    "UPDATE affiliate_background_jobs SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE status IN ('queued','processing')",
    ["Fermato manualmente prima della configurazione finale"]
  );
  await db.run(
    "UPDATE affiliate_publication_jobs SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE status IN ('draft','queued','processing')",
    ["Fermato manualmente prima della configurazione finale"]
  );
  await db.run(
    "UPDATE affiliate_offers SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE status = 'queued'"
  );

  const settings = await affiliate.getSettingsMap();
  const jobs = await db.get(
    "SELECT COUNT(*) AS total FROM affiliate_background_jobs WHERE status IN ('queued','processing')"
  );
  const publications = await db.get(
    "SELECT COUNT(*) AS total FROM affiliate_publication_jobs WHERE status IN ('draft','queued','processing')"
  );

  console.log(
    JSON.stringify({
      automation: settings.affiliate_automation_enabled,
      amazon: settings.affiliate_amazon_search_enabled,
      telegram: settings.affiliate_telegram_enabled,
      facebook: settings.affiliate_facebook_enabled,
      dailySpecial: settings.affiliate_daily_special_enabled,
      openBackgroundJobs: Number(jobs.total || 0),
      openPublicationJobs: Number(publications.total || 0)
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
