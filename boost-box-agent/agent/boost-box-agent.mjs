#!/usr/bin/env node
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), "data");
await mkdir(dataDir, { recursive: true });
const identityPath = join(dataDir, "boost-box-identity.json");
let identity;
if (existsSync(identityPath)) {
  identity = JSON.parse(await readFile(identityPath, "utf8"));
} else {
  identity = { id: `boost_${randomUUID()}`, createdAt: new Date().toISOString() };
  await writeFile(identityPath, JSON.stringify(identity, null, 2));
}
const health = {
  ok: true,
  component: "velora-boost-box-agent",
  mode: "software-agent-beta",
  hardwareProductAvailable: false,
  identityHash: createHash("sha256").update(identity.id).digest("hex").slice(0, 24),
  forbidden: ["remote-shell", "arbitrary-command", "wallet-custody", "velomail-access"],
  checkedAt: new Date().toISOString()
};
console.log(JSON.stringify(health, null, 2));
