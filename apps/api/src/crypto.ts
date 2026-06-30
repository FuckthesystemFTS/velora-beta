import nacl from "tweetnacl";
import { createHash, randomBytes } from "node:crypto";
import type { SignedAdminCommand } from "@velora/shared";

export function verifySignedCommand(command: SignedAdminCommand, publicKeyBase64: string) {
  const publicKey = Buffer.from(publicKeyBase64, "base64");
  const signature = Buffer.from(command.signature, "base64");
  const payload = canonicalCommandPayload(command);
  return nacl.sign.detached.verify(payload, signature, publicKey);
}

export function signJsonRecord(payload: Record<string, unknown>, privateKeyBase64: string) {
  if (!privateKeyBase64) {
    throw new Error("missing signing key");
  }
  const secretKey = Buffer.from(privateKeyBase64, "base64");
  const bytes = Buffer.from(JSON.stringify(payload));
  return Buffer.from(nacl.sign.detached(bytes, secretKey)).toString("base64");
}

export function canonicalCommandPayload(command: SignedAdminCommand) {
  const clone = { ...command, signature: "" };
  return Buffer.from(JSON.stringify(clone));
}

export function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
