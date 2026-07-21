require("dotenv").config();

const bcrypt = require("bcrypt");
const db = require("../src/db");
const { createApp } = require("../src");

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

  extractCsrf(html, path) {
    const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!match) {
      throw new Error(`CSRF token mancante su ${path}`);
    }
    return match[1];
  }

  async csrf(path) {
    const { text } = await this.text(path);
    return this.extractCsrf(text, path);
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
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureAdminPassword() {
  const username = process.env.ADMIN_INITIAL_USERNAME || "admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD || "CreatorSpeakerTV!2026-ChangeMe";
  const existing = await db.get("SELECT id FROM admins WHERE username = ?", [username]);
  const hash = await bcrypt.hash(password, 10);
  if (existing) {
    await db.run("UPDATE admins SET password_hash = ?, status = 'active' WHERE id = ?", [hash, existing.id]);
    return;
  }
  await db.insert("admins", {
    username,
    password_hash: hash,
    role: "admin",
    status: "active",
    must_change_password: db.meta.driver === "pg" ? true : 1
  });
}

async function ensureStaff() {
  const username = "staff1";
  const password = "CreatorStaff1!2026-ChangeMe";
  const existing = await db.get("SELECT id FROM admins WHERE username = ?", [username]);
  const hash = await bcrypt.hash(password, 10);
  const permissions = JSON.stringify({
    dashboard: true,
    media: true,
    cms_sections: true,
    cms_packages: true,
    creators: true,
    speakers: true,
    brands: true,
    content: true
  });
  if (existing) {
    await db.run(
      "UPDATE admins SET password_hash = ?, role = 'staff', status = 'active', permissions_json = ? WHERE id = ?",
      [hash, permissions, existing.id]
    );
    return;
  }
  await db.insert("admins", {
    username,
    password_hash: hash,
    role: "staff",
    status: "active",
    display_name: "Staff operativo",
    permissions_json: permissions,
    must_change_password: db.meta.driver === "pg" ? true : 1
  });
}

async function withServer(callback) {
  await db.initialize();
  await ensureAdminPassword();
  await ensureStaff();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function loginAdmin(baseUrl) {
  const client = new Client(baseUrl);
  await client.postForm("/admin/login", {
    username: process.env.ADMIN_INITIAL_USERNAME || "admin",
    password: process.env.ADMIN_INITIAL_PASSWORD || "CreatorSpeakerTV!2026-ChangeMe"
  }, "/admin/login");
  return client;
}

async function loginStaff(baseUrl) {
  const client = new Client(baseUrl);
  await client.postForm("/staff/login", {
    username: "staff1",
    password: "CreatorStaff1!2026-ChangeMe"
  }, "/staff/login");
  return client;
}

module.exports = {
  Client,
  assert,
  db,
  withServer,
  loginAdmin,
  loginStaff
};
