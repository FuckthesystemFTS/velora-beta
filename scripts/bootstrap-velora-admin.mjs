#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { encryptJsonWithPassword, generateRawEd25519KeyPair, sha256 } from "./lib/crypto.mjs";

const adminId = `admin_${randomUUID()}`;
const tempPassword = randomBytes(18).toString("base64url");
const decryptPassword = randomBytes(24).toString("base64url");
const username = process.env.ADMIN_USERNAME ?? "REPLACE_WITH_ADMIN_USERNAME";
const keys = generateRawEd25519KeyPair();

const identity = await encryptJsonWithPassword(
  {
    adminId,
    username,
    privateKeyBase64: keys.privateKeyBase64,
    publicKeyBase64: keys.publicKeyBase64,
    createdAt: new Date().toISOString()
  },
  decryptPassword
);

writeFileSync("velora-admin.identity", JSON.stringify(identity, null, 2));
writeFileSync(
  "velora-admin-public.json",
  JSON.stringify(
    {
      adminId,
      username,
      publicKeyBase64: keys.publicKeyBase64,
      publicKeyHash: sha256(keys.publicKeyBase64)
    },
    null,
    2
  )
);
writeFileSync(
  "velora-admin-recovery.txt",
  [
    `Admin ID: ${adminId}`,
    `Username: ${username}`,
    `Temporary password: ${tempPassword}`,
    `Identity file: velora-admin.identity`,
    `Identity decryption password: ${decryptPassword}`,
    "First login requires challenge signing and immediate password rotation."
  ].join("\n")
);

console.log("Generated admin files:");
console.log(" - velora-admin.identity");
console.log(" - velora-admin-public.json");
console.log(" - velora-admin-recovery.txt");
console.log("Store the decryption password and recovery package offline.");
