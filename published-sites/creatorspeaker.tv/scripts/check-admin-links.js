const { assert, withServer, loginAdmin } = require("./admin-check-client");

function extractLinks(html) {
  return Array.from(html.matchAll(/\shref="([^"]+)"/g)).map((match) => match[1]);
}

function extractForms(html) {
  return Array.from(html.matchAll(/<form[\s\S]*?>/g)).map((match) => match[0]);
}

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
      "/admin/payments"
    ];
    const checkedLinks = new Set();

    for (const page of pages) {
      const { response, text } = await admin.text(page);
      assert([200, 429].includes(response.status), `${page} non risponde`);
      if (response.status === 429) {
        continue;
      }
      assert(text.trim().length > 500, `${page} sembra vuota`);
      assert(!text.includes('href="#"'), `${page} contiene href #`);
      assert(!text.includes("javascript:void(0)"), `${page} contiene javascript:void(0)`);

      for (const form of extractForms(text)) {
        assert(form.includes("action="), `${page} contiene form senza action`);
      }

      const links = extractLinks(text)
        .filter((href) => href.startsWith("/admin") || href.startsWith("/staff"))
        .filter((href) => !href.includes("/files/") && !href.includes("/video-jobs/"));
      for (const href of links) {
        const cleanHref = href.split("?")[0];
        if (checkedLinks.has(cleanHref)) {
          continue;
        }
        checkedLinks.add(cleanHref);
        const result = await admin.request(cleanHref);
        assert([200, 302, 403, 429].includes(result.status), `${href} da ${page} ritorna ${result.status}`);
        if (checkedLinks.size >= 35) {
          break;
        }
      }
    }

    console.log("check-admin-links: OK");
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
