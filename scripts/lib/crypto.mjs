import { randomBytes, createCipheriv, createDecipheriv, createHash, generateKeyPairSync } from "node:crypto";
import { argon2id } from "hash-wasm";
import nacl from "tweetnacl";

export function generateEd25519KeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export function generateRawEd25519KeyPair() {
  const keys = nacl.sign.keyPair();
  return {
    publicKeyBase64: Buffer.from(keys.publicKey).toString("base64"),
    privateKeyBase64: Buffer.from(keys.secretKey).toString("base64")
  };
}

export async function deriveKey(password, salt, iterations = 3, memorySize = 19456) {
  const hex = await argon2id({
    password,
    salt: salt.toString("hex"),
    parallelism: 1,
    iterations,
    memorySize,
    hashLength: 32,
    outputType: "hex"
  });
  return Buffer.from(hex, "hex");
}

export async function encryptJsonWithPassword(payload, password) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: "AES-256-GCM",
    kdf: "Argon2id",
    argon2: {
      iterations: 3,
      memorySize: 19456,
      parallelism: 1
    },
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: tag.toString("base64")
  };
}

export async function decryptJsonWithPassword(container, password) {
  const key = await deriveKey(password, Buffer.from(container.salt, "base64"), container.argon2.iterations, container.argon2.memorySize);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(container.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(container.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(container.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}
