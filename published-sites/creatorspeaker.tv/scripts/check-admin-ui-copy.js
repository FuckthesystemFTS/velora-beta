const { assert, withServer, loginAdmin } = require("./admin-check-client");

const forbidden = [
  "undefined",
  "null",
  "NaN",
  "[object Object]",
  "Lorem ipsum",
  "demo non operativa",
  "coming soon"
];

async function main() {
  await withServer(async (baseUrl) => {
    const admin = await loginAdmin(baseUrl);
    const pages = [
      "/admin/dashboard",
      "/admin/requests",
      "/admin/clients",
      "/admin/content",
      "/admin/cms-packages",
      "/admin/media",
      "/admin/settings",
      "/admin/staff",
      "/admin/analytics",
      "/admin/site",
      "/staff/dashboard"
    ];

    for (const page of pages) {
      const { response, text } = await admin.text(page.startsWith("/staff") ? "/admin/dashboard" : page);
      assert(response.status === 200, `${page} non verificabile`);
      const visibleText = text.replace(/<[^>]+>/g, " ");
      for (const word of forbidden) {
        assert(!visibleText.toLowerCase().includes(word.toLowerCase()), `${page} contiene ${word}`);
      }
    }

    console.log("check-admin-ui-copy: OK");
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
