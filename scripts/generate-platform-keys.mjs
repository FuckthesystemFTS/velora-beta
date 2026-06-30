#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { generateRawEd25519KeyPair } from "./lib/crypto.mjs";

mkdirSync("tmp", { recursive: true });
for (const name of [
  "membership",
  "zone-registry",
  "category",
  "release",
  "control-api-server"
]) {
  const keys = generateRawEd25519KeyPair();
  writeFileSync(`tmp/${name}-keys.json`, JSON.stringify(keys, null, 2));
}

console.log("Platform key material written under tmp/. Move secrets into your secret store.");
