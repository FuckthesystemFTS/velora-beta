const { initDatabase } = require("../db");

async function run() {
  const db = await initDatabase();
  const rows = await db.all(
    `SELECT ht.code, ht.title, COUNT(tl.id) AS likes_count
     FROM happy_tests ht
     LEFT JOIN test_likes tl ON tl.test_code = ht.code
     GROUP BY ht.code, ht.title
     ORDER BY ht.code ASC`,
    []
  );

  rows.forEach((row) => {
    console.log(`${row.code}: ${row.title} -> ${Number(row.likes_count || 0)} like`);
  });
}

run().catch((error) => {
  console.error("[HappyMeter Likes Report]", error.message);
  process.exit(1);
});
