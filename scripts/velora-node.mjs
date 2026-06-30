#!/usr/bin/env node
import dgram from "node:dgram";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { blake3 } from "hash-wasm";
import nacl from "tweetnacl";
import { packageVeloraSite } from "../packages/shared/src/velora-site-node.ts";
import { generateRawEd25519KeyPair } from "./lib/crypto.mjs";

const defaultChunkSize = Number(process.env.VELORA_CHUNK_SIZE_BYTES ?? 1048576);
const defaultRequestTimeoutMs = 5000;
const defaultMdnsPort = 46000;
const defaultMdnsGroup = "239.255.42.99";
const defaultMaxPeers = 32;
const defaultMaxConcurrent = 8;
const defaultHostname = "127.0.0.1";
let stateWriteQueue = Promise.resolve();

const args = parseArgs(process.argv.slice(2));
const command = args._[0]?.startsWith("--") || !args._[0] ? "start" : args._[0];

const handlers = {
  start,
  publish,
  fetch: fetchCommand,
  search,
  rollback,
  providers,
  ping,
  status,
  reset
};

if (!(command in handlers)) {
  console.error("Available commands: start, publish, fetch, search, rollback, providers, ping, status, reset");
  process.exit(1);
}

await handlers[command]();

async function start() {
  const context = await loadNodeContext();
  const socket = await startMdns(context);
  const server = http.createServer((request, response) => routeRequest(context, request, response));
  server.listen(context.listenPort, context.hostname, async () => {
    await logEvent(context, `LISTEN ${context.multiaddr}`);
    console.log(JSON.stringify({
      status: "LISTENING",
      peerId: context.node.peerId,
      publicKey: context.node.publicKey,
      multiaddr: context.multiaddr,
      dataDir: context.dataDir
    }, null, 2));
  });

  server.on("error", async (error) => {
    await logEvent(context, `SERVER_ERROR ${String(error)}`);
    console.error(error);
    process.exitCode = 1;
  });

  if (context.bootstrap) {
    try {
      await bootstrapPeer(context, context.bootstrap);
    } catch (error) {
      await logEvent(context, `BOOTSTRAP_FAILED ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  const announceTimer = setInterval(() => announcePresence(context).catch(() => undefined), 3000);
  announceTimer.unref();
  await announcePresence(context);
  await new Promise(() => undefined);
  socket.close();
}

async function publish() {
  const context = await loadNodeContext();
  const sitePath = resolveRequired(args["site-path"] ?? args._[1], "--site-path is required");
  const releaseVersion = args.version ? String(args.version) : undefined;
  const packagedOutput = join(context.dataDir, "out", `${Date.now()}-${Math.random().toString(16).slice(2)}.vsite`);
  const packaged = await packageVeloraSite(sitePath, packagedOutput);
  const manifest = releaseVersion ? { ...packaged.manifest, version: releaseVersion } : packaged.manifest;
  const content = await storePackagedContent(context, {
    packagePath: packaged.packagePath,
    packageBytes: packaged.packageBytes,
    contentCid: packaged.contentCid,
    packageHash: packaged.packageHash,
    manifest,
    manifestHash: packaged.manifestHash,
    files: packaged.filesJson.files
  });
  const signaturePayload = canonicalJson({
    address: manifest.address,
    zoneId: manifest.address,
    releaseVersion: manifest.version,
    manifestHash: packaged.manifestHash,
    packageHash: packaged.packageHash,
    contentCid: packaged.contentCid,
    publisherPublicKey: context.node.publicKey,
    timestamp: new Date().toISOString(),
    nonce: randomUUID()
  });
  const publisherSignature = signPayload(context.node.privateKey, signaturePayload);
  const release = {
    address: manifest.address,
    version: manifest.version,
    contentCid: packaged.contentCid,
    packageHash: packaged.packageHash,
    manifestHash: packaged.manifestHash,
    entryFile: manifest.entryFile,
    manifest,
    files: packaged.filesJson.files,
    totalSize: packaged.filesJson.totalSize,
    fileCount: packaged.filesJson.totalFiles,
    chunks: content.chunks,
    publisherPublicKey: context.node.publicKey,
    publisherSignature,
    publishedAt: new Date().toISOString(),
    status: "ACTIVE"
  };
  const record = await registerReleaseRecord(context, release);
  await announceRecord(context, record);
  await announceProviders(context, release.contentCid);
  console.log(JSON.stringify({
    status: "PUBLISHED",
    peerId: context.node.peerId,
    address: record.address,
    version: record.activeVersion,
    contentCid: release.contentCid,
    providerCount: providerCount(record.providers, release.contentCid),
    warning: providerCount(record.providers, release.contentCid) < Number(process.env.TARGET_REPLICATION_FACTOR ?? 3)
      ? "Contenuto pubblicato con ridondanza ridotta"
      : undefined
  }, null, 2));
}

async function fetchCommand() {
  const context = await loadNodeContext();
  const address = String(resolveRequired(args.address ?? args._[1], "--address is required"));
  const bootstrap = args.bootstrap ? String(args.bootstrap) : context.bootstrap;
  if (bootstrap) {
    await bootstrapPeer(context, bootstrap);
  }
  const record = await resolveRecord(context, address);
  const release = record.releases[record.activeVersion];
  const state = await loadState(context.dataDir);
  const providersForContent = dedupeProviders([
    ...(record.providers[release.contentCid] ?? []),
    ...(state.providers[release.contentCid] ?? [])
  ]).filter((provider) => provider.peerId !== context.node.peerId);
  if (providersForContent.length === 0) {
    throw new Error(`NO_PROVIDER_FOR_${release.contentCid}`);
  }
  const cached = await fetchContentFromProviders(context, release, providersForContent);
  await announceProviders(context, release.contentCid);
  console.log(JSON.stringify({
    status: "FETCHED",
    address,
    version: release.version,
    contentCid: release.contentCid,
    packagePath: cached.packagePath,
    providersTried: providersForContent.map((provider) => provider.multiaddr)
  }, null, 2));
}

async function search() {
  const context = await loadNodeContext();
  const query = String(resolveRequired(args.query ?? args._[1], "--query is required")).toLowerCase();
  const state = await loadState(context.dataDir);
  const results = state.searchIndex.filter((entry) => {
    const haystack = [entry.address, entry.category, entry.slug, entry.title, entry.description, ...(entry.keywords ?? [])].join(" ").toLowerCase();
    return haystack.includes(query);
  }).sort((left, right) => {
    if (left.address.toLowerCase() === query) {
      return -1;
    }
    if (right.address.toLowerCase() === query) {
      return 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  console.log(JSON.stringify({ query, results }, null, 2));
}

async function rollback() {
  const context = await loadNodeContext();
  const address = String(resolveRequired(args.address ?? args._[1], "--address is required"));
  const version = String(resolveRequired(args.version ?? args._[2], "--version is required"));
  const state = await loadState(context.dataDir);
  const record = state.records[address];
  if (!record || !record.releases[version]) {
    throw new Error(`RELEASE_NOT_FOUND ${address} ${version}`);
  }
  record.activeVersion = version;
  record.updatedAt = new Date().toISOString();
  await saveState(context.dataDir, state);
  await announceRecord(context, record);
  console.log(JSON.stringify({ status: "ROLLED_BACK", address, version }, null, 2));
}

async function providers() {
  const context = await loadNodeContext();
  const contentCid = String(resolveRequired(args.cid ?? args._[1], "--cid is required"));
  const state = await loadState(context.dataDir);
  console.log(JSON.stringify({
    contentCid,
    providers: dedupeProviders(state.providers[contentCid] ?? [])
  }, null, 2));
}

async function ping() {
  const context = await loadNodeContext();
  const target = String(resolveRequired(args.target ?? args._[1], "--target is required"));
  const result = await rpcJson(target, "/rpc/ping", {
    method: "POST",
    body: {
      fromPeerId: context.node.peerId,
      multiaddr: context.multiaddr
    }
  });
  await addOrUpdatePeer(context.dataDir, {
    peerId: String(result.peerId),
    multiaddr: String(result.multiaddr),
    lastSeenAt: new Date().toISOString(),
    source: "ping"
  });
  console.log(JSON.stringify(result, null, 2));
}

async function status() {
  const context = await loadNodeContext();
  const state = await loadState(context.dataDir);
  console.log(JSON.stringify({
    peerId: context.node.peerId,
    publicKey: context.node.publicKey,
    multiaddr: context.multiaddr,
    peers: state.peers,
    records: Object.keys(state.records),
    cachedContent: Object.keys(state.providers),
    searchEntries: state.searchIndex.length
  }, null, 2));
}

async function reset() {
  const dataDir = resolveRequired(args["data-dir"] ?? args._[1], "--data-dir is required");
  await rm(resolve(dataDir), { recursive: true, force: true });
  console.log(JSON.stringify({ status: "RESET", dataDir: resolve(dataDir) }, null, 2));
}

async function loadNodeContext() {
  const dataDir = resolve(args["data-dir"] ?? ".velora-node");
  const listenPort = Number(args["listen-port"] ?? process.env.VELORA_LISTEN_PORT ?? 4101);
  const hostname = String(args.host ?? process.env.VELORA_HOST ?? defaultHostname);
  const bootstrap = args.bootstrap ? String(args.bootstrap) : undefined;
  const mdnsPort = Number(args["mdns-port"] ?? process.env.VELORA_MDNS_PORT ?? defaultMdnsPort);
  const mdnsGroup = String(args["mdns-group"] ?? process.env.VELORA_MDNS_GROUP ?? defaultMdnsGroup);
  const maxPeers = Number(args["max-peers"] ?? defaultMaxPeers);
  const maxConcurrent = Number(args["max-concurrent"] ?? defaultMaxConcurrent);
  await mkdir(dataDir, { recursive: true });
  const node = await loadOrCreateNodeIdentity(dataDir);
  const multiaddr = formatMultiaddr(hostname, listenPort, node.peerId);
  await ensureState(dataDir);
  return { dataDir, node, listenPort, hostname, multiaddr, bootstrap, mdnsPort, mdnsGroup, maxPeers, maxConcurrent };
}

async function routeRequest(context, request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${context.hostname}:${context.listenPort}`}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return respondJson(response, 200, { ok: true, peerId: context.node.peerId, multiaddr: context.multiaddr });
    }
    if (request.method === "GET" && url.pathname === "/identity") {
      const state = await loadState(context.dataDir);
      return respondJson(response, 200, { peerId: context.node.peerId, publicKey: context.node.publicKey, multiaddr: context.multiaddr, peers: state.peers });
    }
    if (request.method === "POST" && url.pathname === "/rpc/ping") {
      const body = await readJsonBody(request);
      await addOrUpdatePeer(context.dataDir, {
        peerId: String(body.fromPeerId),
        multiaddr: String(body.multiaddr),
        lastSeenAt: new Date().toISOString(),
        source: "ping"
      });
      return respondJson(response, 200, { ok: true, peerId: context.node.peerId, multiaddr: context.multiaddr, receivedAt: new Date().toISOString() });
    }
    if (request.method === "POST" && url.pathname === "/rpc/records/announce") {
      const body = await readJsonBody(request);
      const state = await loadState(context.dataDir);
      const record = body.record;
      state.records[record.address] = mergeRecord(state.records[record.address], record);
      mergeSearchEntry(state.searchIndex, record.searchEntry);
      if (Array.isArray(record.providers?.[record.activeContentCid])) {
        state.providers[record.activeContentCid] = dedupeProviders([
          ...(state.providers[record.activeContentCid] ?? []),
          ...record.providers[record.activeContentCid]
        ]);
      }
      await saveState(context.dataDir, state);
      return respondJson(response, 200, { ok: true, address: record.address, version: record.activeVersion });
    }
    if (request.method === "GET" && url.pathname.startsWith("/rpc/records/")) {
      const address = decodeURIComponent(url.pathname.replace("/rpc/records/", ""));
      const state = await loadState(context.dataDir);
      const record = state.records[address];
      if (!record) {
        return respondJson(response, 404, { code: "RECORD_NOT_FOUND" });
      }
      return respondJson(response, 200, { record });
    }
    if (request.method === "GET" && url.pathname === "/rpc/search") {
      const query = String(url.searchParams.get("q") ?? "").trim().toLowerCase();
      const state = await loadState(context.dataDir);
      const results = state.searchIndex.filter((entry) => [entry.address, entry.title, entry.description, ...(entry.keywords ?? [])].join(" ").toLowerCase().includes(query));
      return respondJson(response, 200, { query, results });
    }
    if (request.method === "POST" && url.pathname === "/rpc/providers/announce") {
      const body = await readJsonBody(request);
      const state = await loadState(context.dataDir);
      state.providers[body.contentCid] = dedupeProviders([...(state.providers[body.contentCid] ?? []), ...body.providers]);
      await saveState(context.dataDir, state);
      return respondJson(response, 200, { ok: true, contentCid: body.contentCid, providerCount: state.providers[body.contentCid].length });
    }
    if (request.method === "GET" && url.pathname.startsWith("/rpc/providers/")) {
      const contentCid = decodeURIComponent(url.pathname.replace("/rpc/providers/", ""));
      const state = await loadState(context.dataDir);
      return respondJson(response, 200, { contentCid, providers: dedupeProviders(state.providers[contentCid] ?? []) });
    }
    if (request.method === "GET" && url.pathname.startsWith("/rpc/content/") && url.pathname.endsWith("/manifest")) {
      const contentCid = decodeURIComponent(url.pathname.split("/")[3]);
      const state = await loadState(context.dataDir);
      const metadata = state.content[contentCid];
      if (!metadata) {
        return respondJson(response, 404, { code: "CONTENT_NOT_FOUND" });
      }
      return respondJson(response, 200, metadata);
    }
    if (request.method === "GET" && url.pathname.includes("/rpc/content/") && url.pathname.includes("/chunks/")) {
      const [, , , rawContentCid, , rawIndex] = url.pathname.split("/");
      const contentCid = decodeURIComponent(rawContentCid);
      const chunkIndex = Number(rawIndex);
      const state = await loadState(context.dataDir);
      const metadata = state.content[contentCid];
      if (!metadata) {
        return respondJson(response, 404, { code: "CONTENT_NOT_FOUND" });
      }
      const chunk = metadata.chunks.find((entry) => entry.chunkIndex === chunkIndex);
      if (!chunk) {
        return respondJson(response, 404, { code: "CHUNK_NOT_FOUND" });
      }
      const bytes = await readFile(chunk.localPath);
      return respondJson(response, 200, {
        contentCid,
        chunkIndex,
        chunkHash: chunk.chunkHash,
        chunkSize: chunk.chunkSize,
        bytesBase64: Buffer.from(bytes).toString("base64")
      });
    }
    respondJson(response, 404, { code: "NOT_FOUND" });
  } catch (error) {
    respondJson(response, 500, { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) });
  }
}

async function startMdns(context) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", async (message) => {
    try {
      const payload = JSON.parse(message.toString("utf8"));
      if (payload.peerId === context.node.peerId) {
        return;
      }
      if (payload.type !== "announce") {
        return;
      }
      await addOrUpdatePeer(context.dataDir, {
        peerId: payload.peerId,
        multiaddr: payload.multiaddr,
        lastSeenAt: new Date().toISOString(),
        source: "mdns"
      });
    } catch {
      // ignore malformed datagrams
    }
  });
  await new Promise((resolvePromise) => socket.bind(context.mdnsPort, resolvePromise));
  socket.addMembership(context.mdnsGroup);
  return socket;
}

async function announcePresence(context) {
  const socket = dgram.createSocket("udp4");
  const payload = Buffer.from(JSON.stringify({
    type: "announce",
    peerId: context.node.peerId,
    multiaddr: context.multiaddr
  }));
  await new Promise((resolvePromise, rejectPromise) => {
    socket.send(payload, context.mdnsPort, context.mdnsGroup, (error) => {
      socket.close();
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(undefined);
    });
  });
}

async function bootstrapPeer(context, target) {
  const result = await rpcJson(target, "/rpc/ping", {
    method: "POST",
    body: {
      fromPeerId: context.node.peerId,
      multiaddr: context.multiaddr
    }
  });
  await addOrUpdatePeer(context.dataDir, {
    peerId: String(result.peerId),
    multiaddr: String(result.multiaddr),
    lastSeenAt: new Date().toISOString(),
    source: "bootstrap"
  });
}

async function resolveRecord(context, address) {
  const state = await loadState(context.dataDir);
  if (state.records[address]) {
    return state.records[address];
  }
  for (const peer of state.peers.slice(0, context.maxPeers)) {
    try {
      const result = await rpcJson(peer.multiaddr, `/rpc/records/${encodeURIComponent(address)}`);
      state.records[address] = mergeRecord(state.records[address], result.record);
      mergeSearchEntry(state.searchIndex, result.record.searchEntry);
      await saveState(context.dataDir, state);
      return state.records[address];
    } catch {
      // try next peer
    }
  }
  throw new Error(`RECORD_NOT_FOUND ${address}`);
}

async function fetchContentFromProviders(context, release, providersForContent) {
  const targetDir = join(context.dataDir, "content", sanitizeSegment(release.contentCid));
  const packagePath = join(targetDir, "package.vsite");
  if (existsSync(packagePath)) {
    return { packagePath };
  }

  await mkdir(join(targetDir, "chunks"), { recursive: true });
  const buffers = [];
  for (const chunk of release.chunks) {
    let downloaded = false;
    for (const provider of providersForContent) {
      try {
        const result = await rpcJson(provider.multiaddr, `/rpc/content/${encodeURIComponent(release.contentCid)}/chunks/${chunk.chunkIndex}`);
        const bytes = Buffer.from(String(result.bytesBase64), "base64");
        const actualHash = `blake3:${await blake3(bytes)}`;
        if (actualHash !== chunk.chunkHash) {
          throw new Error(`CHUNK_HASH_MISMATCH ${chunk.chunkIndex}`);
        }
        const localPath = join(targetDir, "chunks", `${chunk.chunkIndex}.chunk`);
        await writeFile(localPath, bytes);
        buffers.push(bytes);
        downloaded = true;
        break;
      } catch {
        // try next provider
      }
    }
    if (!downloaded) {
      throw new Error(`CHUNK_DOWNLOAD_FAILED ${chunk.chunkIndex}`);
    }
  }

  const packageBytes = Buffer.concat(buffers);
  const actualPackageHash = `blake3:${await blake3(packageBytes)}`;
  if (actualPackageHash !== release.packageHash) {
    throw new Error(`PACKAGE_HASH_MISMATCH ${release.contentCid}`);
  }
  await writeFile(packagePath, packageBytes);
  const state = await loadState(context.dataDir);
  state.content[release.contentCid] = {
    contentCid: release.contentCid,
    packageHash: release.packageHash,
    manifestHash: release.manifestHash,
    packagePath,
    manifest: release.manifest,
    entryFile: release.entryFile,
    totalSize: release.totalSize,
    fileCount: release.fileCount,
    chunks: release.chunks.map((chunk) => ({
      ...chunk,
      localPath: join(targetDir, "chunks", `${chunk.chunkIndex}.chunk`)
    }))
  };
  state.providers[release.contentCid] = dedupeProviders([
    ...(state.providers[release.contentCid] ?? []),
    {
      peerId: context.node.peerId,
      multiaddr: context.multiaddr,
      lastSeenAt: new Date().toISOString(),
      source: "cache"
    }
  ]);
  await saveState(context.dataDir, state);
  return { packagePath };
}

async function registerReleaseRecord(context, release) {
  const state = await loadState(context.dataDir);
  const existing = state.records[release.address];
  const releases = { ...(existing?.releases ?? {}), [release.version]: release };
  const searchEntry = buildSearchEntry(release);
  const record = {
    address: release.address,
    activeVersion: release.version,
    activeContentCid: release.contentCid,
    updatedAt: new Date().toISOString(),
    releases,
    providers: {
      ...(existing?.providers ?? {}),
      [release.contentCid]: dedupeProviders([
        ...((existing?.providers ?? {})[release.contentCid] ?? []),
        {
          peerId: context.node.peerId,
          multiaddr: context.multiaddr,
          lastSeenAt: new Date().toISOString(),
          source: "publish"
        }
      ])
    },
    searchEntry
  };
  state.records[release.address] = record;
  state.providers[release.contentCid] = record.providers[release.contentCid];
  mergeSearchEntry(state.searchIndex, searchEntry);
  await saveState(context.dataDir, state);
  return record;
}

async function announceRecord(context, record) {
  const state = await loadState(context.dataDir);
  await Promise.all(state.peers.slice(0, context.maxPeers).map(async (peer) => {
    try {
      await rpcJson(peer.multiaddr, "/rpc/records/announce", {
        method: "POST",
        body: { record }
      });
    } catch {
      // ignore
    }
  }));
}

async function announceProviders(context, contentCid) {
  const state = await loadState(context.dataDir);
  const providersForContent = dedupeProviders(state.providers[contentCid] ?? []);
  await Promise.all(state.peers.slice(0, context.maxPeers).map(async (peer) => {
    try {
      await rpcJson(peer.multiaddr, "/rpc/providers/announce", {
        method: "POST",
        body: {
          contentCid,
          providers: providersForContent
        }
      });
    } catch {
      // ignore
    }
  }));
}

async function storePackagedContent(context, input) {
  const targetDir = join(context.dataDir, "content", sanitizeSegment(input.contentCid));
  await mkdir(join(targetDir, "chunks"), { recursive: true });
  const packagePath = join(targetDir, "package.vsite");
  await writeFile(packagePath, input.packageBytes);
  const chunks = [];
  for (let offset = 0, chunkIndex = 0; offset < input.packageBytes.length; offset += defaultChunkSize, chunkIndex += 1) {
    const bytes = input.packageBytes.slice(offset, offset + defaultChunkSize);
    const chunkHash = `blake3:${await blake3(bytes)}`;
    const localPath = join(targetDir, "chunks", `${chunkIndex}.chunk`);
    await writeFile(localPath, bytes);
    chunks.push({
      chunkIndex,
      chunkHash,
      chunkSize: bytes.byteLength,
      localPath
    });
  }
  const state = await loadState(context.dataDir);
  state.content[input.contentCid] = {
    contentCid: input.contentCid,
    packageHash: input.packageHash,
    manifestHash: input.manifestHash,
    packagePath,
    manifest: input.manifest,
    entryFile: input.manifest.entryFile,
    totalSize: input.files.reduce((sum, file) => sum + file.size, 0),
    fileCount: input.files.length,
    chunks
  };
  await saveState(context.dataDir, state);
  return { packagePath, chunks };
}

function buildSearchEntry(release) {
  return {
    address: release.address,
    category: release.manifest.category,
    slug: String(release.address.split(".")[1] ?? ""),
    title: release.manifest.title,
    description: release.manifest.description,
    keywords: release.manifest.keywords,
    publisher: release.publisherPublicKey,
    language: release.manifest.languages[0] ?? "und",
    ageRating: release.manifest.ageRating,
    familySafe: release.manifest.familySafe,
    contentCid: release.contentCid,
    releaseVersion: release.version,
    updatedAt: new Date().toISOString(),
    availability: 1
  };
}

async function ensureState(dataDir) {
  const statePath = join(dataDir, "state.json");
  if (!existsSync(statePath)) {
    await saveState(dataDir, {
      peers: [],
      records: {},
      providers: {},
      content: {},
      searchIndex: []
    });
  }
}

async function loadState(dataDir) {
  await ensureState(dataDir);
  await stateWriteQueue.catch(() => undefined);
  const statePath = join(dataDir, "state.json");
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
  throw lastError;
}

async function saveState(dataDir, state) {
  await mkdir(dataDir, { recursive: true });
  const statePath = join(dataDir, "state.json");
  stateWriteQueue = stateWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await writeFile(statePath, JSON.stringify(state, null, 2));
    });
  await stateWriteQueue;
}

async function loadOrCreateNodeIdentity(dataDir) {
  const nodePath = join(dataDir, "node.json");
  if (existsSync(nodePath)) {
    return JSON.parse(await readFile(nodePath, "utf8"));
  }
  const keys = generateRawEd25519KeyPair();
  const peerId = `velora-${(await blake3(Buffer.from(keys.publicKeyBase64, "base64"))).slice(0, 24)}`;
  const node = {
    peerId,
    publicKey: keys.publicKeyBase64,
    privateKey: keys.privateKeyBase64,
    createdAt: new Date().toISOString()
  };
  await writeFile(nodePath, JSON.stringify(node, null, 2));
  return node;
}

async function addOrUpdatePeer(dataDir, peer) {
  const state = await loadState(dataDir);
  const peers = dedupeProviders([...(state.peers ?? []), peer]).slice(0, defaultMaxPeers);
  state.peers = peers;
  await saveState(dataDir, state);
}

function mergeSearchEntry(searchIndex, searchEntry) {
  const next = searchIndex.filter((entry) => entry.address !== searchEntry.address);
  next.push(searchEntry);
  searchIndex.splice(0, searchIndex.length, ...next);
}

function mergeRecord(previous, next) {
  if (!previous) {
    return next;
  }
  return {
    ...previous,
    ...next,
    releases: { ...previous.releases, ...next.releases },
    providers: mergeProviders(previous.providers, next.providers)
  };
}

function mergeProviders(left, right) {
  const merged = { ...left };
  for (const [contentCid, providersForContent] of Object.entries(right ?? {})) {
    merged[contentCid] = dedupeProviders([...(merged[contentCid] ?? []), ...providersForContent]);
  }
  return merged;
}

function dedupeProviders(providers) {
  const map = new Map();
  for (const provider of providers ?? []) {
    if (!provider?.peerId || !provider?.multiaddr) {
      continue;
    }
    map.set(provider.peerId, provider);
  }
  return [...map.values()];
}

function providerCount(providersByCid, contentCid) {
  return dedupeProviders(providersByCid[contentCid] ?? []).length;
}

async function rpcJson(target, path, options = {}) {
  const url = toHttpUrl(target, path);
  const request = {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" }
  };
  if (options.body) {
    request.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, { ...request, signal: AbortSignal.timeout(defaultRequestTimeoutMs) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.code === "string" ? payload.code : `HTTP_${response.status}`);
  }
  return payload;
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function toHttpUrl(target, path = "") {
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return `${target.replace(/\/+$/, "")}${path}`;
  }
  const match = target.match(/^\/ip4\/([^/]+)\/tcp\/(\d+)\/http(?:\/p2p\/[^/]+)?$/);
  if (!match) {
    throw new Error(`INVALID_MULTIADDR ${target}`);
  }
  return `http://${match[1]}:${match[2]}${path}`;
}

function formatMultiaddr(hostname, port, peerId) {
  return `/ip4/${hostname}/tcp/${port}/http/p2p/${peerId}`;
}

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function signPayload(privateKeyBase64, payload) {
  const signature = nacl.sign.detached(Buffer.from(payload), Buffer.from(privateKeyBase64, "base64"));
  return Buffer.from(signature).toString("base64");
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

async function logEvent(context, message) {
  const logPath = join(context.dataDir, "network.log");
  const previous = existsSync(logPath) ? await readFile(logPath, "utf8") : "";
  await writeFile(logPath, `${previous}[${new Date().toISOString()}] ${message}\n`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[rawKey] = true;
      continue;
    }
    parsed[rawKey] = next;
    index += 1;
  }
  return parsed;
}

function resolveRequired(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}
