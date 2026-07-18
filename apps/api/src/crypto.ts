import nacl from "tweetnacl";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
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

export function sealChainedPayload(plain: Buffer, secret: string, context: string, layers = 10) {
  if (!secret || secret.length < 16) {
    throw new Error("CLOUD_ENCRYPTION_SECRET_REQUIRED");
  }
  let payload = plain;
  const chain = [];
  for (let index = 0; index < layers; index += 1) {
    const iv = randomBytes(12);
    const key = deriveLayerKey(secret, context, index);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`${context}:${index}`));
    payload = Buffer.concat([cipher.update(payload), cipher.final()]);
    chain.push({ alg: "AES-256-GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
  }
  return {
    scheme: "VELORA_CHAINED_REDUNDANT_V1",
    layers,
    contextHash: hashValue(context),
    chain,
    payload: payload.toString("base64"),
    payloadHash: hashValue(plain.toString("base64"))
  };
}

export function openChainedPayload(envelope: unknown, secret: string, context: string) {
  const parsed = envelope as { scheme?: string; layers?: number; chain?: Array<{ iv: string; tag: string }>; payload?: string; payloadHash?: string };
  if (parsed?.scheme !== "VELORA_CHAINED_REDUNDANT_V1" || !Array.isArray(parsed.chain) || !parsed.payload) {
    throw new Error("INVALID_CLOUD_ENVELOPE");
  }
  let payload = Buffer.from(parsed.payload, "base64");
  for (let index = parsed.chain.length - 1; index >= 0; index -= 1) {
    const layer = parsed.chain[index];
    const key = deriveLayerKey(secret, context, index);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(layer.iv, "base64"));
    decipher.setAAD(Buffer.from(`${context}:${index}`));
    decipher.setAuthTag(Buffer.from(layer.tag, "base64"));
    payload = Buffer.concat([decipher.update(payload), decipher.final()]);
  }
  if (parsed.payloadHash && hashValue(payload.toString("base64")) !== parsed.payloadHash) {
    throw new Error("CLOUD_ENVELOPE_INTEGRITY_FAILED");
  }
  return payload;
}

function deriveLayerKey(secret: string, context: string, index: number) {
  return createHmac("sha256", secret).update(`velora-cloud:${context}:${index}`).digest();
}
