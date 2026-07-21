require("dotenv").config();

process.env.NODE_ENV = process.env.NODE_ENV || "development";

const db = require("../src/db");
const { createApp } = require("../src");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await db.initialize();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const pages = ["/", "/creator-network", "/speaker-network", "/aziende-brand", "/smart-tv", "/servizi", "/chi-siamo", "/contatti", "/abbonamenti"];
  const forbidden = [
    "Admin Dashboard",
    "CLOUDINARY_API_SECRET",
    process.env.CLOUDINARY_API_SECRET || "__missing_cloudinary_secret__",
    "admin_audit_logs",
    "undefined",
    "null",
    "stack trace",
    "password",
    "token segreti"
  ].filter(Boolean);

  try {
    for (const page of pages) {
      const response = await fetch(`${baseUrl}${page}`);
      const html = await response.text();
      assert(response.status === 200, `${page} non risponde 200`);
      for (const pattern of forbidden) {
        assert(!html.includes(pattern), `${pattern} esposto su ${page}`);
      }
    }
    console.log("check-public-no-admin-leaks: OK");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
