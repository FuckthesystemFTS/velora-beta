#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";

const groups = Array.from({ length: 5 }, () => randomBytes(2).toString("hex").slice(0, 4).toUpperCase());
const key = groups.join("-");
const hash = createHash("sha256").update(key).digest("hex");
console.log(JSON.stringify({ key, keyHash: hash, keyLast4: key.slice(-4), plan: "INDIVIDUAL", maxDevices: 3 }, null, 2));
