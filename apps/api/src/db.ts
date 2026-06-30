import pg from "pg";
import { config } from "./config.js";

export const pool = config.databaseUrl
  ? new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
    })
  : undefined;

export function requirePool() {
  if (!pool) {
    throw new Error("DATABASE_URL is required for persistent backend mode");
  }
  return pool;
}
