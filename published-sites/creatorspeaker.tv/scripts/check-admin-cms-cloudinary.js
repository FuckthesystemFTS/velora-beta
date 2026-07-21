require("dotenv").config();

process.env.NODE_ENV = process.env.NODE_ENV || "development";

const bcrypt = require("bcrypt");
const db = require("../src/db");
const { createApp } = require("../src");
const mediaService = require("../src/services/mediaService");

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  store(response) {
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    cookies.forEach((item) => {
      const [pair] = String(item).split(";");
      const [key, value] = pair.split("=");
      this.cookies.set(key, value);
    });
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      redirect: "manual",
      headers: { ...(options.headers || {}), cookie: this.cookieHeader() },
      body: options.body
    });
    this.store(response);
    return response;
  }

  async text(path) {
    const response = await this.request(path);
    return { response, text: await response.text() };
  }

  async csrf(path) {
    const { text } = await this.text(path);
    const match = text.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!match) throw new Error(`CSRF token mancante su ${path}`);
    return match[1];
  }

  async postForm(path, fields, referer = path) {
    const token = await this.csrf(referer);
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, _csrf: token })
    });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureAdminPassword() {
  const username = process.env.ADMIN_INITIAL_USERNAME || "admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD || "CreatorSpeakerTV!2026-ChangeMe";
  const admin = await db.get("SELECT id FROM admins WHERE username = ?", [username]);
  const hash = await bcrypt.hash(password, 10);
  if (admin) {
    await db.run("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, admin.id]);
    return;
  }
  await db.insert("admins", { username, password_hash: hash, must_change_password: db.meta.driver === "pg" ? true : 1 });
}

async function main() {
  await db.initialize();
  await ensureAdminPassword();

  for (const table of ["media_assets", "service_packages", "content_sections"]) {
    const row = db.meta.driver === "pg"
      ? await db.get("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?", [table])
      : await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    assert(row, `${table} non esiste`);
  }

  const status = mediaService.getCloudinaryStatus();
  assert(status.configured || status.message.includes("Cloudinary non configurato"), "Warning Cloudinary non chiaro");

  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const guest = new Client(baseUrl);
  const admin = new Client(baseUrl);

  try {
    assert((await guest.request("/admin/media")).status === 302, "Media library non protetta");
    assert((await guest.request("/admin/media/upload", { method: "POST" })).status === 302, "Upload media non protetto");

    await admin.postForm("/admin/login", {
      username: process.env.ADMIN_INITIAL_USERNAME || "admin",
      password: process.env.ADMIN_INITIAL_PASSWORD || "CreatorSpeakerTV!2026-ChangeMe"
    }, "/admin/login");

    for (const path of ["/admin/dashboard", "/admin/media", "/admin/cms-packages", "/admin/sections", "/admin/settings", "/admin/creators", "/admin/speakers", "/admin/brands", "/admin/logs"]) {
      const response = await admin.request(path);
      assert(response.status === 200, `${path} non risponde 200`);
    }

    const home = await guest.request("/");
    assert(home.status === 200, "Home pubblica non risponde");
    const packages = await db.all("SELECT id FROM service_packages LIMIT 1");
    assert(Array.isArray(packages), "Pacchetti CMS non leggibili da DB");

    const publicHtml = await (await guest.request("/")).text();
    assert(!publicHtml.includes(process.env.CLOUDINARY_API_SECRET || "__missing_secret__"), "Cloudinary secret esposto in frontend pubblico");

    console.log("check-admin-cms-cloudinary: OK");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
