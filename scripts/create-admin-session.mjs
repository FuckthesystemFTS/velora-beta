#!/usr/bin/env node
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const ttlHours = Math.max(1, Math.min(168, Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 24)));
const username = process.env.ADMIN_USERNAME ?? "velora-admin";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex");
}

try {
  const existing = await pool.query("SELECT id, username, status FROM admin_accounts WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1");
  let admin = existing.rows[0];

  if (!admin) {
    const id = `admin_${randomUUID()}`;
    await pool.query(
      `INSERT INTO admin_accounts (id, username, public_key, public_key_hash, status, must_rotate_password)
       VALUES ($1,$2,$3,$4,'ACTIVE',false)`,
      [id, username, "manual-dashboard-admin", hashValue("manual-dashboard-admin")]
    );
    admin = { id, username, status: "ACTIVE" };
  }

  const token = `vla_admin_${randomUUID()}_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await pool.query(
    "INSERT INTO admin_sessions (id, admin_id, session_token_hash, expires_at) VALUES ($1,$2,$3,$4)",
    [randomUUID(), admin.id, hashValue(token), expiresAt]
  );

  console.log(JSON.stringify({ admin, adminSessionToken: token, expiresAt, ttlHours }, null, 2));
} finally {
  await pool.end();
}
