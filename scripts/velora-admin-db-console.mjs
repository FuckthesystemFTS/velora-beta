#!/usr/bin/env node
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for emergency admin DB access.");
  process.exit(1);
}
console.log("Connect a local SQL client with the provided DATABASE_URL. This console is intentionally not embedded in the public installer.");
