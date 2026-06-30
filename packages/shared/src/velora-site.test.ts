import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { veloraManifestSchema } from "./velora-site.js";
import { validateVeloraSite } from "./velora-site-node.js";

describe("velora manifest", () => {
  test("accepts a valid manifest", () => {
    expect(
      veloraManifestSchema.parse({
        formatVersion: 1,
        address: "shop.demo",
        title: "Demo Velora",
        description: "Sito dimostrativo pubblicato sulla rete Velora",
        category: "shop",
        entryFile: "index.html",
        languages: ["it"],
        keywords: ["demo", "shop", "velora"],
        version: "1.0.0",
        ageRating: "EVERYONE",
        familySafe: true,
        permissions: {
          externalNetwork: false,
          clipboardRead: false,
          clipboardWrite: false,
          notifications: false,
          fileDownload: false
        },
        allowedExternalOrigins: []
      })
    ).toBeTruthy();
  });

  test("blocks env files, executables and unauthorized external origins", async () => {
    const siteRoot = await createTempSite();
    try {
      await writeFile(join(siteRoot, ".env"), "SECRET_TOKEN=demo");
      await writeFile(join(siteRoot, "danger.exe"), "MZ");
      await writeFile(join(siteRoot, "index.html"), '<script src="https://cdn.example.com/app.js"></script>');
      const result = await validateVeloraSite(siteRoot);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes("Sensitive environment file detected"))).toBe(true);
      expect(result.errors.some((error) => error.includes("Blocked executable extension"))).toBe(true);
      expect(result.errors.some((error) => error.includes("External origin https://cdn.example.com is not allowed"))).toBe(true);
    } finally {
      await rm(siteRoot, { recursive: true, force: true });
    }
  });

  test("blocks localhost and javascript urls", async () => {
    const siteRoot = await createTempSite();
    try {
      await writeFile(join(siteRoot, "index.html"), '<a href="javascript:alert(1)">x</a><img src="http://localhost:3000/test.png" />');
      const result = await validateVeloraSite(siteRoot);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes("Blocked javascript: URL"))).toBe(true);
      expect(result.errors.some((error) => error.includes("Blocked localhost/private network reference"))).toBe(true);
    } finally {
      await rm(siteRoot, { recursive: true, force: true });
    }
  }, 15000);
});

async function createTempSite() {
  const siteRoot = await mkdtemp(join(tmpdir(), "velora-site-"));
  await mkdir(join(siteRoot, "assets"), { recursive: true });
  await writeFile(
    join(siteRoot, "velora.json"),
    JSON.stringify({
      formatVersion: 1,
      address: "shop.demo",
      title: "Demo Velora",
      description: "Sito dimostrativo pubblicato sulla rete Velora",
      category: "shop",
      entryFile: "index.html",
      languages: ["it"],
      keywords: ["demo", "shop", "velora"],
      version: "1.0.0",
      ageRating: "EVERYONE",
      familySafe: true,
      permissions: {
        externalNetwork: false,
        clipboardRead: false,
        clipboardWrite: false,
        notifications: false,
        fileDownload: false
      },
      allowedExternalOrigins: []
    }),
    "utf8"
  );
  await writeFile(join(siteRoot, ".veloraignore"), "", "utf8");
  return siteRoot;
}
