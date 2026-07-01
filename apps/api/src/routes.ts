import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import type { FastifyInstance, FastifyReply } from "fastify";
import { navigationCategories, signedAdminCommandSchema, zoneCheckSchema, zoneRequestSchema } from "@velora/shared";
import { validateVeloraSite } from "@velora/shared/velora-site-node";
import { config } from "./config.js";
import { buildLocalRelease, persistReleaseEvent, persistReleaseSnapshot } from "./content-store.js";
import { hashPassword, verifySignedCommand } from "./crypto.js";
import { repository } from "./repository.js";

const betaDownloadRoots = [
  resolve("releases/beta/windows"),
  resolve("../releases/beta/windows"),
  resolve("../../releases/beta/windows")
];
const publisherGuideCandidates = [
  resolve("VELORA_GUIDA_PUBBLICAZIONE.html"),
  resolve("../VELORA_GUIDA_PUBBLICAZIONE.html"),
  resolve("../../VELORA_GUIDA_PUBBLICAZIONE.html")
];
const betaInstallerName = "Velora_0.1.0_x64_en-US.msi";
const betaChecksumName = `${betaInstallerName}.sha256.txt`;

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
  app.get("/health", async () => ({ ok: true, service: "velora-api" }));
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
    return {
      token: `dev-${user.id}`,
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
    return {
      token: `dev-${user.id}`,
      user: { id: user.id, username: user.username, identityLevel: mail.identityLevel },
      mail
    };
  });

  app.post("/api/v1/auth/refresh", async () => ({ token: "beta-refresh-token" }));

  app.post("/api/v1/beta/session", async (request) => {
    const body = request.body as { installationId?: string };
    const suffix = String(body?.installationId ?? "desktop").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32) || "desktop";
    const username = `beta-${suffix}`;
    const existing = await repository.findUserByUsername(username);
    const user = existing ?? await repository.createUser(username, hashPassword(`velora-beta:${suffix}`));
    const mail = await repository.getOrCreateVeloMailAccount(user.id, username);
    return {
      token: `dev-${user.id}`,
      user: { id: user.id, username: user.username },
      mail
    };
  });

  app.get("/api/v1/mail/account", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
    if (!userId) {
      return;
    }
    return repository.getOrCreateVeloMailAccount(userId);
  });

  app.get("/api/v1/mail/inbox", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
    if (!userId) {
      return;
    }
    return { messages: await repository.listVeloMailMessages(userId, "INBOX") };
  });

  app.get("/api/v1/mail/folders/:folder", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
    if (!userId) {
      return;
    }
    return { messages: await repository.listVeloMailMessages(userId, routeParam(request.params, "folder")) };
  });

  app.get("/api/v1/mail/messages/:id", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
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
    const userId = requireBetaUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { to?: string[]; subject?: string; body?: string };
    if (!Array.isArray(body?.to) || !body.subject || !body.body) {
      return reply.badRequest("to, subject and body are required");
    }
    return repository.sendVeloMail({ userId, to: body.to, subject: body.subject, body: body.body });
  });

  app.post("/api/v1/mail/drafts", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { to?: string[]; subject?: string; body?: string };
    if (!Array.isArray(body?.to) || !body.subject) {
      return reply.badRequest("to and subject are required");
    }
    return repository.sendVeloMail({ userId, to: body.to, subject: body.subject, body: body.body ?? "", draft: true });
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
      const userId = requireBetaUserId(request, reply);
      if (!userId) {
        return;
      }
      return repository.updateVeloMailMessage(userId, routeParam(request.params, "id"), action);
    });
  }

  app.post("/api/v1/mail/block-sender", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
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
    const userId = requireBetaUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { reason?: string };
    return repository.reportVeloMailSpam(userId, routeParam(request.params, "id"), body?.reason ?? "USER_REPORT");
  });

  app.get("/api/v1/mail/search", async (request, reply) => {
    const userId = requireBetaUserId(request, reply);
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
  app.post("/api/v1/auth/logout", async () => ({ ok: true }));
  app.post("/api/v1/auth/recovery", async () => ({ ok: true, delivery: "internal-notification" }));

  app.get("/api/v1/account", async (request, reply) => {
    const userId = request.headers["x-user-id"];
    if (typeof userId !== "string") {
      return reply.unauthorized("missing x-user-id header");
    }
    const user = await repository.findUserById(userId);
    if (!user) {
      return reply.notFound("account not found");
    }
    const mail = await repository.getOrCreateVeloMailAccount(user.id, user.username);
    return { id: user.id, username: user.username, identityLevel: mail.identityLevel, mail };
  });

  app.post("/api/v1/identity/verify-basic", async (request, reply) => {
    const userId = request.headers["x-user-id"];
    if (typeof userId !== "string") {
      return reply.unauthorized("missing x-user-id header");
    }
    return repository.setIdentityLevel(userId, 1);
  });

  app.post("/api/v1/devices/enroll", async (request, reply) => {
    const userId = request.headers["x-user-id"];
    if (typeof userId !== "string") {
      return reply.unauthorized("missing x-user-id header");
    }
    const body = request.body as { peerId?: string; publicKey?: string; deviceName?: string };
    if (!body.peerId || !body.publicKey) {
      return reply.badRequest("peerId and publicKey are required");
    }
    try {
      return await repository.enrollDevice({ userId, peerId: body.peerId, publicKey: body.publicKey, deviceName: body.deviceName });
    } catch (error) {
      request.log.error(error);
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
      ASSIGNED: `La zona ${address} è già stata assegnata. Prova un nome differente.`,
      PENDING_REVIEW: "È già presente una richiesta per questa zona. Puoi scegliere un’altra zona oppure ricevere un avviso se tornerà disponibile.",
      RESERVED_NAME: "Questo nome non può essere richiesto direttamente.",
      TEMPORARILY_RESERVED: `La zona ${address} è temporaneamente riservata.`,
      BLOCKED: `La zona ${address} è attualmente bloccata.`,
      INVALID: "La zona inserita non è valida."
    }[status];

    return { address, status, message };
  });

  app.post("/api/v1/zones/requests", async (request, reply) => {
    const userId = request.headers["x-user-id"];
    if (typeof userId !== "string") {
      return reply.unauthorized("missing x-user-id header");
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
        "La richiesta sarà verificata appena possibile. In condizioni normali l’assegnazione può essere eseguita subito; in presenza di più richieste, la verifica può richiedere fino a 24 ore.",
      disclaimer:
        "L’invio della richiesta non garantisce l’assegnazione. Velora può richiedere ulteriori informazioni, proporre un nome alternativo o rifiutare richieste non conformi alle regole della rete."
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
    const userId = request.headers["x-user-id"];
    if (typeof userId !== "string") {
      return reply.unauthorized("missing x-user-id header");
    }
    const body = request.body as { sitePath?: string; publisherPublicKey?: string };
    if (!body.sitePath || !body.publisherPublicKey) {
      return reply.badRequest("sitePath and publisherPublicKey are required");
    }
    return buildLocalRelease(body.sitePath, body.publisherPublicKey);
  });

  app.post("/api/v1/sites/register-release", async (request, reply) => {
    const userId = request.headers["x-user-id"];
    if (typeof userId !== "string") {
      return reply.unauthorized("missing x-user-id header");
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
    return { adminSessionToken: "beta-admin-session", expiresInMinutes: config.adminSessionMinutes };
  });

  app.post("/api/v1/control/session/refresh", async () => ({ adminSessionToken: "beta-admin-session", expiresInMinutes: config.adminSessionMinutes }));
  app.post("/api/v1/control/session/lock", async () => ({ ok: true }));

  app.get("/api/v1/control/dashboard", async () => repository.dashboard());
  app.get("/api/v1/control/zone-requests", async () => repository.listZoneRequests());

  app.post("/api/v1/control/zone-requests/:id/approve", async (request, reply) => {
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
  const body = page === "download" ? `
    <section class="panel">
      <h1>Scarica Velora per Windows</h1>
      <p>Beta pubblica Windows x64. Dimensione reale: 4.993.024 byte. SHA-256 verificato.</p>
      <a class="cta" href="${downloadUrl}">Scarica installer MSI</a>
      <a class="ghost" href="${checksumUrl}">Scarica SHA-256</a>
      <dl>
        <dt>Versione</dt><dd>0.1.0 Beta</dd>
        <dt>File</dt><dd>Velora_0.1.0_x64_en-US.msi</dd>
        <dt>SHA-256</dt><dd>4A55628031E1CEDE54C9459AC29CCA92B3B1E358371A1698D88A37FA2DCBE41B</dd>
        <dt>Nota Windows</dt><dd>La beta non e ancora firmata con certificato pubblico: SmartScreen puo mostrare un avviso.</dd>
      </dl>
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
    <section class="panel"><h1>Status</h1><p>API pubblica: <a href="/health">/health</a>. Download Windows: operativo.</p></section>` : `
    <section class="hero">
      <span>VELORA - L'UPPER WEB</span>
      <h1>Sopra Internet, il futuro e ora</h1>
      <p>Sicuro. Veloce. Semplice. Per tutti.</p>
      <div><a class="cta" href="/download">Scarica Velora per Windows</a><a class="ghost" href="/what-is-velora">Scopri l'Upper Web</a></div>
      <strong>Velora non sostituisce Internet. Lo eleva.</strong>
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

function requireBetaUserId(request: { headers: Record<string, string | string[] | undefined> }, reply: FastifyReply) {
  const raw = request.headers["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;
  if (!userId) {
    reply.unauthorized("x-user-id header is required for beta mail APIs");
    return undefined;
  }
  return userId;
}
