require("dotenv").config();

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.SUBSCRIPTIONS_ENABLED = "true";
process.env.SUBSCRIPTIONS_SECRET_KEY =
  process.env.SUBSCRIPTIONS_SECRET_KEY || "local-check-subscriptions-key-2026";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const db = require("../src/db");
const { createApp } = require("../src");
const subscriptionService = require("../src/services/subscriptionService");

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  storeCookies(response) {
    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    setCookie.forEach((item) => {
      const [pair] = String(item).split(";");
      const [key, value] = pair.split("=");
      this.cookies.set(key, value);
    });
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  async request(pathname, options = {}) {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      redirect: options.redirect || "manual",
      method: options.method || "GET",
      headers: {
        ...(options.headers || {}),
        cookie: this.cookieHeader()
      },
      body: options.body
    });
    this.storeCookies(response);
    return response;
  }

  async text(pathname) {
    const response = await this.request(pathname);
    return response.text();
  }

  async csrf(pathname) {
    const html = await this.text(pathname);
    const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!match) {
      throw new Error("CSRF token non trovato");
    }
    return match[1];
  }

  async postForm(pathname, fields, refererPath = pathname) {
    const token = await this.csrf(refererPath);
    return this.request(pathname, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ ...fields, _csrf: token })
    });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await db.initialize();
  const testEmail = "leak-check@example.com";
  const testPassword = "LeakCheck!2026";
  let user = await db.get("SELECT id FROM users WHERE email = ?", [testEmail]);
  if (!user) {
    const passwordHash = await bcrypt.hash("LeakCheckUser!2026", 10);
    const id = await db.insert("users", {
      name: "Leak Check User",
      email: testEmail,
      password_hash: passwordHash,
      status: "active",
      credits: 0
    });
    user = { id };
  }
  await db.run("DELETE FROM subscription_assignments WHERE user_id = ?", [user.id]);
  await db.run("DELETE FROM subscription_requests WHERE user_id = ?", [user.id]);
  const canva = await subscriptionService.getPlatformBySlug("canva");
  await db.run(
    "UPDATE subscription_platforms SET shared_login_email_encrypted = ?, shared_login_password_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      subscriptionService.encryptSecret(testEmail),
      subscriptionService.encryptSecret(testPassword),
      canva.id
    ]
  );

  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const client = new Client(`http://127.0.0.1:${server.address().port}`);

  try {
    const publicPages = [
      "/",
      "/abbonamenti",
      "/abbonamenti/canva",
      "/creator-network",
      "/servizi",
      "/login"
    ];
    for (const page of publicPages) {
      const html = await client.text(page);
      assert(!html.includes(process.env.SUBSCRIPTIONS_SECRET_KEY), `Leak chiave segreta in ${page}`);
      assert(!html.includes(testEmail), `Leak email reale in ${page}`);
      assert(!html.includes(testPassword), `Leak password reale in ${page}`);
      assert(!html.includes("shared_login_password_encrypted"), `Leak campo cifrato in ${page}`);
      assert(!html.includes("shared_login_email_encrypted"), `Leak campo cifrato in ${page}`);
      assert(!html.includes("admin_private_notes"), `Leak note private in ${page}`);
    }

    const publicFiles = [];
    const roots = [path.join(__dirname, "..", "public")];
    while (roots.length) {
      const current = roots.pop();
      fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          roots.push(absolute);
        } else {
          publicFiles.push(absolute);
        }
      });
    }

    publicFiles.forEach((file) => {
      const content = fs.readFileSync(file, "utf8");
      assert(!content.includes(process.env.SUBSCRIPTIONS_SECRET_KEY), `Leak chiave in file pubblico ${file}`);
      assert(!content.includes("shared_login_password_encrypted"), `Leak campo password cifrata in file pubblico ${file}`);
      assert(!content.includes("shared_login_email_encrypted"), `Leak campo email cifrata in file pubblico ${file}`);
    });

    console.log("check-no-public-secret-leaks: OK");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
