import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packageVeloraSite } from "@velora/shared/velora-site-node";
import { config } from "./config.js";
import { signJsonRecord } from "./crypto.js";

const storeRoot = resolve(process.cwd(), "tmp", "content-store");
const releaseRoot = join(storeRoot, "releases");

export interface LocalPackagedRelease {
  address: string;
  version: string;
  contentCid: string;
  manifestJson: Record<string, unknown>;
  manifestHash: string;
  packageHash: string;
  publisherPublicKey: string;
  publisherSignature: string;
  totalSize: number;
  fileCount: number;
  files: Array<{ path: string; size: number; hash: string }>;
  chunks: Array<{ chunkIndex: number; chunkHash: string; chunkSize: number; localPath: string }>;
  packagePath: string;
}

export async function buildLocalRelease(sitePath: string, publisherPublicKey: string) {
  await mkdir(storeRoot, { recursive: true });
  const packaged = await packageVeloraSite(sitePath, join(storeRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}.vsite`));
  const bytes = new Uint8Array(await readFile(packaged.packagePath));
  const chunks = [];

  for (let chunkIndex = 0, offset = 0; offset < bytes.length; chunkIndex += 1, offset += config.chunkSizeBytes) {
    const chunk = bytes.slice(offset, offset + config.chunkSizeBytes);
    const chunkHash = packaged.filesJson.files.length === 0
      ? packaged.packageHash
      : `${packaged.contentCid}:${chunkIndex}`;
    const localPath = join(storeRoot, `${packaged.contentCid.replace(/[:/]/g, "_")}.${chunkIndex}.chunk`);
    await writeFile(localPath, chunk);
    chunks.push({
      chunkIndex,
      chunkHash,
      chunkSize: chunk.byteLength,
      localPath
    });
  }

  const publisherSignature = signJsonRecord(
    {
      address: packaged.manifest.address,
      contentCid: packaged.contentCid,
      manifestHash: packaged.manifestHash,
      packageHash: packaged.packageHash,
      version: packaged.manifest.version
    },
    config.releaseSigningPrivateKeyBase64
  );

  return {
    address: packaged.manifest.address,
    version: packaged.manifest.version,
    contentCid: packaged.contentCid,
    manifestJson: packaged.manifest,
    manifestHash: packaged.manifestHash,
    packageHash: packaged.packageHash,
    publisherPublicKey,
    publisherSignature,
    totalSize: packaged.filesJson.totalSize,
    fileCount: packaged.filesJson.totalFiles,
    files: packaged.filesJson.files,
    chunks,
    packagePath: packaged.packagePath
  } satisfies LocalPackagedRelease;
}

export async function persistReleaseSnapshot(input: {
  address: string;
  version: string;
  status: string;
  payload: Record<string, unknown>;
}) {
  const target = join(releaseRoot, sanitizePathSegment(input.address), sanitizePathSegment(input.version), "release.json");
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      {
        address: input.address,
        version: input.version,
        status: input.status,
        updatedAt: new Date().toISOString(),
        payload: input.payload
      },
      null,
      2
    )
  );
  return target;
}

export async function persistReleaseEvent(input: {
  address: string;
  releaseId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const eventFile = join(
    releaseRoot,
    sanitizePathSegment(input.address),
    "events",
    `${Date.now()}-${sanitizePathSegment(input.eventType)}-${sanitizePathSegment(input.releaseId)}.json`
  );
  await mkdir(resolve(eventFile, ".."), { recursive: true });
  await writeFile(
    eventFile,
    JSON.stringify(
      {
        ...input,
        recordedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  return eventFile;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
