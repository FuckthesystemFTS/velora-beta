import pg from "pg";

const action = process.argv[2] ?? "status";
const nodeName = process.argv[3] ?? "velora-beta-node-1";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  if (action === "suspend") {
    await pool.query("UPDATE beta_logical_nodes SET status = 'SUSPENDED', updated_at = NOW() WHERE name = $1", [nodeName]);
  } else if (action === "resume") {
    await pool.query("UPDATE beta_logical_nodes SET status = 'RECOVERING', updated_at = NOW() WHERE name = $1", [nodeName]);
  } else if (action !== "status") {
    throw new Error(`Unsupported action: ${action}`);
  }

  const nodes = await pool.query("SELECT id, name, status, last_heartbeat_at FROM beta_logical_nodes ORDER BY name");
  console.log(JSON.stringify(nodes.rows, null, 2));
} finally {
  await pool.end();
}
