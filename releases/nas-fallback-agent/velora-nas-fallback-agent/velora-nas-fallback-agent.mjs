#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const configPath = join(root, "velora-nas-agent.config.json");
const examplePath = join(root, "velora-nas-agent.config.example.json");
const configRaw = await readFile(existsSync(configPath) ? configPath : examplePath, "utf8");
const config = JSON.parse(configRaw.replace(/^\uFEFF/, ""));
const storageRoot = resolve(root, config.storageRoot ?? "./data");
await mkdir(storageRoot, { recursive: true });
const folders = ["cloud", "content", "releases", "health", "tmp"];
for (const folder of folders) {
  await mkdir(join(storageRoot, folder), { recursive: true });
}
const identityPath = join(storageRoot, "nas-identity.json");
let identity;
if (existsSync(identityPath)) {
  identity = JSON.parse((await readFile(identityPath, "utf8")).replace(/^\uFEFF/, ""));
} else {
  identity = { nasId: `velora_nas_${randomUUID()}`, createdAt: new Date().toISOString() };
  await writeFile(identityPath, JSON.stringify(identity, null, 2));
}
const heartbeat = {
  ok: true,
  agent: config.agentName,
  version: config.version,
  mode: config.mode,
  nasIdHash: createHash("sha256").update(identity.nasId).digest("hex").slice(0, 24),
  storageRoot,
  folders,
  maxStorageGb: config.maxStorageGb,
  cloudQuotaBytesPerUser: config.cloudQuotaBytesPerUser,
  veloraApiUrl: config.veloraApiUrl,
  forbiddenCapabilities: config.forbiddenCapabilities,
  checkedAt: new Date().toISOString()
};
await stat(storageRoot);
await writeFile(join(storageRoot, "last-health.json"), JSON.stringify(heartbeat, null, 2));
await writeFile(join(storageRoot, "health", "last-health.json"), JSON.stringify(heartbeat, null, 2));
console.log(JSON.stringify(heartbeat, null, 2));
