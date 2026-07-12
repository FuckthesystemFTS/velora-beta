import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import type { FastifyInstance, FastifyReply } from "fastify";
import { navigationCategories, signedAdminCommandSchema, zoneCheckSchema, zoneRequestSchema } from "@velora/shared";
import { validateVeloraSite } from "@velora/shared/velora-site-node";
import { config } from "./config.js";
import { buildLocalRelease, persistReleaseEvent, persistReleaseSnapshot } from "./content-store.js";
import { hashPassword, hashValue, verifySignedCommand } from "./crypto.js";
import { requirePool } from "./db.js";
import { repository } from "./repository.js";
import { betaLogicalNodeCluster } from "./beta-logical-node-cluster.js";

const betaDownloadRoots = [
  resolve("releases/beta/windows"),
  resolve("../releases/beta/windows"),
  resolve("../../releases/beta/windows")
];
const macosDownloadRoots = [
  resolve("releases/beta/macos"),
  resolve("../releases/beta/macos"),
  resolve("../../releases/beta/macos")
];
const nasFallbackRoots = [
  resolve("releases/nas-fallback-agent"),
  resolve("../releases/nas-fallback-agent"),
  resolve("../../releases/nas-fallback-agent")
];
const publisherGuideCandidates = [
  resolve("VELORA_GUIDA_PUBBLICAZIONE.html"),
  resolve("../VELORA_GUIDA_PUBBLICAZIONE.html"),
  resolve("../../VELORA_GUIDA_PUBBLICAZIONE.html")
];
const betaInstallerName = "Velora_0.1.0_x64_en-US.msi";
const betaChecksumName = `${betaInstallerName}.sha256.txt`;
const macosAarch64Name = "Velora_0.1.0_aarch64.dmg";
const macosAarch64ChecksumName = `${macosAarch64Name}.sha256.txt`;
const nasFallbackName = "velora-nas-fallback-agent-0.1.0-beta.zip";

export async function registerRoutes(app: FastifyInstance) {
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("home")));
  app.get("/download", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("download")));
  app.get("/what-is-velora", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("what-is-velora")));
  app.get("/security", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("security")));
  app.get("/publishers", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("publishers")));
  app.get("/publishers/guide", async (_request, reply) => {
    for (const guide of publisherGuideCandidates) {
      try {
        return reply.type("text/html; charset=utf-8").send(await readFile(guide, "utf8"));
      } catch {
        continue;
      }
    }
    return reply.notFound("publisher guide not found");
  });
  app.get("/developers", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("developers")));
  app.get("/pricing", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("pricing")));
  app.get("/faq", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("faq")));
  app.get("/status", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("status")));
  app.get("/legal/privacy", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("privacy")));
  app.get("/legal/terms", async (_request, reply) => reply.type("text/html; charset=utf-8").send(publicPage("terms")));
  app.get("/health", async () => {
    if (!config.betaNodeClusterEnabled) {
      return { ok: true, service: "velora-api", network: "cluster disattivato" };
    }
    return betaLogicalNodeCluster.publicStatus();
  });
  app.get("/api/network/status", async () => betaLogicalNodeCluster.publicStatus());
  app.get("/api/network/nodes/summary", async () => {
    const status = await betaLogicalNodeCluster.status();
    return {
      enabled: status.enabled,
      network: status.operationalStatus,
      sleepRisk: status.sleepRisk,
      quorum: status.quorum,
      nodes: status.nodes.map((node) => ({ id: node.id, name: node.name, role: node.role, status: node.status, lastHeartbeatAt: node.lastHeartbeatAt }))
    };
  });
  app.get("/release-manifest.json", async (_request, reply) => {
    const candidates = [resolve("releases/beta/release-manifest.json"), resolve("../releases/beta/release-manifest.json"), resolve("../../releases/beta/release-manifest.json")];
    for (const manifest of candidates) {
      try {
        return reply.type("application/json; charset=utf-8").send(await readFile(manifest, "utf8"));
      } catch {
        continue;
      }
    }
    return reply.notFound("release manifest not found");
  });
  app.get(`/downloads/windows/${betaInstallerName}`, async (_request, reply) => sendBetaDownload(betaInstallerName, reply));
  app.get(`/downloads/windows/${betaChecksumName}`, async (_request, reply) => sendBetaDownload(betaChecksumName, reply));
  app.get(`/downloads/macos/${macosAarch64Name}`, async (_request, reply) => sendMacosDownload(macosAarch64Name, reply));
  app.get(`/downloads/macos/${macosAarch64ChecksumName}`, async (_request, reply) => sendMacosDownload(macosAarch64ChecksumName, reply));
  app.get(`/downloads/nas/${nasFallbackName}`, async (_request, reply) => sendNasFallbackDownload(nasFallbackName, reply));
  app.get("/downloads/windows/:file", async (request, reply) => {
    const file = routeParam(request.params, "file");
    if (![betaInstallerName, betaChecksumName].includes(file)) {
      return reply.notFound("download not found");
    }

    const download = await findBetaDownload(file);
    if (!download) {
      return reply.notFound("download not found");
    }

    reply.header("Content-Length", String(download.info.size));
    reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
    reply.type(file.endsWith(".msi") ? "application/octet-stream" : "text/plain; charset=utf-8");
    return reply.send(createReadStream(download.path));
  });
  app.get("/downloads/macos/:file", async (request, reply) => {
    const file = routeParam(request.params, "file");
    if (![macosAarch64Name, macosAarch64ChecksumName].includes(file)) {
      return reply.notFound("download not found");
    }

    const download = await findMacosDownload(file);
    if (!download) {
      return reply.notFound("download not found");
    }

    reply.header("Content-Length", String(download.info.size));
    reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
    reply.type(file.endsWith(".dmg") ? "application/octet-stream" : "text/plain; charset=utf-8");
    return reply.send(createReadStream(download.path));
  });
  app.get("/downloads/nas/:file", async (request, reply) => {
    const file = routeParam(request.params, "file");
    if (file !== nasFallbackName) {
      return reply.notFound("download not found");
    }

    return sendNasFallbackDownload(file, reply);
  });

  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    if (!body?.username || !body?.password) {
      return reply.badRequest("username and password are required");
    }

    if (await repository.findUserByUsername(body.username)) {
      return reply.conflict("username already exists");
    }

    const user = await repository.createUser(body.username, hashPassword(body.password));
    const mail = await repository.getOrCreateVeloMailAccount(user.id, user.username);
    const session = await repository.createAuthSession(user.id);
    return {
      token: session.token,
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username, identityLevel: mail.identityLevel },
      mail
    };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    const user = body?.username ? await repository.findUserByUsername(body.username) : undefined;
    if (!user || user.password !== hashPassword(body?.password ?? "")) {
      return reply.unauthorized("invalid credentials");
    }

    const mail = await repository.getOrCreateVeloMailAccount(user.id, user.username);
    const session = await repository.createAuthSession(user.id);
    return {
      token: session.token,
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username, identityLevel: mail.identityLevel },
      mail
    };
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    if (!body?.refreshToken) {
      return reply.badRequest("refreshToken is required");
    }
    try {
      const session = await repository.refreshAuthSession(body.refreshToken);
      return { token: session.token, accessToken: session.token, refreshToken: session.refreshToken, expiresAt: session.expiresAt };
    } catch {
      return reply.unauthorized("invalid refresh token");
    }
  });

  app.post("/api/v1/beta/session", async (request) => {
    const body = request.body as { installationId?: string };
    const suffix = String(body?.installationId ?? "desktop").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32) || "desktop";
    const username = `beta-${suffix}`;
    const existing = await repository.findUserByUsername(username);
    const user = existing ?? await repository.createUser(username, hashPassword(`velora-beta:${suffix}`));
    const mail = await repository.getOrCreateVeloMailAccount(user.id, username);
    return {
      token: (await repository.createAuthSession(user.id)).token,
      user: { id: user.id, username: user.username },
      mail
    };
  });

  app.get("/api/v1/mail/account", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return repository.getOrCreateVeloMailAccount(userId);
  });

  app.get("/api/v1/mail/inbox", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return { messages: await repository.listVeloMailMessages(userId, "INBOX") };
  });

  app.get("/api/v1/mail/folders/:folder", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return { messages: await repository.listVeloMailMessages(userId, routeParam(request.params, "folder")) };
  });

  app.get("/api/v1/mail/messages/:id", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const message = await repository.getVeloMailMessage(userId, routeParam(request.params, "id"));
    if (!message) {
      return reply.notFound("message not found");
    }
    return message;
  });

  app.post("/api/v1/mail/send", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { to?: string[]; subject?: string; body?: string; subjectCiphertext?: string; bodyCiphertext?: string; encryptedByClient?: boolean };
    if (!Array.isArray(body?.to) || !body.subject || !body.bodyCiphertext || body.encryptedByClient !== true) {
      return reply.badRequest("to, subject, bodyCiphertext and encryptedByClient=true are required");
    }
    return repository.sendVeloMail({
      userId,
      to: body.to,
      subject: body.subject,
      body: body.body ?? "",
      subjectCiphertext: body.subjectCiphertext,
      bodyCiphertext: body.bodyCiphertext,
      encryptedByClient: body.encryptedByClient
    });
  });

  app.post("/api/v1/mail/drafts", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { to?: string[]; subject?: string; body?: string; subjectCiphertext?: string; bodyCiphertext?: string; encryptedByClient?: boolean };
    if (!Array.isArray(body?.to) || !body.subject || !body.bodyCiphertext || body.encryptedByClient !== true) {
      return reply.badRequest("to, subject, bodyCiphertext and encryptedByClient=true are required");
    }
    return repository.sendVeloMail({ userId, to: body.to, subject: body.subject, body: body.body ?? "", subjectCiphertext: body.subjectCiphertext, bodyCiphertext: body.bodyCiphertext, encryptedByClient: body.encryptedByClient, draft: true });
  });

  for (const [path, action] of [
    ["read", "read"],
    ["unread", "unread"],
    ["archive", "archive"],
    ["delete", "delete"],
    ["star", "star"],
    ["unstar", "unstar"]
  ] as const) {
    app.post(`/api/v1/mail/messages/:id/${path}`, async (request, reply) => {
      const userId = await requireSessionUserId(request, reply);
      if (!userId) {
        return;
      }
      return repository.updateVeloMailMessage(userId, routeParam(request.params, "id"), action);
    });
  }

  app.post("/api/v1/mail/block-sender", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { senderAddress?: string };
    if (!body?.senderAddress) {
      return reply.badRequest("senderAddress is required");
    }
    return repository.blockVeloMailSender(userId, body.senderAddress);
  });

  app.post("/api/v1/mail/messages/:id/report-spam", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { reason?: string };
    return repository.reportVeloMailSpam(userId, routeParam(request.params, "id"), body?.reason ?? "USER_REPORT");
  });

  app.get("/api/v1/mail/search", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const query = typeof (request.query as { q?: unknown }).q === "string" ? (request.query as { q: string }).q : "";
    return { messages: query ? await repository.searchVeloMail(userId, query) : [] };
  });

  app.get("/api/v1/mail/sync-status", async () => ({
    available: true,
    status: "READY",
    transport: "VELOMAIL_STORE_AND_FORWARD_BETA",
    replication: {
      targetFactor: Number(process.env.VELOMAIL_TARGET_REPLICATION_FACTOR ?? 3),
      minimumFactor: Number(process.env.VELOMAIL_MIN_REPLICATION_FACTOR ?? 2),
      p2pLayer: "PARTIAL"
    }
  }));
  app.post("/api/v1/auth/logout", async (request) => repository.revokeAuthSession(readBearerToken(request) ?? ""));
  app.post("/api/v1/auth/recovery", async () => ({ ok: true, delivery: "internal-notification" }));

  app.get("/api/v1/account", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const user = await repository.findUserById(userId);
    if (!user) {
      return reply.notFound("account not found");
    }
    const mail = await repository.getOrCreateVeloMailAccount(user.id, user.username);
    return { id: user.id, username: user.username, identityLevel: mail.identityLevel, mail };
  });

  app.post("/api/v1/identity/verify-basic", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return repository.setIdentityLevel(userId, 1);
  });

  app.post("/api/v1/devices/enroll", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { peerId?: string; publicKey?: string; deviceName?: string };
    if (!body.peerId || !body.publicKey) {
      return reply.badRequest("peerId and publicKey are required");
    }
    try {
      return await repository.enrollDevice({ userId, peerId: body.peerId, publicKey: body.publicKey, deviceName: body.deviceName });
    } catch (error) {
      request.log.error(error);
      if (error instanceof Error && error.message === "DEVICE_ACCOUNT_LIMIT_REACHED") {
        return reply.code(409).send({
          code: "DEVICE_ACCOUNT_LIMIT_REACHED",
          message: "Hai gia associato tre account a questo dispositivo. Utilizza uno degli account esistenti oppure rimuovine uno dalle impostazioni."
        });
      }
      return reply.failedDependency("membership signing key is not configured");
    }
  });

  app.post("/api/v1/devices/renew-certificate", async () => ({ ok: true, status: "RENEWAL_PENDING" }));
  app.delete("/api/v1/devices/:id", async () => ({ ok: true, status: "REVOKE_REQUESTED" }));

  app.get("/api/v1/network/bootstrap", async () => ({ peers: [], protocolPrefix: "/velora" }));
  app.get("/api/v1/network/revocations", async () => ({ revocations: [] }));
  app.get("/api/v1/network/categories", async () => ({
    version: 1,
    categories: navigationCategories.map((code) => ({
      code,
      enabled: code !== "adult",
      familySafeDefault: code !== "adult"
    }))
  }));

  app.post("/api/v1/zones/check", async (request) => {
    const body = zoneCheckSchema.parse(request.body);
    const status = await repository.checkZone(body);
    const address = `${body.category}.${body.slug}`;

    const message = {
      AVAILABLE: `La zona ${address} risulta disponibile. Puoi inviare la richiesta di assegnazione.`,
      ASSIGNED: `La zona ${address} Ã¨ giÃ  stata assegnata. Prova un nome differente.`,
      PENDING_REVIEW: "Ãˆ giÃ  presente una richiesta per questa zona. Puoi scegliere unâ€™altra zona oppure ricevere un avviso se tornerÃ  disponibile.",
      RESERVED_NAME: "Questo nome non puÃ² essere richiesto direttamente.",
      TEMPORARILY_RESERVED: `La zona ${address} Ã¨ temporaneamente riservata.`,
      BLOCKED: `La zona ${address} Ã¨ attualmente bloccata.`,
      INVALID: "La zona inserita non Ã¨ valida."
    }[status];

    return { address, status, message };
  });

  app.post("/api/v1/zones/requests", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }

    const body = zoneRequestSchema.parse(request.body);
    const status = await repository.checkZone({ category: body.category, slug: body.requestedSlug });
    if (status !== "AVAILABLE") {
      return reply.code(409).send({ status });
    }

    const zoneRequest = await repository.createZoneRequest(body, userId, config.zoneReservationHours);
    return {
      ...zoneRequest,
      targetReviewMessage:
        "La richiesta sarÃ  verificata appena possibile. In condizioni normali lâ€™assegnazione puÃ² essere eseguita subito; in presenza di piÃ¹ richieste, la verifica puÃ² richiedere fino a 24 ore.",
      disclaimer:
        "Lâ€™invio della richiesta non garantisce lâ€™assegnazione. Velora puÃ² richiedere ulteriori informazioni, proporre un nome alternativo o rifiutare richieste non conformi alle regole della rete."
    };
  });

  app.get("/api/v1/zones/requests/:id", async (request) => ({ id: routeParam(request.params, "id"), status: "PENDING_REVIEW" }));
  app.patch("/api/v1/zones/requests/:id", async () => ({ ok: true }));
  app.post("/api/v1/zones/requests/:id/cancel", async () => ({ ok: true, status: "CANCELLED" }));
  app.get("/api/v1/zones/:address", async (request) => ({ address: routeParam(request.params, "address"), status: "LOOKUP_REQUIRED" }));
  app.get("/api/v1/account/zones", async () => ({ zones: [] }));
  app.post("/api/v1/sites/validate-release", async (request, reply) => {
    const body = request.body as { sitePath?: string };
    if (!body.sitePath) {
      return reply.badRequest("sitePath is required");
    }
    return validateVeloraSite(body.sitePath, {
      maxSiteSizeMb: Number(process.env.MAX_SITE_SIZE_MB ?? 250),
      maxSiteFileCount: Number(process.env.MAX_SITE_FILE_COUNT ?? 5000)
    });
  });

  app.post("/api/v1/sites/package-release", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { sitePath?: string; publisherPublicKey?: string };
    if (!body.sitePath || !body.publisherPublicKey) {
      return reply.badRequest("sitePath and publisherPublicKey are required");
    }
    return buildLocalRelease(body.sitePath, body.publisherPublicKey);
  });

  app.post("/api/v1/sites/register-release", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    try {
      const body = request.body as {
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
        chunks?: Array<{ chunkIndex: number; chunkHash: string; chunkSize: number; localPath: string }>;
        packagePath?: string;
      };
      await repository.ensureBetaPublisherZone({ address: body.address, userId, publisherPublicKey: body.publisherPublicKey });
      const result = await repository.registerSiteRelease({ ...body, userId });
      if (config.betaNodeClusterEnabled) {
        const replication = await betaLogicalNodeCluster.storePublishedObject({
          cid: body.contentCid,
          address: body.address,
          releaseId: String(result.releaseId ?? ""),
          version: body.version,
          manifestHash: body.manifestHash,
          packageHash: body.packageHash
        });
        if (replication.quorum < config.betaNodeQuorum) {
          return reply.code(503).send({ code: "BETA_NODE_QUORUM_NOT_REACHED", replication });
        }
        Object.assign(result, { betaNodeReplication: replication });
      }
      await persistReleaseSnapshot({
        address: body.address,
        version: body.version,
        status: String(result.status ?? "ACTIVE"),
        payload: { ...body, ...result }
      });
      await persistReleaseEvent({
        address: body.address,
        releaseId: String(result.releaseId ?? ""),
        eventType: "RELEASE_ACTIVATED",
        payload: { version: body.version, contentCid: body.contentCid }
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "REGISTER_RELEASE_FAILED";
      if (["ZONE_NOT_OWNED", "ZONE_NOT_ACTIVE", "ZONE_SUSPENDED", "PUBLISHER_KEY_NOT_AUTHORIZED", "RELEASE_VERSION_CONFLICT"].includes(message)) {
        return reply.code(409).send({ code: message });
      }
      throw error;
    }
  });

  app.post("/api/v1/sites/publish", async () => ({ status: "USE_VALIDATE_AND_REGISTER_RELEASE" }));
  app.get("/api/v1/sites/:address/releases", async (request) => ({ releases: await repository.listSiteReleases(routeParam(request.params, "address")) }));
  app.get("/api/v1/sites/:address/releases/:id", async (request, reply) => {
    const release = await repository.getSiteRelease(routeParam(request.params, "address"), routeParam(request.params, "id"));
    if (!release) {
      return reply.notFound("release not found");
    }
    return release;
  });
  app.post("/api/v1/sites/:address/releases/:id/complete", async (request, reply) => {
    try {
      const result = await repository.completeSiteRelease(routeParam(request.params, "address"), routeParam(request.params, "id"));
      await persistReleaseSnapshot({
        address: String(result.address),
        version: String(result.version),
        status: String(result.status),
        payload: result
      });
      await persistReleaseEvent({
        address: String(result.address),
        releaseId: String(result.releaseId ?? ""),
        eventType: "RELEASE_COMPLETED",
        payload: result
      });
      return result;
    } catch (error) {
      return reply.code(404).send({ code: error instanceof Error ? error.message : "RELEASE_NOT_FOUND" });
    }
  });
  app.post("/api/v1/sites/:address/releases/:id/fail", async (request, reply) => {
    const body = request.body as { reason?: string };
    try {
      const result = await repository.failSiteRelease(routeParam(request.params, "address"), routeParam(request.params, "id"), body.reason ?? "Release failed");
      await persistReleaseSnapshot({
        address: String(result.address),
        version: String(result.version),
        status: String(result.status),
        payload: result
      });
      await persistReleaseEvent({
        address: String(result.address),
        releaseId: String(result.releaseId ?? ""),
        eventType: "RELEASE_FAILED",
        payload: result
      });
      return result;
    } catch (error) {
      return reply.code(404).send({ code: error instanceof Error ? error.message : "RELEASE_NOT_FOUND" });
    }
  });
  app.post("/api/v1/sites/:address/releases/:id/activate", async (request, reply) => {
    const body = request.body as { reason?: string };
    try {
      const result = await repository.activateSiteRelease(
        routeParam(request.params, "address"),
        routeParam(request.params, "id"),
        body.reason ?? "Manual activate"
      );
      await persistReleaseSnapshot({
        address: String(result.address),
        version: String(result.version),
        status: String(result.status),
        payload: result
      });
      await persistReleaseEvent({
        address: String(result.address),
        releaseId: String(result.releaseId ?? ""),
        eventType: "RELEASE_ACTIVATED",
        payload: result
      });
      return result;
    } catch (error) {
      return reply.code(404).send({ code: error instanceof Error ? error.message : "RELEASE_NOT_FOUND" });
    }
  });
  app.post("/api/v1/sites/:address/releases/:id/revoke", async (request, reply) => {
    const body = request.body as { reason?: string };
    try {
      const result = await repository.revokeSiteRelease(routeParam(request.params, "address"), routeParam(request.params, "id"), body.reason ?? "Manual revoke");
      await persistReleaseSnapshot({
        address: String(result.address),
        version: String(result.version),
        status: String(result.status),
        payload: result
      });
      await persistReleaseEvent({
        address: String(result.address),
        releaseId: String(result.releaseId ?? ""),
        eventType: "REVOKE",
        payload: result
      });
      return result;
    } catch (error) {
      return reply.code(404).send({ code: error instanceof Error ? error.message : "RELEASE_NOT_FOUND" });
    }
  });
  app.post("/api/v1/sites/:address/rollback", async (request, reply) => {
    const body = request.body as { version?: string; reason?: string };
    if (!body.version) {
      return reply.badRequest("version is required");
    }
    try {
      const result = await repository.rollbackSiteRelease(routeParam(request.params, "address"), body.version, body.reason ?? "Manual rollback");
      await persistReleaseSnapshot({
        address: String(result.address),
        version: String(result.version),
        status: String(result.status),
        payload: result
      });
      await persistReleaseEvent({
        address: String(result.address),
        releaseId: String(result.releaseId ?? ""),
        eventType: "ROLLBACK",
        payload: result
      });
      return result;
    } catch (error) {
      return reply.code(404).send({ code: error instanceof Error ? error.message : "RELEASE_NOT_FOUND" });
    }
  });
  app.get("/api/v1/content/:cid", async (request, reply) => {
    const object = await repository.getContentObject(routeParam(request.params, "cid"));
    if (!object) {
      return reply.notFound("content object not found");
    }
    const chunks = await repository.getContentChunks(routeParam(request.params, "cid"));
    const providers = await repository.getContentProviders(routeParam(request.params, "cid"));
    return { object, chunks, providers };
  });

  app.get("/api/v1/search", async (request, reply) => {
    const query = String((request.query as Record<string, string | undefined>).q ?? "").trim().toLowerCase();
    if (!query) {
      return reply.badRequest("q is required");
    }
    return { query, results: await repository.searchDocuments(query) };
  });
  app.get("/api/v1/releases/latest", async () => ({ version: "0.1.0-beta", channel: "beta" }));

  app.get("/api/v1/forum/sections", async (_request, reply) => {
    if (!config.forumEnabled) {
      return reply.notFound("forum disabled");
    }
    const pool = requirePool();
    const sections = await pool.query(
      `SELECT fs.id, fs.slug, fs.title, fs.description,
              COUNT(fp.user_id)::int AS online_count,
              MAX(fm.created_at) AS last_activity_at
       FROM forum_sections fs
       LEFT JOIN forum_presence fp ON fp.section_id = fs.id AND fp.last_seen_at > NOW() - ($1 || ' seconds')::interval
       LEFT JOIN forum_messages fm ON fm.section_id = fs.id AND fm.status = 'VISIBLE'
       WHERE fs.is_active = TRUE
       GROUP BY fs.id
       ORDER BY fs.sort_order ASC, fs.title ASC`,
      [config.forumPresenceSeconds]
    );
    return { sections: sections.rows.map(mapForumSection) };
  });

  app.get("/api/v1/forum/sections/:slug/messages", async (request, reply) => {
    if (!config.forumEnabled || !config.globalChatEnabled) {
      return reply.notFound("forum disabled");
    }
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const slug = routeParam(request.params, "slug");
    const section = await findForumSection(slug);
    if (!section) {
      return reply.notFound("forum section not found");
    }
    await touchForumPresence(userId, section.id, readBearerToken(request) ?? "");
    const before = String((request.query as { before?: string } | undefined)?.before ?? "");
    const params: unknown[] = [section.id];
    let beforeSql = "";
    if (before) {
      params.push(before);
      beforeSql = `AND fm.created_at < $${params.length}`;
    }
    const pool = requirePool();
    const messages = await pool.query(
      `SELECT fm.id, fm.body, fm.body_length, fm.created_at, u.username
       FROM forum_messages fm
       JOIN users u ON u.id = fm.user_id
       WHERE fm.section_id = $1 AND fm.status = 'VISIBLE' ${beforeSql}
       ORDER BY fm.created_at DESC
       LIMIT 50`,
      params
    );
    return { section: mapForumSection(section), messages: messages.rows.reverse().map(mapForumMessage) };
  });

  app.post("/api/v1/forum/sections/:slug/presence", async (request, reply) => {
    if (!config.forumEnabled || !config.globalChatEnabled) {
      return reply.notFound("forum disabled");
    }
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const section = await findForumSection(routeParam(request.params, "slug"));
    if (!section) {
      return reply.notFound("forum section not found");
    }
    await touchForumPresence(userId, section.id, readBearerToken(request) ?? "");
    return { ok: true };
  });

  app.post("/api/v1/forum/sections/:slug/messages", async (request, reply) => {
    if (!config.forumEnabled || !config.globalChatEnabled) {
      return reply.notFound("forum disabled");
    }
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const section = await findForumSection(routeParam(request.params, "slug"));
    if (!section) {
      return reply.notFound("forum section not found");
    }
    const body = String((request.body as { body?: string } | undefined)?.body ?? "").trim();
    if (!body) {
      return reply.badRequest("message body is required");
    }
    if (body.length > config.forumMessageMaxChars) {
      return reply.code(413).send({ code: "FORUM_MESSAGE_TOO_LONG", maxChars: config.forumMessageMaxChars });
    }
    const pool = requirePool();
    const recent = await pool.query(
      `SELECT body, created_at FROM forum_messages
       WHERE user_id = $1 AND section_id = $2 AND created_at > NOW() - ($3 || ' seconds')::interval
       ORDER BY created_at DESC LIMIT 1`,
      [userId, section.id, config.forumMessageMinSeconds]
    );
    if (recent.rows[0]) {
      return reply.code(429).send({ code: "FORUM_RATE_LIMIT", retryAfterSeconds: config.forumMessageMinSeconds });
    }
    const duplicate = await pool.query(
      `SELECT 1 FROM forum_messages
       WHERE user_id = $1 AND section_id = $2 AND body = $3 AND created_at > NOW() - INTERVAL '30 seconds'
       LIMIT 1`,
      [userId, section.id, body]
    );
    if (duplicate.rows[0]) {
      return reply.code(429).send({ code: "FORUM_DUPLICATE_MESSAGE" });
    }
    await touchForumPresence(userId, section.id, readBearerToken(request) ?? "");
    const result = await pool.query(
      `INSERT INTO forum_messages (id, section_id, user_id, body, body_length)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, body, body_length, created_at`,
      [randomUUID(), section.id, userId, body, body.length]
    );
    return { message: { ...mapForumMessage({ ...result.rows[0], username: (await repository.findUserById(userId))?.username ?? "utente" }) } };
  });

  app.post("/api/v1/control/session/challenge", async (request, reply) => {
    const body = request.body as { adminId?: string; deviceId?: string };
    if (!body.adminId || !body.deviceId) {
      return reply.badRequest("adminId and deviceId are required");
    }
    return repository.createAdminChallenge(body.adminId, body.deviceId);
  });

  app.post("/api/v1/control/session/verify", async (request, reply) => {
    const body = request.body as { challengeId?: string };
    if (!body.challengeId) {
      return reply.badRequest("challengeId is required");
    }
    const ok = await repository.verifyAndConsumeAdminChallenge(body.challengeId);
    if (!ok) {
      return reply.forbidden("invalid or expired challenge");
    }
    try {
      const session = await repository.createAdminSession(body.challengeId);
      return { adminSessionToken: session.adminSessionToken, expiresAt: session.expiresAt, expiresInMinutes: config.adminSessionMinutes };
    } catch {
      return reply.forbidden("admin account is not active");
    }
  });

  app.post("/api/v1/control/session/refresh", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    return { ok: true, adminId: admin.adminId, expiresInMinutes: config.adminSessionMinutes };
  });
  app.post("/api/v1/control/session/lock", async () => ({ ok: true }));

  app.get("/api/v1/control/dashboard", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return repository.dashboard();
  });
  app.get("/api/v1/control/zone-requests", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return repository.listZoneRequests();
  });

  app.get("/api/v1/contribution/profile", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return getContributionProfile(userId);
  });

  app.post("/api/v1/contribution/profile", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { mode?: string; resourceProfile?: string; veloraNodeEnabled?: boolean; hostingNodeEnabled?: boolean; miningPartnerEnabled?: boolean };
    const mode = normalizeChoice(body.mode, ["VELORA_ONLY", "VELORA_NODE", "HOSTING_NODE", "FULL_NODE"], "VELORA_ONLY");
    const resourceProfile = normalizeChoice(body.resourceProfile, ["MINIMUM", "STANDARD", "ADVANCED"], "MINIMUM");
    const pool = requirePool();
    const result = await pool.query(
      `INSERT INTO contribution_profiles (id, user_id, mode, velora_node_enabled, hosting_node_enabled, mining_partner_enabled, resource_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
        mode = EXCLUDED.mode,
        velora_node_enabled = EXCLUDED.velora_node_enabled,
        hosting_node_enabled = EXCLUDED.hosting_node_enabled,
        mining_partner_enabled = EXCLUDED.mining_partner_enabled,
        resource_profile = EXCLUDED.resource_profile,
        updated_at = NOW()
       RETURNING *`,
      [randomUUID(), userId, mode, body.veloraNodeEnabled === true, body.hostingNodeEnabled === true, body.miningPartnerEnabled === true, resourceProfile]
    );
    return mapContributionProfile(result.rows[0]);
  });

  app.post("/api/v1/contribution/consents", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { module?: string; enabled?: boolean; devicePeerId?: string; resourceProfile?: string; disclosure?: Record<string, unknown> };
    const module = normalizeChoice(body.module, ["VELORA_NODE", "HOSTING_NODE", "XMR_MINING", "ZEPH_MINING", "MINER_AUTOSTART", "MINER_UPDATES", "DIAGNOSTICS"], "");
    if (!module) {
      return reply.badRequest("valid module is required");
    }
    const disclosure = body.disclosure && typeof body.disclosure === "object" ? body.disclosure : {};
    const pool = requirePool();
    const result = await pool.query(
      `INSERT INTO node_module_consents (id, user_id, device_peer_id, module, consent_version, enabled, resource_profile, disclosure_json, revoked_at)
       VALUES ($1,$2,$3,$4,'velora-consent-v1',$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        userId,
        body.devicePeerId ?? null,
        module,
        body.enabled === true,
        normalizeChoice(body.resourceProfile, ["MINIMUM", "STANDARD", "ADVANCED", "ECO"], "MINIMUM"),
        JSON.stringify(disclosure),
        body.enabled === true ? null : new Date().toISOString()
      ]
    );
    return { consent: result.rows[0] };
  });

  app.post("/api/v1/contribution/nodes/enroll", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { module?: string; devicePeerId?: string; publicKey?: string; resourceProfile?: string };
    const module = normalizeChoice(body.module, ["VELORA_NODE", "HOSTING_NODE"], "");
    if (!module || !body.devicePeerId || !body.publicKey) {
      return reply.badRequest("module, devicePeerId and publicKey are required");
    }
    const certificate = {
      version: "velora-contributor-node-v1",
      userId,
      module,
      devicePeerId: body.devicePeerId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    };
    const pool = requirePool();
    const result = await pool.query(
      `INSERT INTO contributor_nodes (id, user_id, device_peer_id, module, public_key, status, resource_profile, certificate_json)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7)
       ON CONFLICT (device_peer_id, module) DO UPDATE SET
        public_key = EXCLUDED.public_key,
        status = 'ACTIVE',
        resource_profile = EXCLUDED.resource_profile,
        certificate_json = EXCLUDED.certificate_json,
        updated_at = NOW()
       RETURNING *`,
      [randomUUID(), userId, body.devicePeerId, module, body.publicKey, normalizeChoice(body.resourceProfile, ["MINIMUM", "STANDARD", "ADVANCED"], "MINIMUM"), JSON.stringify(certificate)]
    );
    return { node: mapContributorNode(result.rows[0]) };
  });

  app.post("/api/v1/contribution/nodes/:id/heartbeat", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { nonce?: string; uptimeSeconds?: number; resources?: Record<string, unknown>; health?: Record<string, unknown>; signature?: string };
    if (!body.nonce) {
      return reply.badRequest("nonce is required");
    }
    const pool = requirePool();
    const node = await pool.query("SELECT id FROM contributor_nodes WHERE id = $1 AND user_id = $2 AND status <> 'REVOKED'", [routeParam(request.params, "id"), userId]);
    if (!node.rows[0]) {
      return reply.notFound("node not found");
    }
    await pool.query(
      `INSERT INTO contributor_node_heartbeats (id, node_id, nonce, uptime_seconds, resources_json, health_json, signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (node_id, nonce) DO NOTHING`,
      [randomUUID(), node.rows[0].id, body.nonce, Math.max(0, Number(body.uptimeSeconds ?? 0)), JSON.stringify(body.resources ?? {}), JSON.stringify(body.health ?? {}), body.signature ?? null]
    );
    await pool.query("UPDATE contributor_nodes SET last_heartbeat_at = NOW(), updated_at = NOW() WHERE id = $1", [node.rows[0].id]);
    return { ok: true };
  });

  app.get("/api/v1/credits", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const pool = requirePool();
    const [ledger, requests] = await Promise.all([
      pool.query("SELECT * FROM hosting_credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100", [userId]),
      pool.query("SELECT * FROM credit_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100", [userId])
    ]);
    return { ledger: ledger.rows, requests: requests.rows };
  });

  app.post("/api/v1/credits/requests", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { amountCents?: number; requestedUse?: string };
    const amountCents = Math.max(0, Math.min(50000, Number(body.amountCents ?? 0)));
    if (!amountCents || !body.requestedUse) {
      return reply.badRequest("amountCents and requestedUse are required");
    }
    const result = await requirePool().query(
      `INSERT INTO credit_requests (id, user_id, amount_cents, requested_use)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [randomUUID(), userId, amountCents, String(body.requestedUse).slice(0, 500)]
    );
    return { request: result.rows[0] };
  });

  app.get("/api/v1/mining/status", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const miningConfig = buildMiningConfigSummary();
    const pool = requirePool();
    const result = await pool.query(
      `SELECT mw.*, md.device_peer_id
       FROM mining_workers mw
       JOIN mining_devices md ON md.id = mw.mining_device_id
       WHERE md.user_id = $1
       ORDER BY mw.created_at DESC`,
      [userId]
    );
    return {
      enabled: result.rows.some((row) => row.status === "ENABLED"),
      payoutsEnabled: miningConfig.payoutsEnabled,
      warning: miningConfig.payoutsEnabled ? undefined : "PAYOUT NON ANCORA ATTIVO",
      configuration: miningConfig.public,
      workers: result.rows.map(mapMiningWorker)
    };
  });

  app.post("/api/v1/mining/workers", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { coin?: string; devicePeerId?: string; publicKey?: string; userWallet?: string; payoutWallet?: string; enabled?: boolean };
    const coin = normalizeChoice(body.coin, ["XMR", "ZEPH"], "");
    const payoutWallet = String(body.payoutWallet ?? body.userWallet ?? "").trim();
    if (!coin || !body.devicePeerId || !body.publicKey || !payoutWallet) {
      return reply.badRequest("coin, devicePeerId, publicKey and payoutWallet are required");
    }
    const miningConfig = buildMiningCoinConfig(coin, userId, body.devicePeerId, payoutWallet);
    if (!miningConfig.valid) {
      return reply.failedDependency(miningConfig.error);
    }
    if (!isLikelyCoinAddress(coin, payoutWallet)) {
      return reply.badRequest("payoutWallet is not valid enough for beta registration");
    }
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const device = await client.query(
        `INSERT INTO mining_devices (id, user_id, device_peer_id, public_key, status)
         VALUES ($1,$2,$3,$4,'ACTIVE')
         ON CONFLICT (device_peer_id) DO UPDATE SET public_key = EXCLUDED.public_key, status = 'ACTIVE', updated_at = NOW()
         RETURNING id`,
        [randomUUID(), userId, body.devicePeerId, body.publicKey]
      );
      const consent = await client.query(
        `INSERT INTO node_module_consents (id, user_id, device_peer_id, module, consent_version, enabled, resource_profile, disclosure_json)
         VALUES ($1,$2,$3,$4,'velora-mining-partner-v1',$5,'ECO',$6)
         RETURNING id`,
        [randomUUID(), userId, body.devicePeerId, coin === "XMR" ? "XMR_MINING" : "ZEPH_MINING", body.enabled === true, JSON.stringify(defaultMiningDisclosure(coin))]
      );
      const worker = await client.query(
        `INSERT INTO mining_workers (
          id, mining_device_id, coin, user_wallet, velora_wallet, pool_url, status, consent_id,
          worker_id, pool_username, pool_worker_format, pool_worker_password, payout_wallet,
          payout_split_user_bps, payout_split_velora_bps, accounting_status, accounting_period, last_accounting_error
        )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (mining_device_id, coin) DO UPDATE SET
          user_wallet = EXCLUDED.user_wallet,
          velora_wallet = EXCLUDED.velora_wallet,
          pool_url = EXCLUDED.pool_url,
          status = EXCLUDED.status,
          consent_id = EXCLUDED.consent_id,
          worker_id = EXCLUDED.worker_id,
          pool_username = EXCLUDED.pool_username,
          pool_worker_format = EXCLUDED.pool_worker_format,
          pool_worker_password = EXCLUDED.pool_worker_password,
          payout_wallet = EXCLUDED.payout_wallet,
          payout_split_user_bps = EXCLUDED.payout_split_user_bps,
          payout_split_velora_bps = EXCLUDED.payout_split_velora_bps,
          accounting_status = EXCLUDED.accounting_status,
          accounting_period = EXCLUDED.accounting_period,
          last_accounting_error = EXCLUDED.last_accounting_error,
          updated_at = NOW()
         RETURNING *`,
        [
          randomUUID(),
          device.rows[0].id,
          coin,
          payoutWallet,
          miningConfig.poolUsername,
          miningConfig.poolUrl,
          miningConfig.workerStatus,
          consent.rows[0].id,
          miningConfig.workerId,
          miningConfig.poolUsername,
          miningConfig.workerFormat,
          miningConfig.workerPassword,
          payoutWallet,
          config.miningUserShareBps,
          config.miningVeloraShareBps,
          miningConfig.accountingStatus,
          miningConfig.accountingPeriod,
          miningConfig.accountingError
        ]
      );
      await client.query("COMMIT");
      return {
        worker: mapMiningWorker(worker.rows[0]),
        minerConnection: sanitizeMinerConnection(worker.rows[0]),
        payoutsEnabled: config.miningPayoutsEnabled,
        warning: config.miningPayoutsEnabled ? undefined : "PAYOUT NON ANCORA ATTIVO"
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/mining/network/stats", async (request, reply) => {
    const userId = config.miningCollectiveStatsPublic ? undefined : await requireSessionUserId(request, reply);
    if (!config.miningCollectiveStatsPublic && !userId) {
      return;
    }
    return buildMiningNetworkStats(userId);
  });

  app.get("/api/mining/profitability", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return {
      enabled: config.miningAutoSwitchEnabled,
      note: "Stime non garantite. Nessuno switch viene fatto senza regole attive e dati sufficienti.",
      xmr: { available: Boolean(config.veloraMoneroWallet && config.miningPoolXmrUrl), scoreBps: 0, dataQuality: "insufficient_pool_accounting" },
      zeph: { available: Boolean(config.veloraZephyrWallet && config.miningPoolZephUrl), scoreBps: 0, dataQuality: "insufficient_pool_accounting" }
    };
  });

  app.get("/api/mining/optimizer/status", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const result = await requirePool().query(
      `SELECT mop.*
       FROM mining_optimizer_profiles mop
       JOIN mining_devices md ON md.id = mop.mining_device_id
       WHERE md.user_id = $1
       ORDER BY mop.updated_at DESC
       LIMIT 20`,
      [userId]
    );
    return { enabled: config.miningOptimizerEnabled, profiles: result.rows };
  });

  app.post("/api/mining/optimizer/benchmark", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { devicePeerId?: string; consentId?: string; profile?: string; result?: Record<string, unknown>; recommendedConfig?: Record<string, unknown>; minerVersion?: string };
    if (!config.miningOptimizerEnabled) {
      return reply.failedDependency("mining optimizer disabled");
    }
    if (!body.devicePeerId || !body.consentId || !body.result) {
      return reply.badRequest("devicePeerId, consentId and result are required");
    }
    const device = await requirePool().query("SELECT id FROM mining_devices WHERE user_id = $1 AND device_peer_id = $2", [userId, body.devicePeerId]);
    if (!device.rows[0]) {
      return reply.notFound("mining device not found");
    }
    const saved = await requirePool().query(
      `INSERT INTO mining_benchmarks (id, mining_device_id, consent_id, benchmark_version, miner_version, profile, result_json, recommended_config_json)
       VALUES ($1,$2,$3,'velora-optimizer-v1',$4,$5,$6,$7)
       RETURNING *`,
      [randomUUID(), device.rows[0].id, body.consentId, body.minerVersion ?? "unknown", normalizeChoice(body.profile, ["ECO", "BILANCIATO", "POTENZA", "PERSONALIZZATO"], "ECO"), JSON.stringify(body.result), JSON.stringify(body.recommendedConfig ?? {})]
    );
    return { benchmark: saved.rows[0], warning: "Temperature, watt and profitability must be treated as unavailable when sensors are missing." };
  });

  app.post("/api/mining/optimizer/apply", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { devicePeerId?: string; profile?: string; config?: Record<string, unknown>; reason?: string };
    if (!body.devicePeerId || !body.config || !body.reason) {
      return reply.badRequest("devicePeerId, config and reason are required");
    }
    const device = await requirePool().query("SELECT id FROM mining_devices WHERE user_id = $1 AND device_peer_id = $2", [userId, body.devicePeerId]);
    if (!device.rows[0]) {
      return reply.notFound("mining device not found");
    }
    const selected = normalizeChoice(body.profile, ["ECO", "BILANCIATO", "POTENZA", "PERSONALIZZATO"], "ECO");
    const saved = await requirePool().query(
      `INSERT INTO mining_optimizer_profiles (id, mining_device_id, selected_profile, config_json, reason)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [randomUUID(), device.rows[0].id, selected, JSON.stringify(body.config), body.reason]
    );
    return { profile: saved.rows[0] };
  });

  app.get("/api/mining/auto-switch/status", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return getAutoSwitchStatus(userId);
  });

  app.put("/api/mining/auto-switch/config", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { mode?: string; minProfitDifferencePercent?: number; minActiveMinutes?: number; cooldownMinutes?: number; maxSwitchesPerDay?: number; evaluationIntervalSeconds?: number };
    const result = await requirePool().query(
      `INSERT INTO mining_auto_switch_rules (id, user_id, mode, min_profit_difference_percent, min_active_minutes, cooldown_minutes, max_switches_per_day, evaluation_interval_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE SET
        mode = EXCLUDED.mode,
        min_profit_difference_percent = EXCLUDED.min_profit_difference_percent,
        min_active_minutes = EXCLUDED.min_active_minutes,
        cooldown_minutes = EXCLUDED.cooldown_minutes,
        max_switches_per_day = EXCLUDED.max_switches_per_day,
        evaluation_interval_seconds = EXCLUDED.evaluation_interval_seconds,
        updated_at = NOW()
       RETURNING *`,
      [
        randomUUID(),
        userId,
        normalizeChoice(body.mode, ["AUTOMATIC", "XMR_ONLY", "ZEPH_ONLY"], "AUTOMATIC"),
        clampInteger(body.minProfitDifferencePercent, 1, 100, config.miningAutoSwitchMinProfitDifferencePercent),
        clampInteger(body.minActiveMinutes, 5, 1440, config.miningAutoSwitchMinActiveMinutes),
        clampInteger(body.cooldownMinutes, 5, 1440, config.miningAutoSwitchCooldownMinutes),
        clampInteger(body.maxSwitchesPerDay, 0, 24, config.miningAutoSwitchMaxSwitchesPerDay),
        clampInteger(body.evaluationIntervalSeconds, 60, 86400, config.miningAutoSwitchEvaluationIntervalSeconds)
      ]
    );
    return { rules: result.rows[0] };
  });

  app.post("/api/mining/auto-switch/evaluate", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const status = await getAutoSwitchStatus(userId);
    return { ...status, decision: "NO_SWITCH", reason: "Pool accounting/profitability data insufficient; flapping protection active." };
  });

  app.get("/api/mining/devices", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const result = await requirePool().query("SELECT id, device_peer_id, status, created_at, updated_at FROM mining_devices WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
    return { devices: result.rows };
  });

  app.get("/api/mining/workers/:id/config", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const result = await requirePool().query(
      `SELECT mw.*, md.user_id, md.device_peer_id
       FROM mining_workers mw
       JOIN mining_devices md ON md.id = mw.mining_device_id
       WHERE mw.id = $1 AND md.user_id = $2`,
      [routeParam(request.params, "id"), userId]
    );
    const worker = result.rows[0];
    if (!worker) {
      return reply.notFound("worker not found");
    }
    if (worker.status !== "ENABLED") {
      return reply.failedDependency("worker is not enabled; complete accounting and consent first");
    }
    return {
      workerId: worker.worker_id,
      coin: worker.coin,
      poolUrl: worker.pool_url,
      poolUsername: worker.coin === "ZEPH" ? `${worker.pool_username}.${worker.worker_id}` : worker.pool_username,
      poolPassword: worker.coin === "XMR" ? worker.worker_id : "x",
      payoutWallet: maskWallet(String(worker.payout_wallet ?? "")),
      custodial: true,
      warning: config.miningPayoutsEnabled ? undefined : "PAYOUT NON ANCORA ATTIVO"
    };
  });

  app.get("/api/mining/devices/:id", async (request, reply) => getMiningDeviceForUser(request, reply));
  app.get("/api/mining/devices/:id/stats", async (request, reply) => {
    const device = await getMiningDeviceForUser(request, reply);
    if (!device) {
      return;
    }
    const metrics = await requirePool().query("SELECT * FROM mining_device_metrics WHERE mining_device_id = $1 ORDER BY created_at DESC LIMIT 100", [device.device.id]);
    return { device: device.device, metrics: metrics.rows };
  });
  app.post("/api/mining/devices/:id/pause", async (request, reply) => setMiningDeviceStatus(request, reply, "PAUSED"));
  app.post("/api/mining/devices/:id/resume", async (request, reply) => setMiningDeviceStatus(request, reply, "ACTIVE"));
  app.post("/api/mining/devices/:id/revoke", async (request, reply) => setMiningDeviceStatus(request, reply, "REVOKED"));

  app.post("/api/boost-box/enroll", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    if (!config.miningBoostBoxEnabled) {
      return reply.failedDependency("boost box enrollment disabled in beta");
    }
    const token = `vbb_${randomUUID()}_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + config.miningBoostBoxEnrollmentTokenTtlMinutes * 60 * 1000).toISOString();
    await requirePool().query("INSERT INTO boost_box_enrollments (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)", [randomUUID(), userId, hashValue(token), expiresAt]);
    return { enrollmentToken: token, expiresAt };
  });

  app.post("/api/boost-box/heartbeat", async (request, reply) => {
    const body = request.body as { certificateId?: string; metrics?: Record<string, unknown> };
    if (!body.certificateId || !body.metrics) {
      return reply.badRequest("certificateId and metrics are required");
    }
    const result = await requirePool().query("SELECT id, status FROM boost_box_certificates WHERE id = $1 AND status = 'ACTIVE'", [body.certificateId]);
    if (!result.rows[0]) {
      return reply.forbidden("invalid or revoked boost box certificate");
    }
    await requirePool().query("INSERT INTO boost_box_metrics (id, certificate_id, metrics_json) VALUES ($1,$2,$3)", [randomUUID(), body.certificateId, JSON.stringify(body.metrics)]);
    return { ok: true };
  });

  app.get("/api/boost-box/status", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const result = await requirePool().query("SELECT id, status, expires_at, created_at FROM boost_box_certificates WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    return { enabled: config.miningBoostBoxEnabled, boxes: result.rows };
  });

  app.post("/api/v1/control/zone-requests/:id/approve", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const parsed = signedAdminCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(parsed.error.flatten());
    }

    const replaySafe = await repository.rememberAdminNonce(parsed.data);
    if (!replaySafe) {
      return reply.forbidden("replayed admin command");
    }

    if (!config.controlApiServerSigningPublicKeyBase64) {
      return reply.failedDependency("missing CONTROL_API_SERVER_SIGNING_PUBLIC_KEY_BASE64");
    }

    if (!verifySignedCommand(parsed.data, config.controlApiServerSigningPublicKeyBase64)) {
      return reply.forbidden("invalid signature");
    }

    const approved = await repository.approveZoneRequest(routeParam(request.params, "id"), parsed.data);
    if (!approved) {
      return reply.notFound("request not found");
    }

    return approved;
  });

  app.post("/api/v1/control/zone-requests/:id/reject", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const parsed = signedAdminCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(parsed.error.flatten());
    }
    if (!(await repository.rememberAdminNonce(parsed.data))) {
      return reply.forbidden("replayed admin command");
    }
    if (!config.controlApiServerSigningPublicKeyBase64 || !verifySignedCommand(parsed.data, config.controlApiServerSigningPublicKeyBase64)) {
      return reply.forbidden("invalid signature");
    }
    const rejected = await repository.rejectZoneRequest(routeParam(request.params, "id"), parsed.data, String(parsed.data.payload.reason ?? "No reason provided"));
    if (!rejected) {
      return reply.notFound("request not found");
    }
    return rejected;
  });

  app.get("/api/admin/contribution/overview", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const pool = requirePool();
    const [profiles, nodes, credits, mining] = await Promise.all([
      pool.query("SELECT mode, status, COUNT(*)::int AS count FROM contribution_profiles GROUP BY mode, status ORDER BY mode, status"),
      pool.query("SELECT module, status, COUNT(*)::int AS count FROM contributor_nodes GROUP BY module, status ORDER BY module, status"),
      pool.query("SELECT status, COALESCE(SUM(amount_cents),0)::int AS amount_cents, COUNT(*)::int AS count FROM hosting_credit_ledger GROUP BY status ORDER BY status"),
      pool.query("SELECT coin, status, COUNT(*)::int AS count FROM mining_workers GROUP BY coin, status ORDER BY coin, status")
    ]);
    return { profiles: profiles.rows, nodes: nodes.rows, credits: credits.rows, mining: mining.rows };
  });

  app.get("/api/admin/contribution/nodes", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query(
      `SELECT cn.*, u.username
       FROM contributor_nodes cn
       JOIN users u ON u.id = cn.user_id
       ORDER BY cn.updated_at DESC
       LIMIT 250`
    );
    return { nodes: result.rows.map(mapContributorNode) };
  });

  app.post("/api/admin/contribution/nodes/:id/status", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { status?: string; reason?: string };
    const status = normalizeChoice(body.status, ["ACTIVE", "SUSPENDED", "REVOKED", "QUARANTINED"], "");
    if (!status || !body.reason) {
      return reply.badRequest("status and reason are required");
    }
    const pool = requirePool();
    const result = await pool.query("UPDATE contributor_nodes SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id", [status, routeParam(request.params, "id")]);
    if (!result.rows[0]) {
      return reply.notFound("node not found");
    }
    await appendOperationalAudit(admin.adminId, `NODE_${status}`, "CONTRIBUTOR_NODE", result.rows[0].id, body.reason);
    return { ok: true, id: result.rows[0].id, status };
  });

  app.get("/api/admin/credits/requests", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query(
      `SELECT cr.*, u.username
       FROM credit_requests cr
       JOIN users u ON u.id = cr.user_id
       ORDER BY cr.created_at DESC
       LIMIT 250`
    );
    return { requests: result.rows };
  });

  app.post("/api/admin/credits/requests/:id/decision", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { status?: string; reason?: string };
    const status = normalizeChoice(body.status, ["APPROVED", "REJECTED", "HOLD"], "");
    if (!status || !body.reason) {
      return reply.badRequest("status and reason are required");
    }
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requestRow = await client.query(
        `UPDATE credit_requests SET status = $1, decision_reason = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [status, body.reason, admin.adminId, routeParam(request.params, "id")]
      );
      if (!requestRow.rows[0]) {
        await client.query("ROLLBACK");
        return reply.notFound("credit request not found");
      }
      if (status === "APPROVED") {
        await client.query(
          `INSERT INTO hosting_credit_ledger (id, user_id, amount_cents, kind, status, period_month, reason, metadata_json)
           VALUES ($1,$2,$3,'MANUAL_BETA_REQUEST','AVAILABLE',TO_CHAR(NOW(),'YYYY-MM'),$4,$5)`,
          [randomUUID(), requestRow.rows[0].user_id, requestRow.rows[0].amount_cents, body.reason, JSON.stringify({ creditRequestId: requestRow.rows[0].id })]
        );
      }
      await client.query("COMMIT");
      await appendOperationalAudit(admin.adminId, `CREDIT_REQUEST_${status}`, "CREDIT_REQUEST", requestRow.rows[0].id, body.reason);
      return { request: requestRow.rows[0] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/admin/mining/workers/:id/status", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { status?: string; reason?: string };
    const status = normalizeChoice(body.status, ["ENABLED", "DISABLED", "SUSPENDED", "REVOKED", "PAYOUT_HOLD"], "");
    if (!status || !body.reason) {
      return reply.badRequest("status and reason are required");
    }
    const result = await requirePool().query("UPDATE mining_workers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id", [status, routeParam(request.params, "id")]);
    if (!result.rows[0]) {
      return reply.notFound("worker not found");
    }
    await appendOperationalAudit(admin.adminId, `MINING_WORKER_${status}`, "MINING_WORKER", result.rows[0].id, body.reason);
    return { ok: true, id: result.rows[0].id, status };
  });

  app.get("/api/admin/mining/diagnostics", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return buildMiningConfigSummary();
  });

  app.post("/api/admin/mining/shares/import", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as {
      workerId?: string;
      coin?: string;
      poolShareId?: string;
      status?: string;
      difficultyAtomic?: string | number;
      submittedAt?: string;
      idempotencyKey?: string;
    };
    if (!body.workerId || !body.coin || !body.poolShareId || !body.status) {
      return reply.badRequest("workerId, coin, poolShareId and status are required");
    }
    const worker = await requirePool().query("SELECT id, pool_url FROM mining_workers WHERE worker_id = $1 AND coin = $2", [body.workerId, body.coin]);
    if (!worker.rows[0]) {
      return reply.notFound("worker not found");
    }
    const status = normalizeChoice(body.status, ["ACCEPTED", "REJECTED", "STALE"], "REJECTED");
    await requirePool().query(
      `INSERT INTO mining_pool_shares (id, worker_id, coin, pool_url, pool_share_id, accounting_period, status, difficulty_atomic, submitted_at)
       VALUES ($1,$2,$3,$4,$5,TO_CHAR(NOW(),'YYYY-MM'),$6,$7,$8)
       ON CONFLICT (worker_id, pool_share_id) DO NOTHING`,
      [randomUUID(), worker.rows[0].id, body.coin, worker.rows[0].pool_url, body.poolShareId, status, toAtomicText(body.difficultyAtomic ?? 0), body.submittedAt ?? new Date().toISOString()]
    );
    await appendOperationalAudit(admin.adminId, "MINING_SHARE_IMPORTED", "MINING_WORKER", worker.rows[0].id, body.idempotencyKey ?? body.poolShareId);
    return { ok: true };
  });

  app.post("/api/admin/mining/payments/reconcile", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as {
      coin?: string;
      poolUrl?: string;
      accountingPeriod?: string;
      confirmedMinedAtomicAmount?: string | number;
      unavoidableNetworkFeeAtomicAmount?: string | number;
      txHash?: string;
      confirmations?: number;
      idempotencyKey?: string;
    };
    if (!body.coin || !body.poolUrl || !body.accountingPeriod || !body.confirmedMinedAtomicAmount || !body.txHash || !body.idempotencyKey) {
      return reply.badRequest("coin, poolUrl, accountingPeriod, confirmedMinedAtomicAmount, txHash and idempotencyKey are required");
    }
    const shares = await requirePool().query(
      `SELECT mw.id AS worker_id, mw.payout_wallet, COALESCE(SUM(mps.difficulty_atomic),0)::text AS work_atomic
       FROM mining_workers mw
       JOIN mining_pool_shares mps ON mps.worker_id = mw.id
       WHERE mw.coin = $1 AND mw.pool_url = $2 AND mps.accounting_period = $3 AND mps.status = 'ACCEPTED'
       GROUP BY mw.id, mw.payout_wallet`,
      [body.coin, body.poolUrl, body.accountingPeriod]
    );
    const totalWork = shares.rows.reduce((sum, row) => sum + BigInt(row.work_atomic), 0n);
    if (totalWork <= 0n) {
      return reply.failedDependency("no accepted pool shares for this accounting period");
    }
    const confirmed = BigInt(toAtomicText(body.confirmedMinedAtomicAmount));
    const fee = BigInt(toAtomicText(body.unavoidableNetworkFeeAtomicAmount ?? 0));
    const distributable = confirmed - fee;
    if (distributable <= 0n) {
      return reply.badRequest("distributable amount must be positive");
    }
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const payment = await client.query(
        `INSERT INTO mining_pool_payments (
          id, coin, pool_url, accounting_period, confirmed_mined_atomic_amount,
          unavoidable_network_fee_atomic_amount, tx_hash, confirmations, status, idempotency_key
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
        RETURNING id`,
        [
          randomUUID(),
          body.coin,
          body.poolUrl,
          body.accountingPeriod,
          confirmed.toString(),
          fee.toString(),
          body.txHash,
          Math.max(0, Number(body.confirmations ?? 0)),
          Number(body.confirmations ?? 0) > 0 ? "CONFIRMED" : "PENDING_CONFIRMATION",
          body.idempotencyKey
        ]
      );
      for (const row of shares.rows) {
        const workerWork = BigInt(row.work_atomic);
        const gross = distributable * workerWork / totalWork;
        const userAmount = gross * BigInt(config.miningUserShareBps) / 10000n;
        const veloraAmount = gross - userAmount;
        await client.query(
          `INSERT INTO mining_ledger (
            id, worker_id, coin, gross_atomic_amount, user_atomic_amount, velora_atomic_amount,
            status, tx_hash, metadata_json, accounting_period, pool_payment_id,
            network_fee_atomic_amount, confirmations, payout_wallet, idempotency_key
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            randomUUID(),
            row.worker_id,
            body.coin,
            gross.toString(),
            userAmount.toString(),
            veloraAmount.toString(),
            config.miningPayoutsEnabled ? "PENDING_PAYOUT" : "PENDING_PAYOUT_DISABLED",
            body.txHash,
            JSON.stringify({ totalWork: totalWork.toString(), workerWork: workerWork.toString(), formula: "floor(distributable * workerWork / totalWork) then 50/50 bps" }),
            body.accountingPeriod,
            payment.rows[0].id,
            fee.toString(),
            Math.max(0, Number(body.confirmations ?? 0)),
            row.payout_wallet,
            `${body.idempotencyKey}:${row.worker_id}`
          ]
        );
      }
      await client.query("COMMIT");
      await appendOperationalAudit(admin.adminId, "MINING_PAYMENT_RECONCILED", "MINING_POOL_PAYMENT", payment.rows[0].id, body.idempotencyKey);
      return { ok: true, paymentId: payment.rows[0].id, ledgerRows: shares.rows.length, payoutsEnabled: config.miningPayoutsEnabled };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/admin/mining/network", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return buildMiningNetworkStats();
  });

  app.get("/api/admin/mining/optimizer", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query("SELECT * FROM mining_optimizer_profiles ORDER BY updated_at DESC LIMIT 100");
    return { enabled: config.miningOptimizerEnabled, profiles: result.rows };
  });

  app.get("/api/admin/mining/auto-switch", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query("SELECT * FROM mining_auto_switch_rules ORDER BY updated_at DESC LIMIT 100");
    return { enabled: config.miningAutoSwitchEnabled, rules: result.rows };
  });

  app.get("/api/admin/mining/boost-boxes", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query("SELECT id, user_id, status, expires_at, created_at FROM boost_box_certificates ORDER BY created_at DESC LIMIT 100");
    return { enabled: config.miningBoostBoxEnabled, boxes: result.rows };
  });

  app.post("/api/admin/mining/boost-boxes/:id/revoke", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { reason?: string };
    const reason = body.reason ?? "Admin revocation";
    const result = await requirePool().query("UPDATE boost_box_certificates SET status = 'REVOKED' WHERE id = $1 RETURNING id", [routeParam(request.params, "id")]);
    if (!result.rows[0]) {
      return reply.notFound("boost box not found");
    }
    await requirePool().query("INSERT INTO boost_box_revocations (id, certificate_id, reason) VALUES ($1,$2,$3)", [randomUUID(), result.rows[0].id, reason]);
    await appendOperationalAudit(admin.adminId, "BOOST_BOX_REVOKED", "BOOST_BOX", result.rows[0].id, reason);
    return { ok: true };
  });

  app.get("/api/admin/beta-nodes", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const status = await betaLogicalNodeCluster.status();
    return {
      ...status,
      note: "I nodi Beta sono attori logici ospitati sulla stessa infrastruttura Heroku. Non rappresentano ancora repliche fisiche o geografiche indipendenti."
    };
  });

  app.get("/api/admin/beta-nodes/:id", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const id = routeParam(request.params, "id");
    const status = await betaLogicalNodeCluster.status();
    const node = status.nodes.find((candidate) => candidate.id === id || candidate.name === id);
    if (!node) {
      return reply.notFound("beta node not found");
    }
    return { node };
  });

  app.post("/api/admin/beta-nodes/:id/restart", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return betaLogicalNodeCluster.restartNode(routeParam(request.params, "id"));
  });

  app.post("/api/admin/beta-nodes/:id/suspend", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return betaLogicalNodeCluster.suspendNode(routeParam(request.params, "id"));
  });

  app.post("/api/admin/beta-nodes/:id/resume", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return betaLogicalNodeCluster.resumeNode(routeParam(request.params, "id"));
  });

  app.post("/api/admin/beta-nodes/:id/reconcile", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return betaLogicalNodeCluster.reconcileNode(routeParam(request.params, "id"));
  });

  app.post("/api/admin/beta-nodes/repair", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return betaLogicalNodeCluster.repairAll();
  });

  app.post("/api/admin/beta-nodes/test-failover", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return betaLogicalNodeCluster.testFailover();
  });
}

async function sendBetaDownload(file: string, reply: FastifyReply) {
  const download = await findBetaDownload(file);
  if (!download) {
    return reply.notFound("download not found");
  }

  reply.header("Content-Length", String(download.info.size));
  reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
  reply.type(file.endsWith(".msi") ? "application/octet-stream" : "text/plain; charset=utf-8");
  return reply.send(createReadStream(download.path));
}

async function findBetaDownload(file: string) {
  for (const root of betaDownloadRoots) {
    const path = resolve(root, file);
    if (!path.startsWith(root)) {
      continue;
    }
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) {
      return { path, info };
    }
  }
  return undefined;
}

async function sendMacosDownload(file: string, reply: FastifyReply) {
  const download = await findMacosDownload(file);
  if (!download) {
    return reply.notFound("download not found");
  }

  reply.header("Content-Length", String(download.info.size));
  reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
  reply.type(file.endsWith(".dmg") ? "application/octet-stream" : "text/plain; charset=utf-8");
  return reply.send(createReadStream(download.path));
}

async function findMacosDownload(file: string) {
  for (const root of macosDownloadRoots) {
    const path = resolve(root, file);
    if (!path.startsWith(root)) {
      continue;
    }
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) {
      return { path, info };
    }
  }
  return undefined;
}

async function sendNasFallbackDownload(file: string, reply: FastifyReply) {
  const download = await findNasFallbackDownload(file);
  if (!download) {
    return reply.notFound("download not found");
  }

  reply.header("Content-Length", String(download.info.size));
  reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
  reply.type("application/zip");
  return reply.send(createReadStream(download.path));
}

async function findNasFallbackDownload(file: string) {
  for (const root of nasFallbackRoots) {
    const path = resolve(root, file);
    if (!path.startsWith(root)) {
      continue;
    }
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) {
      return { path, info };
    }
  }
  return undefined;
}

function publicPage(page: string) {
  const title = {
    home: "VELORA - L'Upper Web",
    download: "Scarica Velora",
    "what-is-velora": "Cos'e Velora",
    security: "Sicurezza",
    publishers: "Publisher",
    developers: "Developers",
    pricing: "Pricing",
    faq: "FAQ",
    status: "Status",
    privacy: "Privacy",
    terms: "Termini"
  }[page] ?? "VELORA";
  const downloadUrl = "/downloads/windows/Velora_0.1.0_x64_en-US.msi";
  const checksumUrl = "/downloads/windows/Velora_0.1.0_x64_en-US.msi.sha256.txt";
  const macosDownloadUrl = "/downloads/macos/Velora_0.1.0_aarch64.dmg";
  const macosChecksumUrl = "/downloads/macos/Velora_0.1.0_aarch64.dmg.sha256.txt";
  const nasFallbackUrl = "/downloads/nas/velora-nas-fallback-agent-0.1.0-beta.zip";
  const moneroWalletUrl = "https://www.getmonero.org/downloads/";
  const zephyrWalletUrl = "https://zephyrprotocol.com/";
  const body = page === "download" ? `
    <section class="panel">
      <h1>Scarica Velora Beta</h1>
      <p>Beta pubblica pronta per Windows x64 e macOS Apple Silicon<br>I pacchetti non sono ancora firmati o notarizzati, quindi il sistema operativo puo mostrare un avviso</p>
      <section class="cards">
        <article>
          <b>Windows</b>
          <p>Installer MSI per PC Windows x64</p>
          <a class="cta" href="${downloadUrl}">Scarica per Windows</a>
          <a class="ghost" href="${checksumUrl}">Verifica SHA-256</a>
        </article>
        <article>
          <b>macOS</b>
          <p>DMG per Mac Apple Silicon</p>
          <a class="cta" href="${macosDownloadUrl}">Scarica per macOS</a>
          <a class="ghost" href="${macosChecksumUrl}">Verifica SHA-256</a>
        </article>
        <article>
          <b>Nodo NAS fallback</b>
          <p>Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso</p>
          <a class="cta" href="${nasFallbackUrl}">Scarica nodo NAS</a>
        </article>
      </section>
      <dl>
        <dt>Versione</dt><dd>0.1.0 Beta</dd>
        <dt>Windows</dt><dd>Velora_0.1.0_x64_en-US.msi - 6C684E60215151BD8989F1A6EEF64022131D78E0B99E7D03E649DDD4F8E81ED6</dd>
        <dt>macOS</dt><dd>Velora_0.1.0_aarch64.dmg - 95B03EF998E9E97AC9A6F1D9930CF7665AC39839C243E105E27073FC7BF15ECF</dd>
      </dl>
    </section>
    <section class="panel">
      <h2>Wallet Mining Partner</h2>
      <p>Usa soltanto wallet ufficiali e custodisci tu seed phrase e chiavi private<br>Velora non chiede mai seed, private key, password o file wallet</p>
      <a class="ghost" href="${moneroWalletUrl}" rel="noopener noreferrer">Wallet Monero ufficiale</a>
      <a class="ghost" href="${zephyrWalletUrl}" rel="noopener noreferrer">Wallet Zephyr ufficiale</a>
      <p>Durante la beta puoi richiedere payout manuale dal tuo account quando la quota viene verificata nel pannello admin</p>
    </section>` : page === "publishers" ? `
    <section class="panel">
      <h1>Pubblica nell'Upper Web</h1>
      <p>Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.</p>
      <a class="cta" href="/publishers/guide">Apri guida publisher</a>
      <a class="ghost" href="/developers">SDK e documentazione tecnica</a>
    </section>
    <section class="cards">
      <article><b>Livello 0</b><p>Siti statici senza login.</p></article>
      <article><b>Livello 1</b><p>Account Velora e SDK.</p></article>
      <article><b>Review</b><p>Manifest, permessi e controlli di sicurezza.</p></article>
    </section>` : page === "pricing" ? `
    <section class="panel"><h1>Piani publisher</h1><div class="cards">
      <article><b>Livello 0</b><span>Gratis</span><p>Siti informativi.</p></article>
      <article><b>Livello 1</b><span>Gratis</span><p>Account base con Login Velora.</p></article>
      <article><b>Livello 2</b><span>1,99 EUR/mese</span><p>Identita verificata.</p></article>
      <article><b>Livello 3</b><span>4,99 EUR/mese</span><p>Operazioni sensibili predisposte.</p></article>
      <article><b>Publisher Pro</b><span>19,90 EUR/mese</span><p>Supporto e strumenti avanzati.</p></article>
    </div></section>` : page === "status" ? `
    <section class="panel"><h1>Status</h1><p>API pubblica: <a href="/health">/health</a>. Download Windows e macOS Apple Silicon: operativi.</p></section>` : `
    <section class="hero">
      <span>VELORA - L'UPPER WEB</span>
      <h1>Sopra Internet, il futuro e ora</h1>
      <p>Sicuro<br>Veloce<br>Semplice<br>Per tutti</p>
      <div><a class="cta" href="/download">Scarica Velora Beta</a><a class="ghost" href="/what-is-velora">Scopri l'Upper Web</a></div>
      <strong>Velora non sostituisce Internet<br>Lo eleva</strong>
    </section>
    <section class="cards">
      <article><b>Upper Web</b><p>Zone verificate, ricerca interna e identita Velora.</p></article>
      <article><b>Publisher</b><p>Pubblica siti nativi Velora con SDK e review.</p></article>
      <article><b>Sicurezza</b><p>Permessi, manifest e contenuti verificati.</p></article>
    </section>`;
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root{color:#f7fbff;background:#06111f;font-family:Aptos,Segoe UI,sans-serif}
    body{margin:0;background:radial-gradient(circle at 70% 0,rgba(216,174,85,.24),transparent 30%),radial-gradient(circle at 15% 15%,rgba(47,155,255,.25),transparent 34%),linear-gradient(180deg,#0b2138,#03070d);min-height:100vh}
    header,main,footer{max-width:1180px;margin:auto;padding:24px}
    nav{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
    nav a{color:#c8d9ea;text-decoration:none}
    nav a:first-child{color:#f1d68b;font-weight:900;letter-spacing:.18em}
    .hero,.panel,.cards article{border:1px solid rgba(150,202,255,.18);background:rgba(10,30,50,.72);border-radius:30px;box-shadow:0 28px 80px rgba(0,0,0,.42)}
    .hero{padding:clamp(36px,8vw,92px);margin-top:28px}
    .hero span{color:#f1d68b;letter-spacing:.18em}
    h1{font-size:clamp(42px,8vw,92px);line-height:.95;margin:14px 0;letter-spacing:-.05em}
    p,dd{color:#c8d9ea;font-size:18px}
    .cta,.ghost{display:inline-flex;margin:18px 12px 0 0;padding:14px 18px;border-radius:16px;text-decoration:none;border:1px solid rgba(216,174,85,.5)}
    .cta{background:linear-gradient(135deg,#f1d68b,#d8ae55);color:#06111f;font-weight:900}
    .ghost{color:#f1d68b}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:22px}
    .cards article,.panel{padding:24px}
    dt{color:#f1d68b;margin-top:14px}
    dd{margin-left:0;overflow-wrap:anywhere}
    footer{color:#9fb4c8}
  </style>
</head>
<body>
  <header><nav><a href="/">VELORA</a><a href="/download">Download</a><a href="/what-is-velora">Upper Web</a><a href="/security">Sicurezza</a><a href="/publishers">Publisher</a><a href="/publishers/guide">Guida</a><a href="/developers">Developers</a><a href="/pricing">Pricing</a><a href="/status">Status</a></nav></header>
  <main>${body}</main>
  <footer>Sei pronto per Velora? Non vedo l'ora.</footer>
</body>
</html>`;
}

function routeParam(params: unknown, key: string) {
  return String((params as Record<string, string>)[key]);
}

async function getContributionProfile(userId: string) {
  const pool = requirePool();
  const [profile, consents, nodes, credits, mining] = await Promise.all([
    pool.query("SELECT * FROM contribution_profiles WHERE user_id = $1", [userId]),
    pool.query("SELECT module, enabled, resource_profile, revoked_at, created_at FROM node_module_consents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30", [userId]),
    pool.query("SELECT * FROM contributor_nodes WHERE user_id = $1 ORDER BY updated_at DESC", [userId]),
    pool.query("SELECT status, COALESCE(SUM(amount_cents),0)::int AS amount_cents FROM hosting_credit_ledger WHERE user_id = $1 GROUP BY status", [userId]),
    pool.query(
      `SELECT mw.*, md.device_peer_id
       FROM mining_workers mw
       JOIN mining_devices md ON md.id = mw.mining_device_id
       WHERE md.user_id = $1
       ORDER BY mw.updated_at DESC`,
      [userId]
    )
  ]);
  return {
    profile: profile.rows[0] ? mapContributionProfile(profile.rows[0]) : mapContributionProfile({ mode: "VELORA_ONLY", status: "ACTIVE", resource_profile: "MINIMUM", velora_node_enabled: false, hosting_node_enabled: false, mining_partner_enabled: false }),
    consents: consents.rows,
    nodes: nodes.rows.map(mapContributorNode),
    credits: credits.rows,
    mining: mining.rows.map(mapMiningWorker)
  };
}

function normalizeChoice(value: unknown, allowed: string[], fallback: string) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return allowed.includes(normalized) ? normalized : fallback;
}

function mapContributionProfile(row: any) {
  return {
    mode: String(row.mode),
    status: String(row.status),
    resourceProfile: String(row.resource_profile),
    veloraNodeEnabled: row.velora_node_enabled === true,
    hostingNodeEnabled: row.hosting_node_enabled === true,
    miningPartnerEnabled: row.mining_partner_enabled === true,
    updatedAt: row.updated_at ?? null
  };
}

function mapContributorNode(row: any) {
  return {
    id: String(row.id),
    username: row.username ? String(row.username) : undefined,
    module: String(row.module),
    status: String(row.status),
    devicePeerId: String(row.device_peer_id),
    resourceProfile: String(row.resource_profile),
    certificate: row.certificate_json ?? {},
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    updatedAt: row.updated_at ?? null
  };
}

function mapMiningWorker(row: any) {
  return {
    id: String(row.id),
    devicePeerId: String(row.device_peer_id ?? ""),
    coin: String(row.coin),
    status: String(row.status),
    payoutWallet: maskWallet(String(row.payout_wallet ?? row.user_wallet)),
    poolWalletPresent: Boolean(row.velora_wallet),
    poolWalletMasked: maskWallet(String(row.velora_wallet ?? "")),
    poolUrl: row.pool_url ?? null,
    workerId: String(row.worker_id ?? ""),
    workerFormat: String(row.pool_worker_format ?? ""),
    accountingStatus: String(row.accounting_status ?? "CONFIGURATION_INCOMPLETE"),
    accountingPeriod: String(row.accounting_period ?? ""),
    lastAccountingError: row.last_accounting_error ? sanitizeError(String(row.last_accounting_error)) : null,
    split: {
      userBps: Number(row.payout_split_user_bps ?? 5000),
      veloraBps: Number(row.payout_split_velora_bps ?? 5000)
    },
    updatedAt: row.updated_at ?? null
  };
}

function buildMiningCoinConfig(coin: string, userId: string, devicePeerId: string, payoutWallet: string) {
  const shares = validateMiningShares();
  if (!shares.valid) {
    return { valid: false, error: shares.error };
  }
  const poolUrl = coin === "XMR" ? config.miningPoolXmrUrl : config.miningPoolZephUrl;
  const poolUsername = coin === "XMR" ? config.veloraMoneroWallet : config.veloraZephyrWallet;
  if (!isAllowedStratumUrl(poolUrl)) {
    return { valid: false, error: `${coin} pool URL missing or unsupported` };
  }
  if (!poolUsername || !isLikelyCoinAddress(coin, poolUsername)) {
    return { valid: false, error: `${coin} operational Velora wallet is missing or invalid` };
  }
  if (!isLikelyCoinAddress(coin, payoutWallet)) {
    return { valid: false, error: `${coin} payout wallet is invalid` };
  }
  const accountingPeriod = new Date().toISOString().slice(0, 7);
  const workerId = buildWorkerId(userId, devicePeerId, coin);
  const workerFormat = coin === "ZEPH" ? "USERNAME_DOT_RIG_ID" : "PASSWORD_WORKER_ID";
  const workerPassword = coin === "XMR" ? workerId : "x";
  const accountingAvailable = false;
  const accountingStatus = accountingAvailable ? "READY" : "CONFIGURATION_INCOMPLETE";
  const accountingError = accountingAvailable ? null : "Pool share/payment accounting not verified yet; user payout remains disabled.";
  return {
    valid: true,
    poolUrl,
    poolUsername,
    workerId,
    workerFormat,
    workerPassword,
    accountingPeriod,
    accountingStatus,
    accountingError,
    workerStatus: "ENABLED"
  };
}

function buildMiningConfigSummary() {
  const shares = validateMiningShares();
  const xmr = summarizeMiningCoin("XMR", config.miningPoolXmrUrl, config.veloraMoneroWallet, config.miningXmrWalletRpcUrl);
  const zeph = summarizeMiningCoin("ZEPH", config.miningPoolZephUrl, config.veloraZephyrWallet, config.miningZephWalletRpcUrl);
  return {
    public: { xmr, zeph },
    shareBps: {
      user: config.miningUserShareBps,
      velora: config.miningVeloraShareBps,
      valid: shares.valid,
      error: shares.valid ? undefined : shares.error
    },
    payoutsEnabled: config.miningPayoutsEnabled,
    accountingAvailable: false,
    lastError: shares.valid ? "Pool accounting and wallet RPC payout worker are not verified yet." : shares.error
  };
}

function summarizeMiningCoin(coin: string, poolUrl: string, wallet: string, rpcUrl: string) {
  const parsed = parsePoolUrl(poolUrl);
  return {
    coin,
    configured: Boolean(wallet && parsed),
    poolHost: parsed?.host ?? null,
    protocol: parsed?.protocol ?? null,
    operationalWalletPresent: Boolean(wallet),
    operationalWalletMasked: maskWallet(wallet),
    poolUrlValid: Boolean(parsed),
    workerFormat: coin === "ZEPH" ? "wallet.worker via -u for 2Miners" : "wallet login and worker in password/pass for MoneroOcean",
    rpcReachable: Boolean(rpcUrl) ? "not_checked_from_api" : false,
    accountingAvailable: false,
    status: wallet && parsed ? "CONFIGURATION_INCOMPLETE" : "MISSING_CONFIGURATION"
  };
}

function validateMiningShares() {
  const user = Number(config.miningUserShareBps);
  const velora = Number(config.miningVeloraShareBps);
  if (!Number.isInteger(user) || !Number.isInteger(velora) || user < 0 || velora < 0 || user + velora !== 10000) {
    return { valid: false, error: "VELORA_MINING_USER_SHARE_BPS + VELORA_MINING_VELORA_SHARE_BPS must equal 10000" };
  }
  return { valid: true };
}

function buildWorkerId(userId: string, devicePeerId: string, coin: string) {
  const userPublicId = hashValue(`velora-user:${userId}`).slice(0, 16);
  const devicePublicId = hashValue(`velora-device:${devicePeerId}:${coin}`).slice(0, 16);
  return `velora_${userPublicId}_${devicePublicId}`;
}

function sanitizeMinerConnection(row: any) {
  const coin = String(row.coin);
  const workerId = String(row.worker_id ?? "");
  const poolUsername = String(row.pool_username ?? row.velora_wallet ?? "");
  return {
    coin,
    poolUrl: String(row.pool_url ?? ""),
    poolUsername: coin === "ZEPH" ? `${poolUsername}.${workerId}` : maskWallet(poolUsername),
    workerId,
    workerPassword: coin === "XMR" ? workerId : "x",
    note: coin === "ZEPH" ? "2Miners ZEPH usa WALLET.RIG_ID in -u." : "MoneroOcean usa wallet come login e worker nel campo password/pass."
  };
}

async function buildMiningNetworkStats(userId?: string) {
  const pool = requirePool();
  const params = userId ? [userId] : [];
  const where = userId ? "WHERE md.user_id = $1" : "";
  const metrics = await pool.query(
    `SELECT
      COALESCE(SUM(mdm.observed_hashrate_hs),0)::int AS total_hashrate_hs,
      COALESCE(SUM(CASE WHEN mdm.coin = 'XMR' THEN mdm.observed_hashrate_hs ELSE 0 END),0)::int AS xmr_hashrate_hs,
      COALESCE(SUM(CASE WHEN mdm.coin = 'ZEPH' THEN mdm.observed_hashrate_hs ELSE 0 END),0)::int AS zeph_hashrate_hs,
      COALESCE(SUM(mdm.accepted_shares),0)::int AS accepted_shares,
      COALESCE(SUM(mdm.rejected_shares),0)::int AS rejected_shares,
      COALESCE(SUM(mdm.stale_shares),0)::int AS stale_shares,
      COUNT(DISTINCT mw.id)::int AS active_workers,
      COUNT(DISTINCT md.id)::int AS active_devices,
      COUNT(DISTINCT CASE WHEN mdm.device_type = 'BOOST_BOX' THEN md.id END)::int AS active_boost_boxes
     FROM mining_device_metrics mdm
     JOIN mining_devices md ON md.id = mdm.mining_device_id
     LEFT JOIN mining_workers mw ON mw.id = mdm.worker_id
     ${where}`,
    params
  );
  const ledger = await pool.query(
    `SELECT
      COALESCE(SUM(user_atomic_amount),0)::text AS users_share_atomic,
      COALESCE(SUM(velora_atomic_amount),0)::text AS velora_share_atomic,
      COALESCE(SUM(gross_atomic_amount),0)::text AS reward_confirmed_atomic
     FROM mining_ledger ml
     JOIN mining_workers mw ON mw.id = ml.worker_id
     JOIN mining_devices md ON md.id = mw.mining_device_id
     ${where}`,
    params
  );
  return {
    source: "server_side_pool_shares_only",
    payoutStatus: config.miningPayoutsEnabled ? "ENABLED" : "PAYOUT_NON_ANCORA_ATTIVO",
    network: metrics.rows[0],
    rewards: ledger.rows[0],
    contributionModel: "USER_VALIDATED_WORK / TOTAL_VALIDATED_WORK",
    warning: "Client-reported hashrate is diagnostic only and is not used for payouts."
  };
}

async function getAutoSwitchStatus(userId: string) {
  const result = await requirePool().query("SELECT * FROM mining_auto_switch_rules WHERE user_id = $1", [userId]);
  const rules = result.rows[0] ?? {
    mode: "AUTOMATIC",
    min_profit_difference_percent: config.miningAutoSwitchMinProfitDifferencePercent,
    min_active_minutes: config.miningAutoSwitchMinActiveMinutes,
    cooldown_minutes: config.miningAutoSwitchCooldownMinutes,
    max_switches_per_day: config.miningAutoSwitchMaxSwitchesPerDay,
    evaluation_interval_seconds: config.miningAutoSwitchEvaluationIntervalSeconds
  };
  return {
    enabled: config.miningAutoSwitchEnabled,
    rules,
    currentCoin: null,
    alternativeCoin: null,
    cooldown: "not_applicable",
    nextCheckSeconds: rules.evaluation_interval_seconds,
    warning: "Auto-Switch does not promise higher earnings and needs verified pool/profitability data."
  };
}

async function getMiningDeviceForUser(request: { headers: Record<string, string | string[] | undefined>; params: unknown }, reply: FastifyReply) {
  const userId = await requireSessionUserId(request, reply);
  if (!userId) {
    return undefined;
  }
  const result = await requirePool().query("SELECT id, device_peer_id, status, created_at, updated_at FROM mining_devices WHERE user_id = $1 AND id = $2", [userId, routeParam(request.params, "id")]);
  if (!result.rows[0]) {
    reply.notFound("mining device not found");
    return undefined;
  }
  return { userId, device: result.rows[0] };
}

async function setMiningDeviceStatus(request: { headers: Record<string, string | string[] | undefined>; params: unknown }, reply: FastifyReply, status: string) {
  const userId = await requireSessionUserId(request, reply);
  if (!userId) {
    return;
  }
  const result = await requirePool().query("UPDATE mining_devices SET status = $1, updated_at = NOW() WHERE user_id = $2 AND id = $3 RETURNING id, status", [status, userId, routeParam(request.params, "id")]);
  if (!result.rows[0]) {
    return reply.notFound("mining device not found");
  }
  return { device: result.rows[0] };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function toAtomicText(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("atomic amount must be a non-negative integer string");
  }
  return text;
}

function defaultMiningDisclosure(coin: string) {
  return {
    coin,
    randomX: true,
    optInOnly: true,
    hiddenMining: false,
    userSharePercent: 50,
    veloraSharePercent: 50,
    warning: "Il costo elettrico puo superare il ricavo. Nessun guadagno e garantito.",
    stopAvailable: true
  };
}

function isLikelyCoinAddress(coin: string, value: string) {
  const trimmed = value.trim();
  if (coin === "XMR") {
    return /^[48][1-9A-HJ-NP-Za-km-z]{94,105}$/.test(trimmed);
  }
  if (coin === "ZEPH") {
    return /^ZEPH[A-Za-z0-9]{60,120}$/.test(trimmed) || /^[1-9A-HJ-NP-Za-km-z]{90,120}$/.test(trimmed);
  }
  return false;
}

function isAllowedStratumUrl(value: string) {
  return Boolean(parsePoolUrl(value));
}

function parsePoolUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!["stratum+tcp:", "stratum+ssl:"].includes(parsed.protocol)) {
      return undefined;
    }
    if (!parsed.hostname || !parsed.port) {
      return undefined;
    }
    return { protocol: parsed.protocol.replace(":", ""), host: parsed.hostname, port: parsed.port };
  } catch {
    return undefined;
  }
}

function maskWallet(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 16) {
    return `${trimmed.slice(0, 4)}...`;
  }
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-8)}`;
}

function sanitizeError(value: string) {
  return value.replace(/[A-Za-z0-9]{24,}/g, (match) => `${match.slice(0, 6)}...${match.slice(-4)}`).slice(0, 240);
}

async function appendOperationalAudit(adminId: string, action: string, targetType: string, targetId: string, reason: string) {
  const pool = requirePool();
  const previous = await pool.query("SELECT entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1");
  const previousHash = previous.rows[0]?.entry_hash ?? "GENESIS";
  const payload = { adminId, action, targetType, targetId, reason, previousHash, createdAt: new Date().toISOString() };
  const entryHash = hashValue(JSON.stringify(payload));
  await pool.query(
    "INSERT INTO audit_logs (id, admin_id, action, target_type, target_id, reason, previous_hash, entry_hash, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [randomUUID(), adminId, action, targetType, targetId, reason, previousHash, entryHash, payload]
  );
}

function readBearerToken(request: { headers: Record<string, string | string[] | undefined> }) {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1];
}

async function requireSessionUserId(request: { headers: Record<string, string | string[] | undefined> }, reply: FastifyReply) {
  const token = readBearerToken(request);
  if (!token) {
    reply.unauthorized("Authorization bearer token is required");
    return undefined;
  }
  const user = await repository.resolveAuthSession(token);
  if (!user) {
    reply.unauthorized("invalid or expired session");
    return undefined;
  }
  return user.id;
}

async function requireAdminSession(request: { headers: Record<string, string | string[] | undefined> }, reply: FastifyReply) {
  const token = readBearerToken(request);
  if (!token) {
    reply.unauthorized("admin bearer token is required");
    return undefined;
  }
  const admin = await repository.resolveAdminSession(token);
  if (!admin) {
    reply.forbidden("invalid or expired admin session");
    return undefined;
  }
  return admin;
}

async function findForumSection(slug: string) {
  const pool = requirePool();
  const result = await pool.query("SELECT id, slug, title, description FROM forum_sections WHERE slug = $1 AND is_active = TRUE", [slug]);
  return result.rows[0] as { id: string; slug: string; title: string; description: string } | undefined;
}

async function touchForumPresence(userId: string, sectionId: string, token: string) {
  const pool = requirePool();
  const sessionHash = hashValue(token || `${userId}:forum`);
  await pool.query(
    `INSERT INTO forum_presence (user_id, section_id, session_id_hash, last_seen_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW())
     ON CONFLICT (user_id, section_id, session_id_hash)
     DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()`,
    [userId, sectionId, sessionHash]
  );
}

function mapForumSection(row: any) {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description ?? ""),
    onlineCount: Number(row.online_count ?? 0),
    lastActivityAt: row.last_activity_at ?? null
  };
}

function mapForumMessage(row: any) {
  return {
    id: String(row.id),
    body: String(row.body),
    bodyLength: Number(row.body_length ?? String(row.body).length),
    author: String(row.username ?? "utente"),
    createdAt: row.created_at
  };
}
