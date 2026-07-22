import { createReadStream } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import type { FastifyInstance, FastifyReply } from "fastify";
import { navigationCategories, signedAdminCommandSchema, veloraManifestSchema, zoneCheckSchema, zoneRequestSchema } from "@velora/shared";
import { validateVeloraSite } from "@velora/shared/velora-site-node";
import { config } from "./config.js";
import { buildLocalRelease, persistReleaseEvent, persistReleaseSnapshot } from "./content-store.js";
import { hashPassword, hashValue, openChainedPayload, sealChainedPayload, verifySignedCommand } from "./crypto.js";
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
const mobileDownloadRoots = [
  resolve("releases/beta/mobile"),
  resolve("../releases/beta/mobile"),
  resolve("../../releases/beta/mobile")
];
const nasFallbackRoots = [
  resolve("releases/nas-fallback-agent"),
  resolve("../releases/nas-fallback-agent"),
  resolve("../../releases/nas-fallback-agent")
];
const publishedSiteRoots = [
  resolve("published-sites"),
  resolve("../published-sites"),
  resolve("../../published-sites")
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
const macosX64Name = "Velora_0.1.0_x86_64.dmg";
const macosX64ChecksumName = `${macosX64Name}.sha256.txt`;
const mobilePwaName = "velora-mobile-pwa-0.1.0-beta.zip";
const mobilePwaChecksumName = `${mobilePwaName}.sha256.txt`;
const nasFallbackName = "velora-nas-fallback-agent-0.1.0-beta.zip";
const miningPayoutThresholdAtomicByCoin: Record<string, bigint> = {
  XMR: 50_000_000_000n,
  ZEPH: 50_000_000_000n
};
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101a24"/><path d="M18 14h10l4 24 4-24h10L37 50H27L18 14Z" fill="#e0bd5b"/></svg>`;

export async function registerRoutes(app: FastifyInstance) {
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);
  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (request.headers["x-forwarded-proto"] === "https" || request.protocol === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (pathname === "/health" || pathname.startsWith("/downloads/")) {
      return;
    }
    const clientId = String(request.headers["x-forwarded-for"] ?? request.ip ?? "local").split(",")[0]?.trim() ?? "local";
    const limited = await hitRateLimit(hashValue(`${clientId}:${pathname.startsWith("/api/") ? pathname : "public"}`), pathname.startsWith("/api/") ? 240 : 600);
    if (limited) {
      await registerGuardianSignal({ level: 1, signal: "RATE_LIMIT", source: "EDGE", targetType: "REQUEST", targetId: pathname, detail: "Rate limit superato" }).catch(() => undefined);
      reply.code(429).send({ code: "RATE_LIMIT", message: "Troppe richieste. Riprova tra poco." });
    }
  });

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("home")));
  app.get("/favicon.ico", async (_request, reply) => reply.type("image/svg+xml; charset=utf-8").send(faviconSvg));
  app.get("/app.webmanifest", async (_request, reply) => reply.type("application/manifest+json; charset=utf-8").send(mobileWebManifest()));
  app.get("/mobile-sw.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(mobileServiceWorker()));
  app.get("/apple.webmanifest", async (_request, reply) => reply.type("application/manifest+json; charset=utf-8").send(appleWebManifest()));
  app.get("/apple-sw.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(appleServiceWorker()));
  app.get("/download", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("download")));
  app.get("/mobile", async (_request, reply) => reply.type("text/html; charset=utf-8").send(mobilePage()));
  app.get("/apple", async (_request, reply) => reply.type("text/html; charset=utf-8").send(applePortalPage("home")));
  app.get("/apple/:section", async (request, reply) => reply.type("text/html; charset=utf-8").send(applePortalPage(routeParam(request.params, "section"))));
  app.get("/portal", async (_request, reply) => reply.type("text/html; charset=utf-8").send(applePortalPage("home")));
  app.get("/portal/:section", async (request, reply) => reply.type("text/html; charset=utf-8").send(applePortalPage(routeParam(request.params, "section"))));
  app.get("/admin", async (_request, reply) => reply.type("text/html; charset=utf-8").send(adminPage()));
  app.get("/what-is-velora", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("what-is-velora")));
  app.get("/security", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("security")));
  app.get("/publishers", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("publishers")));
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
  app.get("/developers", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("developers")));
  app.get("/pricing", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("pricing")));
  app.get("/faq", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("faq")));
  app.get("/status", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("status")));
  app.get("/legal/privacy", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("privacy")));
  app.get("/legal/cookie", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("cookie")));
  app.get("/legal/terms", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("terms")));
  app.get("/z/:address", async (request, reply) => {
    const address = routeParam(request.params, "address");
    const fallback = await findPublicZone(address);
    return sendZoneRuntime(address, fallback, reply);
  });
  app.get("/zone/:address", async (request, reply) => {
    const address = routeParam(request.params, "address");
    const fallback = await findPublicZone(address);
    return sendZoneRuntime(address, fallback, reply);
  });
  app.get("/zone-assets/:address/*", async (request, reply) => {
    const address = routeParam(request.params, "address");
    const asset = routeParam(request.params, "*");
    return sendZoneAsset(address, asset, reply);
  });
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
  app.get("/api/v1/releases/check", async (_request, reply) => {
    const manifest = await readReleaseManifestSafe();
    if (!manifest) {
      return reply.notFound("release manifest not found");
    }
    return {
      current: manifest,
      latestVersion: manifest.version,
      channel: manifest.channel,
      changelog: releaseChangelog(),
      message: "Aggiornamento disponibile dalla pagina download quando versione e hash cambiano."
    };
  });
  app.get("/api/v1/releases/changelog", async () => ({ version: "0.1.0-beta", channel: "beta", items: releaseChangelog() }));
  app.get("/api/v1/tools", async () => ({ groups: veloraToolGroups(), tools: veloraToolCatalog() }));
  app.post("/api/v1/analytics", async (request) => {
    const body = request.body as { event?: string; targetType?: string; targetId?: string; summary?: string; payload?: Record<string, unknown> };
    await appendOperationalEvent({
      eventType: sanitizeSignal(String(body?.event ?? "PUBLIC_EVENT")),
      targetType: sanitizeSignal(String(body?.targetType ?? "PUBLIC")),
      targetId: String(body?.targetId ?? "unknown").slice(0, 160),
      summary: String(body?.summary ?? "Evento pubblico").slice(0, 300),
      payload: sanitizeAnalyticsPayload(body?.payload ?? {})
    });
    return { ok: true };
  });
  app.get("/api/v1/guide", async () => ({ sections: veloraGuideCatalog() }));
  app.get("/api/v1/guardian/status", async () => publicGuardianStatus());
  app.get("/api/v1/guide/:slug", async (request, reply) => {
    const slug = routeParam(request.params, "slug").toLowerCase();
    const section = veloraGuideCatalog().find((item) => item.slug === slug || item.address === `guide.${slug}`);
    if (!section) {
      return reply.notFound("guide section not found");
    }
    return { section };
  });
  app.get(`/downloads/windows/${betaInstallerName}`, async (_request, reply) => sendBetaDownload(betaInstallerName, reply));
  app.get(`/downloads/windows/${betaChecksumName}`, async (_request, reply) => sendBetaDownload(betaChecksumName, reply));
  app.get(`/downloads/macos/${macosAarch64Name}`, async (_request, reply) => sendMacosDownload(macosAarch64Name, reply));
  app.get(`/downloads/macos/${macosAarch64ChecksumName}`, async (_request, reply) => sendMacosDownload(macosAarch64ChecksumName, reply));
  app.get(`/downloads/macos/${macosX64Name}`, async (_request, reply) => sendMacosDownload(macosX64Name, reply));
  app.get(`/downloads/macos/${macosX64ChecksumName}`, async (_request, reply) => sendMacosDownload(macosX64ChecksumName, reply));
  app.get(`/downloads/mobile/${mobilePwaName}`, async (_request, reply) => sendMobileDownload(mobilePwaName, reply));
  app.get(`/downloads/mobile/${mobilePwaChecksumName}`, async (_request, reply) => sendMobileDownload(mobilePwaChecksumName, reply));
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
    if (![macosAarch64Name, macosAarch64ChecksumName, macosX64Name, macosX64ChecksumName].includes(file)) {
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
  app.get("/downloads/mobile/:file", async (request, reply) => {
    const file = routeParam(request.params, "file");
    if (file.includes("/") || file.includes("\\") || file.includes("..")) {
      return reply.notFound("download not found");
    }
    const download = await findMobileDownload(file);
    if (!download) {
      return reply.notFound("download not found");
    }
    reply.header("Content-Length", String(download.info.size));
    reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
    reply.type(file.endsWith(".zip") ? "application/zip" : "text/plain; charset=utf-8");
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
    const username = normalizeVeloraUsername(body?.username);
    if (!username || !body?.password) {
      return reply.badRequest("username and password are required");
    }

    if (await repository.findUserByUsername(username)) {
      return reply.conflict("username already exists");
    }

    const user = await repository.createUser(username, hashPassword(body.password));
    const recovery = await ensureRecoveryToken(user.id, true);
    const mail = await repository.getOrCreateVeloMailAccount(user.id, user.username);
    const session = await repository.createAuthSession(user.id);
    return {
      token: session.token,
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username, identityLevel: mail.identityLevel },
      mail,
      recovery
    };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    const username = normalizeVeloraUsername(body?.username);
    const user = username ? await findLoginUser(username, body?.username, repository) : undefined;
    if (!user || user.password !== hashPassword(body?.password ?? "")) {
      return reply.unauthorized("invalid credentials");
    }

    const mail = await repository.getOrCreateVeloMailAccount(user.id, user.username);
    const session = await repository.createAuthSession(user.id);
    const recovery = await ensureRecoveryToken(user.id, false);
    await requirePool().query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    return {
      token: session.token,
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username, identityLevel: mail.identityLevel },
      mail,
      recovery
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
  app.post("/api/v1/auth/recovery", async (request, reply) => {
    const body = request.body as { username?: string; recoveryToken?: string; newPassword?: string };
    if (!body?.username || !body?.recoveryToken || !body?.newPassword) {
      return reply.badRequest("username, recoveryToken and newPassword are required");
    }
    if (body.newPassword.length < 8) {
      return reply.badRequest("newPassword must be at least 8 characters");
    }
    const user = await repository.findUserByUsername(body.username);
    if (!user) {
      return reply.unauthorized("invalid recovery token");
    }
    const ok = await verifyRecoveryToken(user.id, body.recoveryToken);
    if (!ok) {
      return reply.unauthorized("invalid recovery token");
    }
    await requirePool().query("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(body.newPassword), user.id]);
    await appendUserEvent(user.id, "PASSWORD_RECOVERED", "USER", user.id, "Password aggiornata tramite key token personale.");
    return { ok: true, message: "Password aggiornata. Ora puoi accedere con la nuova password." };
  });

  app.get("/api/v1/auth/portal-session", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const user = await repository.findUserById(userId);
    const mail = await repository.getOrCreateVeloMailAccount(userId, user?.username);
    const profile = await buildAccountProfile(userId);
    return {
      loggedIn: true,
      user: { id: userId, username: user?.username ?? "utente", identityLevel: mail.identityLevel },
      mail: { address: mail.address, alias: mail.alias, status: mail.status },
      scopes: ["identity:read", "mail:basic", "cloud:basic", "publisher:basic"],
      devices: profile.devices.length,
      sites: profile.sites.length
    };
  });
  app.post("/api/v1/auth/recovery-token/seen", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    await requirePool().query("UPDATE users SET recovery_token_seen_at = NOW() WHERE id = $1", [userId]);
    return { ok: true };
  });

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
    return {
      id: user.id,
      username: user.username,
      identityLevel: mail.identityLevel,
      mail,
      profile: await buildAccountProfile(user.id)
    };
  });
  app.get("/api/v1/account/profile", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return buildAccountProfile(userId);
  });
  app.get("/api/v1/account/notifications", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const result = await requirePool().query("SELECT id, type, title, body, status, payload, created_at FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100", [userId]);
    return { notifications: result.rows };
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
      if (error instanceof Error && error.message === "USER_DEVICE_LIMIT_REACHED") {
        return reply.code(409).send({
          code: "USER_DEVICE_LIMIT_REACHED",
          message: "Questo account ha gia tre dispositivi attivi. Rimuovi un dispositivo dalle impostazioni prima di aggiungerne un altro."
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

    const messages = {
      AVAILABLE: `La zona ${address} risulta disponibile. Puoi inviare la richiesta di assegnazione.`,
      ASSIGNED: `La zona ${address} Ã¨ giÃ  stata assegnata. Prova un nome differente.`,
      PENDING_REVIEW: "Ãˆ giÃ  presente una richiesta per questa zona. Puoi scegliere unâ€™altra zona oppure ricevere un avviso se tornerÃ  disponibile.",
      RESERVED_NAME: "Questo nome non puÃ² essere richiesto direttamente.",
      TEMPORARILY_RESERVED: `La zona ${address} Ã¨ temporaneamente riservata.`,
      BLOCKED: `La zona ${address} Ã¨ attualmente bloccata.`,
      INVALID: "La zona inserita non Ã¨ valida."
    } as const;
    const message = messages[status as keyof typeof messages] ?? messages.INVALID;

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
    const guideResults = searchVeloraGuide(query);
    const documents = await repository.searchDocuments(query);
    return { query, results: [...guideResults, ...documents].slice(0, 35) };
  });

  app.post("/api/v1/sites/portal-prepare", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as Record<string, unknown>;
    const rawManifest = typeof body.manifest === "object" && body.manifest ? body.manifest : {
      formatVersion: 1,
      address: body.address,
      title: body.title,
      description: body.description,
      category: body.category,
      entryFile: body.entryFile || "index.html",
      languages: Array.isArray(body.languages) ? body.languages : ["it"],
      keywords: Array.isArray(body.keywords) ? body.keywords : String(body.keywords ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      version: body.version || "1.0.0",
      ageRating: body.ageRating || "EVERYONE",
      familySafe: body.familySafe !== false,
      permissions: body.permissions || {},
      allowedExternalOrigins: Array.isArray(body.allowedExternalOrigins) ? body.allowedExternalOrigins : []
    };
    const parsed = veloraManifestSchema.safeParse(rawManifest);
    const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`);
    const warnings = [];
    if (parsed.success && parsed.data.permissions.externalNetwork && parsed.data.allowedExternalOrigins.length === 0) {
      warnings.push("Hai richiesto rete esterna ma non hai indicato domini consentiti.");
    }
    if (parsed.success && parsed.data.keywords.length < 3) {
      warnings.push("Aggiungi almeno 3 keyword per migliorare la ricerca.");
    }
    const guide = parsed.success ? [
      "Crea una cartella con index.html e velora.json",
      "Inserisci velora.json generato dal portale",
      "Controlla con Publisher Validator",
      "Pubblica dal client desktop, NAS agent o nodo autorizzato",
      "Verifica apertura da Search e pagina /zone/" + parsed.data.address
    ] : [
      "Correggi gli errori del manifest",
      "Ripeti la preparazione",
      "Pubblica solo quando il validatore mostra zero errori"
    ];
    await appendUserEvent(userId, "PUBLISHER_PORTAL_PREPARE", "SITE_MANIFEST", parsed.success ? parsed.data.address : "INVALID", parsed.success ? "Manifest preparato dal portale" : "Manifest non valido", { errors, warnings });
    return {
      ready: parsed.success && errors.length === 0,
      manifest: parsed.success ? parsed.data : rawManifest,
      errors,
      warnings,
      guide,
      nextAction: parsed.success ? "READY_FOR_DESKTOP_OR_NODE_PUBLISH" : "FIX_MANIFEST"
    };
  });
  app.get("/api/v1/oceano/status", async () => repository.getOceanoStatus());
  app.post("/api/v1/oceano/submissions", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    const body = request.body as { title?: string; summary?: string; body?: string; contentType?: string; sourceUrl?: string; tags?: string[] };
    const title = String(body.title ?? "").trim();
    const summary = String(body.summary ?? "").trim();
    const content = String(body.body ?? "").trim();
    if (title.length < 3 || title.length > 140 || summary.length < 10 || summary.length > 500 || content.length < 30 || content.length > 100000) {
      return reply.badRequest("title, summary or body has an invalid length");
    }
    const id = randomUUID();
    const result = await requirePool().query(
      `INSERT INTO oceano_content_submissions (id,user_id,title,summary,body,content_type,source_url,tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status,submitted_at`,
      [id, userId, title, summary, content, String(body.contentType ?? "ARTICLE").toUpperCase(), String(body.sourceUrl ?? "").trim() || null, (body.tags ?? []).map(String).slice(0, 20)]
    );
    return reply.code(201).send({ submission: result.rows[0], message: "Contenuto inviato alla revisione Oceano." });
  });
  app.get("/api/v1/oceano/submissions/mine", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    const result = await requirePool().query(
      "SELECT id,address,title,summary,content_type,status,admin_note,submitted_at,reviewed_at,published_at FROM oceano_content_submissions WHERE user_id=$1 ORDER BY submitted_at DESC LIMIT 100",
      [userId]
    );
    return { submissions: result.rows };
  });
  app.get("/api/v1/oceano/content/:address", async (request, reply) => {
    const address = routeParam(request.params, "address").toLowerCase();
    const result = await requirePool().query(
      `SELECT address,title,summary,body,content_type,source_url,tags,published_at
       FROM oceano_content_submissions WHERE address=$1 AND status='PUBLISHED' LIMIT 1`,
      [address]
    );
    if (result.rows[0]) return { content: result.rows[0] };

    const indexed = await requirePool().query(
      `SELECT address,title,description AS summary,searchable_text AS body,category AS content_type,content_cid,updated_at AS published_at
       FROM search_documents
       WHERE lower(address)=$1 AND category='OCEANO'
       LIMIT 1`,
      [address]
    );
    if (!indexed.rows[0]) return reply.notFound("oceano content not found");
    return { content: indexed.rows[0] };
  });
  app.get("/api/v1/cloud/quota", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    return cloudQuotaForUser(userId);
  });
  app.get("/api/v1/cloud/protection", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    return cloudProtectionState(userId);
  });
  app.post("/api/v1/cloud/multisig/request", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    if (await guardianBlocksSensitiveData()) return guardianEmergencyReply(reply);
    const body = request.body as { cosignerUsername?: string };
    const cosignerUsername = String(body?.cosignerUsername ?? "").trim();
    if (!cosignerUsername || cosignerUsername.length < 3) {
      return reply.badRequest("Secondo account non valido");
    }
    return requestCloudMultisig(userId, cosignerUsername);
  });
  app.post("/api/v1/cloud/multisig/approve", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    if (await guardianBlocksSensitiveData()) return guardianEmergencyReply(reply);
    const body = request.body as { policyId?: string; actionId?: string };
    return approveCloudMultisig(userId, String(body?.policyId ?? ""), String(body?.actionId ?? ""));
  });
  app.post("/api/v1/cloud/multisig/revoke", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    return revokeCloudMultisig(userId);
  });
  app.get("/api/v1/cloud/files", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    const result = await requirePool().query(
      `SELECT id,name,mime_type,size_bytes,sha256,guardian_status,multisig_required,created_at,updated_at
       FROM velora_cloud_files
       WHERE user_id=$1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );
    return { files: result.rows, quota: await cloudQuotaForUser(userId) };
  });
  app.post("/api/v1/cloud/files", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    if (await guardianBlocksSensitiveData()) return guardianEmergencyReply(reply);
    const body = request.body as { name?: string; mimeType?: string; contentBase64?: string };
    const name = sanitizeCloudFileName(String(body?.name ?? ""));
    const contentBase64 = String(body?.contentBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
    if (!name || !/^[A-Za-z0-9._ -]{1,120}$/.test(name)) {
      return reply.badRequest("Nome file non valido");
    }
    if (!/^[A-Za-z0-9+/=]*$/.test(contentBase64)) {
      return reply.badRequest("Contenuto file non valido");
    }
    const bytes = Buffer.from(contentBase64, "base64");
    if (!bytes.length) {
      return reply.badRequest("File vuoto");
    }
    const quota = await cloudQuotaForUser(userId);
    if (quota.usedBytes + bytes.length > quota.quotaBytes) {
      return reply.code(413).send({ code: "CLOUD_QUOTA_EXCEEDED", message: "Spazio Cloud beta esaurito", quota });
    }
    const id = randomUUID();
    const sha256 = hashValue(bytes.toString("base64"));
    const activePolicy = await activeCloudMultisigPolicy(userId);
    const envelope = sealChainedPayload(bytes, config.cloudEncryptionSecret, `cloud:${userId}:${id}`);
    const result = await requirePool().query(
      `INSERT INTO velora_cloud_files (
        id,user_id,name,mime_type,size_bytes,sha256,content_base64,content_envelope,
        protection_scheme,guardian_status,multisig_required,multisig_policy_id
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'VELORA_CHAINED_REDUNDANT_V1','PROTECTED',$9,$10)
       RETURNING id,name,mime_type,size_bytes,sha256,guardian_status,multisig_required,created_at,updated_at`,
      [id, userId, name, String(body?.mimeType ?? "application/octet-stream").slice(0, 120), bytes.length, sha256, "", JSON.stringify(envelope), Boolean(activePolicy), activePolicy?.id ?? null]
    );
    return reply.code(201).send({ file: result.rows[0], quota: await cloudQuotaForUser(userId) });
  });
  app.get("/api/v1/cloud/files/:id/download", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    if (await guardianBlocksSensitiveData()) return guardianEmergencyReply(reply);
    const fileId = routeParam(request.params, "id");
    const approval = await ensureCloudMultisigAction(userId, fileId, "DOWNLOAD");
    if (!approval.allowed) {
      return reply.code(423).send(approval);
    }
    const result = await requirePool().query(
      `SELECT id,name,mime_type,content_base64,content_envelope,protection_scheme,size_bytes FROM velora_cloud_files WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1`,
      [fileId, userId]
    );
    if (!result.rows[0]) return reply.notFound("cloud file not found");
    const row = result.rows[0];
    const bytes = openCloudFileBytes(userId, row);
    reply.header("Content-Length", String(row.size_bytes));
    reply.header("Content-Disposition", `attachment; filename="${basename(String(row.name))}"`);
    reply.type(String(row.mime_type ?? "application/octet-stream"));
    return reply.send(bytes);
  });
  app.delete("/api/v1/cloud/files/:id", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) return;
    if (await guardianBlocksSensitiveData()) return guardianEmergencyReply(reply);
    const fileId = routeParam(request.params, "id");
    const approval = await ensureCloudMultisigAction(userId, fileId, "DELETE");
    if (!approval.allowed) {
      return reply.code(423).send(approval);
    }
    await requirePool().query("UPDATE velora_cloud_files SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND user_id=$2", [fileId, userId]);
    return { ok: true, quota: await cloudQuotaForUser(userId) };
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
  app.get("/api/admin/overview", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return buildAdminOverview();
  });
  app.get("/api/admin/users", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query(
      `SELECT u.id, u.username, u.created_at, u.last_login_at,
              vm.address AS mail_address,
              COUNT(DISTINCT d.id)::int AS devices,
              COUNT(DISTINCT sr.id)::int AS releases
       FROM users u
       LEFT JOIN velomail_accounts vm ON vm.user_id = u.id
       LEFT JOIN devices d ON d.user_id = u.id
       LEFT JOIN navigation_zones nz ON nz.owner_user_id = u.id
       LEFT JOIN site_releases sr ON sr.zone_id = nz.id
       GROUP BY u.id, vm.address
       ORDER BY u.created_at DESC
       LIMIT 250`
    );
    return { users: result.rows };
  });
  app.get("/api/admin/sites", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query(
      `SELECT nz.address, nz.status AS zone_status, u.username AS owner,
              sr.id AS release_id, sr.version, sr.status AS release_status, sr.content_cid, sr.created_at
       FROM navigation_zones nz
       LEFT JOIN users u ON u.id = nz.owner_user_id
       LEFT JOIN LATERAL (
         SELECT * FROM site_releases sr WHERE sr.zone_id = nz.id ORDER BY sr.created_at DESC LIMIT 1
       ) sr ON TRUE
       ORDER BY COALESCE(sr.created_at, nz.created_at) DESC
       LIMIT 250`
    );
    return { sites: result.rows };
  });
  app.get("/api/admin/oceano/submissions", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) return;
    const result = await requirePool().query(
      `SELECT o.id,o.address,o.title,o.summary,o.content_type,o.source_url,o.tags,o.status,o.admin_note,o.submitted_at,o.reviewed_at,o.published_at,u.username
       FROM oceano_content_submissions o JOIN users u ON u.id=o.user_id ORDER BY o.submitted_at DESC LIMIT 250`
    );
    return { submissions: result.rows };
  });
  app.post("/api/admin/oceano/submissions/:id/decision", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const body = request.body as { decision?: string; note?: string };
    const decision = String(body.decision ?? "").toUpperCase();
    if (!['APPROVED','REJECTED','CHANGES_REQUIRED'].includes(decision)) return reply.badRequest("invalid decision");
    const client = await requirePool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query("SELECT * FROM oceano_content_submissions WHERE id=$1 FOR UPDATE", [routeParam(request.params, "id")]);
      if (!current.rows[0]) { await client.query('ROLLBACK'); return reply.notFound("submission not found"); }
      const row = current.rows[0];
      const published = decision === 'APPROVED';
      const address = row.address ?? `oceano.${String(row.id).replace(/-/g, '').slice(0, 16)}`;
      const status = published ? 'PUBLISHED' : decision;
      await client.query(
        `UPDATE oceano_content_submissions SET address=$2,status=$3,admin_note=$4,reviewed_by=$5,reviewed_at=NOW(),published_at=CASE WHEN $6 THEN NOW() ELSE published_at END WHERE id=$1`,
        [row.id, address, status, String(body.note ?? '').trim() || null, admin.adminId, published]
      );
      if (published) {
        const searchable = `${row.title} ${row.summary} ${row.body} ${(row.tags ?? []).join(' ')}`;
        await client.query(
          `INSERT INTO search_documents (id,zone_id,release_id,address,category,slug,title,description,keywords,languages,headings,searchable_text,publisher,age_rating,family_safe,content_cid,release_version,trust_level,availability)
           VALUES ($1,NULL,NULL,$2,'OCEANO',$3,$4,$5,$6,'["it"]',$7,$8,'Velora Oceano','EVERYONE',true,$9,'1.0.0',50,1)
           ON CONFLICT DO NOTHING`,
          [randomUUID(), address, address.split('.')[1], row.title, row.summary, JSON.stringify(row.tags ?? []), JSON.stringify([row.title]), searchable, `oceano:${row.id}`]
        );
      }
      await client.query('COMMIT');
      return { id: row.id, address, status };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  app.get("/api/admin/reports", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const [spam, moderation] = await Promise.all([
      requirePool().query("SELECT * FROM velomail_spam_reports ORDER BY created_at DESC LIMIT 100").catch(() => ({ rows: [] })),
      requirePool().query("SELECT * FROM forum_moderation_actions ORDER BY created_at DESC LIMIT 100").catch(() => ({ rows: [] }))
    ]);
    return { mailSpam: spam.rows, forumModeration: moderation.rows };
  });
  app.get("/api/admin/audit", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const [audit, operational] = await Promise.all([
      requirePool().query("SELECT id, admin_id, action, target_type, target_id, reason, previous_hash, entry_hash, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200"),
      requirePool().query("SELECT id, actor_user_id, actor_admin_id, event_type, target_type, target_id, summary, severity, created_at FROM operational_events ORDER BY created_at DESC LIMIT 200").catch(() => ({ rows: [] }))
    ]);
    return { audit: audit.rows, operational: operational.rows };
  });
  app.get("/api/admin/health", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const status = await betaLogicalNodeCluster.status();
    const ops = await buildOpsStatus();
    return {
      api: "OK",
      database: "OK",
      nodes: status,
      storage: {
        mode: process.env.VELORA_STORAGE_PROVIDER ?? "local/heroku-filesystem-beta",
        externalConfigured: Boolean(process.env.S3_BUCKET || process.env.VELORA_STORAGE_BUCKET),
        note: "Per distribuzione globale usare storage esterno/CDN; Heroku filesystem non e storage persistente."
      },
      backups: {
        configured: Boolean(process.env.HEROKU_API_KEY || process.env.DATABASE_BACKUP_URL),
        restoreTested: process.env.VELORA_BACKUP_RESTORE_TESTED === "true",
        latest: ops.latestBackup,
        latestRestoreTest: ops.latestRestoreTest
      },
      uptimeMonitor: {
        configured: Boolean(process.env.VELORA_UPTIME_MONITOR_URL),
        urlPresent: Boolean(process.env.VELORA_UPTIME_MONITOR_URL),
        latest: ops.latestUptime
      },
      operations: ops
    };
  });
  app.get("/api/admin/ops/status", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return buildOpsStatus();
  });
  app.post("/api/admin/ops/backup-record", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { status?: string; backupRef?: string; note?: string; metadata?: Record<string, unknown> };
    const status = normalizeChoice(body.status, ["REQUESTED", "COMPLETED", "FAILED", "RESTORE_TESTED"], "REQUESTED");
    const result = await requirePool().query(
      `INSERT INTO database_backup_events (id, admin_id, kind, status, backup_ref, note, metadata_json)
       VALUES ($1,$2,'BACKUP',$3,$4,$5,$6)
       RETURNING *`,
      [randomUUID(), admin.adminId, status, String(body.backupRef ?? "").trim() || null, String(body.note ?? "").trim() || null, JSON.stringify(body.metadata ?? {})]
    );
    await appendOperationalAudit(admin.adminId, `DATABASE_BACKUP_${status}`, "DATABASE", result.rows[0].id, String(body.note ?? "Backup record"));
    return { event: result.rows[0], status: await buildOpsStatus() };
  });
  app.post("/api/admin/ops/restore-test-record", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { status?: string; backupRef?: string; restoreTarget?: string; note?: string; metadata?: Record<string, unknown> };
    const status = normalizeChoice(body.status, ["REQUESTED", "COMPLETED", "FAILED"], "REQUESTED");
    const result = await requirePool().query(
      `INSERT INTO database_backup_events (id, admin_id, kind, status, backup_ref, restore_target, note, metadata_json)
       VALUES ($1,$2,'RESTORE_TEST',$3,$4,$5,$6,$7)
       RETURNING *`,
      [randomUUID(), admin.adminId, status, String(body.backupRef ?? "").trim() || null, String(body.restoreTarget ?? "").trim() || "test", String(body.note ?? "").trim() || null, JSON.stringify(body.metadata ?? {})]
    );
    await appendOperationalAudit(admin.adminId, `DATABASE_RESTORE_TEST_${status}`, "DATABASE", result.rows[0].id, String(body.note ?? "Restore test record"));
    return { event: result.rows[0], status: await buildOpsStatus() };
  });
  app.post("/api/admin/ops/uptime-check", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const started = Date.now();
    try {
      const health = config.betaNodeClusterEnabled ? await betaLogicalNodeCluster.publicStatus() : { ok: true, service: "velora-api", network: "cluster disattivato" };
      const latencyMs = Date.now() - started;
      const result = await requirePool().query(
        `INSERT INTO uptime_checks (id, source, status, latency_ms, health_json)
         VALUES ($1,'admin-manual','OK',$2,$3)
         RETURNING *`,
        [randomUUID(), latencyMs, JSON.stringify(health)]
      );
      await appendOperationalAudit(admin.adminId, "UPTIME_CHECK_OK", "UPTIME", result.rows[0].id, "Controllo uptime manuale");
      return { check: result.rows[0], status: await buildOpsStatus() };
    } catch (error) {
      const result = await requirePool().query(
        `INSERT INTO uptime_checks (id, source, status, latency_ms, error_message)
         VALUES ($1,'admin-manual','FAILED',$2,$3)
         RETURNING *`,
        [randomUUID(), Date.now() - started, sanitizeError(error instanceof Error ? error.message : "uptime failed")]
      );
      return reply.code(503).send({ check: result.rows[0], status: await buildOpsStatus() });
    }
  });
  app.get("/api/admin/guardian", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    return adminGuardianStatus();
  });
  app.post("/api/admin/guardian/signal", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { level?: number; signal?: string; targetType?: string; targetId?: string; detail?: string };
    return registerGuardianSignal({
      level: Number(body?.level ?? 1),
      signal: String(body?.signal ?? "ADMIN_SIGNAL"),
      source: "ADMIN",
      actorAdminId: admin.adminId,
      targetType: String(body?.targetType ?? "SYSTEM"),
      targetId: body?.targetId ? String(body.targetId) : undefined,
      detail: String(body?.detail ?? "")
    });
  });
  app.post("/api/admin/guardian/reset", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    await requirePool().query(
      `UPDATE guardian_security_state
       SET breached_levels = 0, emergency_mode = FALSE, last_signal = $1, last_signal_at = NOW(), updated_at = NOW()
       WHERE id = 'global'`,
      [`RESET_BY_ADMIN:${admin.adminId}`]
    );
    await appendGuardianEvent({ level: 1, signal: "RESET", source: "ADMIN", actorAdminId: admin.adminId, targetType: "SYSTEM", detail: "Guardian reset admin" });
    return adminGuardianStatus();
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

  app.get("/api/v1/execution/targets", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    return executionTargets(userId);
  });

  app.get("/api/v1/execution/operations", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const result = await requirePool().query(
      `SELECT id, operation, target_type, target_id, requested_state, accepted_state, status, error_message, timeout_at, accepted_at, started_at, completed_at, failed_at, created_at, updated_at
       FROM remote_execution_operations
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );
    return { operations: result.rows };
  });

  app.post("/api/v1/execution/operations", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { operation?: string; targetType?: string; targetId?: string; requestedState?: string; payload?: Record<string, unknown>; idempotencyKey?: string };
    return createExecutionOperation(userId, body, reply);
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
        minerConfig: buildMinerConfigResponse(worker.rows[0]),
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

  app.post("/api/v1/mining/payout-requests", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const body = request.body as { coin?: string; devicePeerId?: string; payoutWallet?: string; note?: string };
    const coin = normalizeChoice(body.coin, ["XMR", "ZEPH"], "");
    const payoutWallet = String(body.payoutWallet ?? "").trim();
    if (!coin || !body.devicePeerId || !payoutWallet) {
      return reply.badRequest("coin, devicePeerId and payoutWallet are required");
    }
    if (!isLikelyCoinAddress(coin, payoutWallet)) {
      return reply.badRequest("payoutWallet is not valid enough");
    }
    const pool = requirePool();
    const worker = await pool.query(
      `SELECT mw.id
       FROM mining_workers mw
       JOIN mining_devices md ON md.id = mw.mining_device_id
       WHERE md.user_id = $1 AND md.device_peer_id = $2 AND mw.coin = $3
       ORDER BY mw.updated_at DESC
       LIMIT 1`,
      [userId, body.devicePeerId, coin]
    );
    const result = await pool.query(
      `INSERT INTO mining_payout_requests (id, user_id, worker_id, coin, payout_wallet, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, coin, payout_wallet, status, requested_at`,
      [randomUUID(), userId, worker.rows[0]?.id ?? null, coin, payoutWallet, String(body.note ?? "").slice(0, 500)]
    );
    return { request: result.rows[0], message: "Richiesta payout ricevuta. Verifica manuale in pannello admin." };
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
       WHERE (mw.id::text = $1 OR mw.worker_id = $1) AND md.user_id = $2`,
      [routeParam(request.params, "id"), userId]
    );
    const worker = result.rows[0];
    if (!worker) {
      return reply.notFound("worker not found");
    }
    if (worker.status !== "ENABLED") {
      return reply.failedDependency("worker is not enabled; complete accounting and consent first");
    }
    return buildMinerConfigResponse(worker);
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

  app.get("/api/admin/mining/payout-requests", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const result = await requirePool().query(
      `SELECT mpr.id, mpr.coin, mpr.payout_wallet, mpr.status, mpr.note, mpr.admin_note, mpr.requested_at, mpr.reviewed_at,
              u.username, mw.worker_id
       FROM mining_payout_requests mpr
       JOIN users u ON u.id = mpr.user_id
       LEFT JOIN mining_workers mw ON mw.id = mpr.worker_id
       ORDER BY mpr.requested_at DESC
       LIMIT 200`
    );
    return { requests: result.rows.map((row) => ({ ...row, payout_wallet: maskWallet(String(row.payout_wallet ?? "")) })) };
  });
  app.post("/api/admin/mining/payout-requests/:id/decision", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) {
      return;
    }
    const body = request.body as { status?: string; adminNote?: string; txHash?: string };
    const status = normalizeChoice(body.status, ["APPROVED", "HOLD", "REJECTED", "PAID"], "");
    if (!status || !body.adminNote) {
      return reply.badRequest("status and adminNote are required");
    }
    if (status === "PAID" && !String(body.txHash ?? "").trim()) {
      return reply.badRequest("txHash is required when marking payout as PAID");
    }
    const result = await requirePool().query(
      `UPDATE mining_payout_requests
       SET status = $1,
           admin_note = $2,
           admin_id = $3,
           payout_tx_hash = COALESCE(NULLIF($4,''), payout_tx_hash),
           decided_at = NOW(),
           paid_at = CASE WHEN $1 = 'PAID' THEN NOW() ELSE paid_at END
       WHERE id = $5
       RETURNING id, user_id, coin, status, payout_tx_hash`,
      [status, body.adminNote, admin.adminId, String(body.txHash ?? "").trim(), routeParam(request.params, "id")]
    );
    const row = result.rows[0];
    if (!row) {
      return reply.notFound("payout request not found");
    }
    if (status === "PAID") {
      await requirePool().query(
        `UPDATE mining_ledger
         SET status = 'PAID', payout_tx_hash = $1, confirmations = GREATEST(confirmations, 1)
         WHERE worker_id IN (SELECT worker_id FROM mining_payout_requests WHERE id = $2 AND worker_id IS NOT NULL)
           AND status IN ('PENDING','PENDING_PAYOUT','PENDING_PAYOUT_DISABLED')`,
        [String(body.txHash ?? "").trim(), row.id]
      );
    }
    await appendOperationalAudit(admin.adminId, `MINING_PAYOUT_${status}`, "MINING_PAYOUT_REQUEST", row.id, body.adminNote);
    await notifyUser(row.user_id, "MINING_PAYOUT", `Payout mining ${status}`, status === "PAID" ? `Payout ${row.coin} segnato come pagato. TX: ${row.payout_tx_hash}` : body.adminNote, { payoutRequestId: row.id, status, txHash: row.payout_tx_hash });
    return { request: row };
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

  app.get("/api/admin/mining/accounting", async (request, reply) => {
    if (!(await requireAdminSession(request, reply))) {
      return;
    }
    const pool = requirePool();
    const summary = await buildMiningNetworkStats();
    const workers = await pool.query(
      `SELECT
        mw.id,
        mw.worker_id,
        mw.coin,
        mw.status,
        mw.accounting_period,
        mw.payout_wallet,
        u.username,
        COALESCE(SUM(CASE WHEN mps.status = 'ACCEPTED' THEN 1 ELSE 0 END),0)::int AS accepted_pool_shares,
        COALESCE(SUM(CASE WHEN mps.status = 'REJECTED' THEN 1 ELSE 0 END),0)::int AS rejected_pool_shares,
        COALESCE(SUM(CASE WHEN mps.status = 'STALE' THEN 1 ELSE 0 END),0)::int AS stale_pool_shares,
        COALESCE(SUM(CASE WHEN mps.status = 'ACCEPTED' THEN mps.difficulty_atomic ELSE 0 END),0)::text AS accepted_difficulty_atomic,
        COALESCE(SUM(ml.user_atomic_amount),0)::text AS user_atomic_total,
        COALESCE(SUM(CASE WHEN ml.status IN ('PENDING','PENDING_PAYOUT','PENDING_PAYOUT_DISABLED') THEN ml.user_atomic_amount ELSE 0 END),0)::text AS user_atomic_pending,
        COALESCE(SUM(CASE WHEN ml.status = 'PAID' THEN ml.user_atomic_amount ELSE 0 END),0)::text AS user_atomic_paid,
        MAX(mps.submitted_at) AS last_pool_share_at,
        MAX(ml.created_at) AS last_ledger_at
       FROM mining_workers mw
       JOIN mining_devices md ON md.id = mw.mining_device_id
       JOIN users u ON u.id = md.user_id
       LEFT JOIN mining_pool_shares mps ON mps.worker_id = mw.id
       LEFT JOIN mining_ledger ml ON ml.worker_id = mw.id
       GROUP BY mw.id, mw.worker_id, mw.coin, mw.status, mw.accounting_period, mw.payout_wallet, u.username
       ORDER BY MAX(COALESCE(mps.submitted_at, ml.created_at, mw.updated_at)) DESC NULLS LAST
       LIMIT 250`
    );
    return {
      summary,
      threshold: miningThresholdPayload(),
      workers: workers.rows.map(mapMiningProgressRow),
      note: "Le ricompense reali compaiono solo dopo import share pool e riconciliazione pagamento pool. Hashrate client non genera accrediti."
    };
  });

  app.get("/api/v1/mining/progress", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const pool = requirePool();
    const result = await pool.query(
      `SELECT
        mw.id,
        mw.worker_id,
        mw.coin,
        mw.status,
        mw.payout_wallet,
        COALESCE(SUM(CASE WHEN mps.status = 'ACCEPTED' THEN 1 ELSE 0 END),0)::int AS accepted_pool_shares,
        COALESCE(SUM(CASE WHEN mps.status = 'REJECTED' THEN 1 ELSE 0 END),0)::int AS rejected_pool_shares,
        COALESCE(SUM(CASE WHEN mps.status = 'STALE' THEN 1 ELSE 0 END),0)::int AS stale_pool_shares,
        COALESCE(SUM(CASE WHEN mps.status = 'ACCEPTED' THEN mps.difficulty_atomic ELSE 0 END),0)::text AS accepted_difficulty_atomic,
        COALESCE(SUM(ml.user_atomic_amount),0)::text AS user_atomic_total,
        COALESCE(SUM(CASE WHEN ml.status IN ('PENDING','PENDING_PAYOUT','PENDING_PAYOUT_DISABLED') THEN ml.user_atomic_amount ELSE 0 END),0)::text AS user_atomic_pending,
        COALESCE(SUM(CASE WHEN ml.status = 'PAID' THEN ml.user_atomic_amount ELSE 0 END),0)::text AS user_atomic_paid,
        MAX(mps.submitted_at) AS last_pool_share_at,
        MAX(ml.created_at) AS last_ledger_at
       FROM mining_workers mw
       JOIN mining_devices md ON md.id = mw.mining_device_id
       LEFT JOIN mining_pool_shares mps ON mps.worker_id = mw.id
       LEFT JOIN mining_ledger ml ON ml.worker_id = mw.id
       WHERE md.user_id = $1
       GROUP BY mw.id, mw.worker_id, mw.coin, mw.status, mw.payout_wallet
       ORDER BY mw.updated_at DESC`,
      [userId]
    );
    return {
      threshold: miningThresholdPayload(),
      workers: result.rows.map(mapMiningProgressRow),
      note: "Il progresso payout aumenta solo dopo share pool importate e pagamento pool riconciliato. Hashrate locale e tempo attivo sono diagnostici."
    };
  });
  app.get("/api/v1/mining/history", async (request, reply) => {
    const userId = await requireSessionUserId(request, reply);
    if (!userId) {
      return;
    }
    const pool = requirePool();
    const [workers, metrics, payouts, ledger] = await Promise.all([
      pool.query(
        `SELECT mw.id, mw.worker_id, mw.coin, mw.status, mw.payout_wallet, mw.updated_at, md.device_peer_id
         FROM mining_workers mw
         JOIN mining_devices md ON md.id = mw.mining_device_id
         WHERE md.user_id = $1
         ORDER BY mw.updated_at DESC LIMIT 50`,
        [userId]
      ),
      pool.query(
        `SELECT mdm.coin, mdm.observed_hashrate_hs, mdm.accepted_shares, mdm.rejected_shares, mdm.stale_shares, mdm.created_at
         FROM mining_device_metrics mdm
         JOIN mining_devices md ON md.id = mdm.mining_device_id
         WHERE md.user_id = $1
         ORDER BY mdm.created_at DESC LIMIT 100`,
        [userId]
      ),
      pool.query("SELECT id, coin, payout_wallet, status, note, admin_note, payout_tx_hash, requested_at, decided_at, paid_at FROM mining_payout_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 100", [userId]),
      pool.query(
        `SELECT ml.coin, ml.user_atomic_amount, ml.status, ml.payout_tx_hash, ml.created_at
         FROM mining_ledger ml
         JOIN mining_workers mw ON mw.id = ml.worker_id
         JOIN mining_devices md ON md.id = mw.mining_device_id
         WHERE md.user_id = $1
         ORDER BY ml.created_at DESC LIMIT 100`,
        [userId]
      )
    ]);
    return {
      workers: workers.rows.map(mapMiningWorker),
      metrics: metrics.rows,
      payoutRequests: payouts.rows.map((row) => ({ ...row, payout_wallet: maskWallet(String(row.payout_wallet ?? "")) })),
      ledger: ledger.rows,
      explanation: "Stai contribuendo al mining collettivo Velora. Le metriche mostrano attivita locale e pool; il ledger mostra solo importi verificati."
    };
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

async function sendMobileDownload(file: string, reply: FastifyReply) {
  const download = await findMobileDownload(file);
  if (!download) {
    return reply.notFound("download not found");
  }

  reply.header("Content-Length", String(download.info.size));
  reply.header("Content-Disposition", `attachment; filename="${basename(download.path)}"`);
  reply.type(file.endsWith(".zip") ? "application/zip" : "text/plain; charset=utf-8");
  return reply.send(createReadStream(download.path));
}

async function findMobileDownload(file: string) {
  for (const root of mobileDownloadRoots) {
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

function adminPage() {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Velora Admin</title>
  <style>
    :root{--bg:#071522;--panel:#10283d;--panel2:#0b1d2c;--line:#284760;--gold:#e8c469;--ink:#f3f7fb;--muted:#a9bed0;--green:#31e79f;--red:#ff9d8c}
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at top left,#173f5f,transparent 34%),var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 28px;border-bottom:1px solid var(--line);background:rgba(5,14,23,.78);position:sticky;top:0;z-index:2;backdrop-filter:blur(16px)}
    h1,h2,h3,p{margin-top:0} h1{font-size:28px;letter-spacing:.04em} h2{font-size:20px} a{color:var(--gold)}
    main{display:grid;gap:18px;padding:24px;max-width:1440px;margin:auto}
    .login,.grid section{border:1px solid var(--line);border-radius:22px;background:linear-gradient(160deg,rgba(16,40,61,.96),rgba(7,21,34,.92));box-shadow:0 24px 70px rgba(0,0,0,.25)}
    .login{display:grid;gap:12px;padding:18px}.login-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px}
    input,button{border:1px solid var(--line);border-radius:14px;padding:12px 14px;font:inherit;color:var(--ink);background:#07131e}
    button{cursor:pointer;background:linear-gradient(135deg,#24465f,#142c42);font-weight:800}button.primary{background:linear-gradient(135deg,var(--gold),#f6de91);color:#09131d;border-color:transparent}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.wide{grid-column:1/-1}
    section{padding:18px}.status{color:var(--muted)}.ok{color:var(--green)}.bad{color:var(--red)}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.04);padding:14px}.card b{display:block;color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.card span{font-size:24px;font-weight:900}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid rgba(255,255,255,.08);padding:10px}th{color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:.06em}td{color:#dce8f2}
    code,pre{white-space:pre-wrap;overflow:auto;color:#dce8f2}.empty{color:var(--muted);padding:12px;border:1px dashed var(--line);border-radius:14px}
    @media(max-width:900px){.grid,.cards{grid-template-columns:1fr}.login-row{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header>
    <div><h1>VELORA ADMIN</h1><p class="status">Pannello protetto per payout, nodi, mining e richieste siti</p></div>
    <a href="/status">Status pubblico</a>
  </header>
  <main>
    <section class="login">
      <h2>Login admin</h2>
      <div class="login-row">
        <input id="token" type="password" placeholder="Incolla admin bearer token">
        <button class="primary" id="save">Entra</button>
        <button id="logout">Esci</button>
      </div>
      <p id="authState" class="status">Token non caricato</p>
    </section>
    <div class="grid">
      <section class="wide">
        <h2>Panoramica</h2>
        <div class="cards" id="overview"></div>
      </section>
      <section class="wide">
        <h2>Mobile e release</h2>
        <div id="mobileRelease"></div>
      </section>
      <section>
        <h2>Richieste payout mining</h2>
        <div id="payouts"></div>
      </section>
      <section>
        <h2>Mining</h2>
        <div id="mining"></div>
      </section>
      <section>
        <h2>Nodi beta</h2>
        <div id="betaNodes"></div>
      </section>
      <section>
        <h2>Nodi utenti</h2>
        <div id="userNodes"></div>
      </section>
      <section>
        <h2>Richieste siti</h2>
        <div id="zoneRequests"></div>
      </section>
      <section>
        <h2>Crediti</h2>
        <div id="credits"></div>
      </section>
      <section>
        <h2>Utenti</h2>
        <div id="users"></div>
      </section>
      <section>
        <h2>Siti pubblicati</h2>
        <div id="sites"></div>
      </section>
      <section class="wide">
        <h2>Revisione contenuti Oceano</h2>
        <div id="oceanoReviews"></div>
      </section>
      <section>
        <h2>Segnalazioni</h2>
        <div id="reports"></div>
      </section>
      <section>
        <h2>Audit e sicurezza</h2>
        <div id="audit"></div>
      </section>
      <section class="wide">
        <h2>Velora Guardian</h2>
        <div id="guardian"></div>
      </section>
      <section class="wide">
        <h2>Health admin</h2>
        <div id="adminHealth"></div>
      </section>
      <section class="wide">
        <h2>Backup, restore e uptime</h2>
        <div id="opsStatus"></div>
      </section>
    </div>
  </main>
  <script>
    const tokenInput = document.getElementById('token');
    const authState = document.getElementById('authState');
    const tokenKey = 'velora.admin.token';
    tokenInput.value = localStorage.getItem(tokenKey) || '';
    document.getElementById('save').onclick = () => { localStorage.setItem(tokenKey, tokenInput.value.trim()); loadAll(); };
    document.getElementById('logout').onclick = () => { localStorage.removeItem(tokenKey); tokenInput.value = ''; authState.textContent = 'Token rimosso'; };

    function authHeaders() {
      const token = localStorage.getItem(tokenKey) || tokenInput.value.trim();
      return token ? { Authorization: 'Bearer ' + token } : {};
    }
    async function postJson(path, body) {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body || {}) });
      if (!response.ok) throw new Error(path + ' -> ' + response.status);
      return response.json();
    }    async function getJson(path) {
      const response = await fetch(path, { headers: authHeaders() });
      if (!response.ok) throw new Error(path + ' -> ' + response.status);
      return response.json();
    }
    function cell(value) {
      if (value === null || value === undefined || value === '') return '-';
      if (typeof value === 'object') return '<code>' + escapeHtml(JSON.stringify(value)) + '</code>';
      return escapeHtml(String(value));
    }
    function escapeHtml(value) {
      return value.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
    }
    function table(rows, columns) {
      if (!rows || rows.length === 0) return '<div class="empty">Nessun dato</div>';
      return '<table><thead><tr>' + columns.map((column) => '<th>' + column[1] + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + columns.map((column) => '<td>' + cell(row[column[0]]) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>';
    }
    function showError(id, error) {
      document.getElementById(id).innerHTML = '<p class="bad">' + escapeHtml(error.message) + '</p>';
    }
    async function loadAll() {
      const token = localStorage.getItem(tokenKey) || tokenInput.value.trim();
      if (!token) {
        authState.textContent = 'Incolla token admin per accedere';
        return;
      }
      authState.textContent = 'Caricamento dati admin';
      try {
        const session = await postJson('/api/v1/control/session/refresh');
        authState.innerHTML = '<span class="ok">Accesso admin attivo</span> ' + escapeHtml(session.adminId || '');
      } catch (error) {
        authState.innerHTML = '<span class="bad">Token non valido o scaduto</span>';
        return;
      }
      loadOverview();
      loadMobileRelease();
      loadPayouts();
      loadMining();
      loadBetaNodes();
      loadUserNodes();
      loadZoneRequests();
      loadCredits();
      loadUsers();
      loadSites();
      loadOceanoReviews();
      loadReports();
      loadAudit();
      loadGuardian();
      loadAdminHealth();
      loadOpsStatus();
    }
    async function loadOverview() {
      try {
        const data = await getJson('/api/admin/overview');
        const cards = [
          ['Zone pending', data.dashboard?.pendingZoneRequests || 0],
          ['Zone attive', data.dashboard?.activeZones || 0],
          ['Utenti', data.dashboard?.users || 0],
          ['Payout richieste', (data.payoutRequests || []).reduce((sum,row)=>sum + Number(row.count || 0),0)],
          ['Nodi', (data.nodes || []).reduce((sum,row)=>sum + Number(row.count || 0),0)],
          ['Segnalazioni', Number(data.reports?.count || 0)]
        ];
        document.getElementById('overview').innerHTML = cards.map((item) => '<div class="card"><b>' + item[0] + '</b><span>' + item[1] + '</span></div>').join('');
      } catch (error) { showError('overview', error); }
    }
    async function loadMobileRelease() {
      try {
        const [manifest, guardian] = await Promise.all([fetch('/release-manifest.json').then(r => r.json()), fetch('/api/v1/guardian/status').then(r => r.json())]);
        const platforms = manifest.platforms || {};
        const rows = Object.keys(platforms).map((key) => ({ platform: key, available: platforms[key].available, size: platforms[key].size, sha256: platforms[key].sha256, downloadUrl: platforms[key].downloadUrl }));
        document.getElementById('mobileRelease').innerHTML =
          '<div class="cards"><div class="card"><b>Versione</b><span>' + escapeHtml(manifest.version || '-') + '</span></div><div class="card"><b>Guardian</b><span>' + escapeHtml(guardian.status || '-') + '</span></div><div class="card"><b>Mobile</b><span>' + escapeHtml(platforms['mobile-pwa']?.available ? 'Attivo' : 'Verifica') + '</span></div><div class="card"><b>Canale</b><span>' + escapeHtml(manifest.channel || '-') + '</span></div></div>' +
          table(rows, [['platform','Piattaforma'],['available','Disponibile'],['size','Byte'],['sha256','SHA-256'],['downloadUrl','Link']]) +
          '<p><a class="primary" href="/portal" target="_blank">Apri Portale Velora</a> <a href="/download" target="_blank">Pagina download</a></p>';
      } catch (error) { showError('mobileRelease', error); }
    }
    async function loadPayouts() {
      try {
        const data = await getJson('/api/admin/mining/payout-requests');
        document.getElementById('payouts').innerHTML =
          table(data.requests, [['requested_at','Data'],['username','Utente'],['coin','Coin'],['payout_wallet','Wallet'],['status','Stato'],['note','Nota'],['worker_id','Worker']]) +
          '<h3>Decisione payout</h3><p class="status">Inserisci ID richiesta, scegli stato e conferma. TX hash obbligatorio per PAID.</p>' +
          '<input id="payoutId" placeholder="ID richiesta"><input id="payoutStatus" placeholder="APPROVED / HOLD / REJECTED / PAID"><input id="payoutTx" placeholder="TX hash se pagato"><input id="payoutNote" placeholder="Nota admin">' +
          '<button class="primary" onclick="decidePayout()">Conferma payout</button>';
      } catch (error) { showError('payouts', error); }
    }
    async function decidePayout() {
      const id = document.getElementById('payoutId').value.trim();
      const status = document.getElementById('payoutStatus').value.trim();
      const txHash = document.getElementById('payoutTx').value.trim();
      const adminNote = document.getElementById('payoutNote').value.trim() || 'Decisione manuale admin';
      if (!id || !status) return alert('ID richiesta e stato obbligatori');
      if (!confirm('Confermi decisione payout ' + status + '?')) return;
      await postJson('/api/admin/mining/payout-requests/' + encodeURIComponent(id) + '/decision', { status, txHash, adminNote });
      await loadPayouts();
      await loadMining();
    }
    async function loadMining() {
      try {
        const diagnostics = await getJson('/api/admin/mining/diagnostics');
        const network = await getJson('/api/admin/mining/network');
        const accounting = await getJson('/api/admin/mining/accounting');
        document.getElementById('mining').innerHTML =
          '<h3>Quanto hanno minato</h3>' +
          '<p class="status">Soglia payout: ' + escapeHtml(accounting.threshold.xmrLabel) + '</p>' +
          table(accounting.workers || [], [['username','Utente'],['coin','Coin'],['worker_id','Worker'],['accepted_pool_shares','Share ok'],['rejected_pool_shares','Share ko'],['stale_pool_shares','Stale'],['pending_label','Da pagare'],['paid_label','Pagato'],['payout_threshold_label','Soglia'],['payout_progress_percent','% soglia'],['payout_ready','Pronto'],['accounting_note','Nota']]) +
          '<h3>Diagnostica</h3><pre>' + escapeHtml(JSON.stringify(diagnostics, null, 2)) + '</pre><h3>Network</h3><pre>' + escapeHtml(JSON.stringify(network, null, 2)) + '</pre>';
      } catch (error) { showError('mining', error); }
    }
    async function loadBetaNodes() {
      try {
        const data = await getJson('/api/admin/beta-nodes');
        document.getElementById('betaNodes').innerHTML = table(data.nodes || [], [['name','Nome'],['role','Ruolo'],['status','Stato'],['lastHeartbeatAt','Heartbeat'],['failureCount','Fail']]);
      } catch (error) { showError('betaNodes', error); }
    }
    async function loadUserNodes() {
      try {
        const data = await getJson('/api/admin/contribution/nodes');
        document.getElementById('userNodes').innerHTML = table(data.nodes || [], [['username','Utente'],['module','Modulo'],['status','Stato'],['devicePeerId','Peer'],['lastHeartbeatAt','Heartbeat']]);
      } catch (error) { showError('userNodes', error); }
    }
    async function loadZoneRequests() {
      try {
        const data = await getJson('/api/v1/control/zone-requests');
        document.getElementById('zoneRequests').innerHTML = table(data.requests || data || [], [['createdAt','Data'],['requestedAddress','Indirizzo'],['status','Stato'],['category','Categoria'],['requesterUserId','Utente']]);
      } catch (error) { showError('zoneRequests', error); }
    }
    async function loadCredits() {
      try {
        const data = await getJson('/api/admin/credits/requests');
        document.getElementById('credits').innerHTML = table(data.requests || [], [['created_at','Data'],['username','Utente'],['amount_cents','Importo cent'],['status','Stato'],['requested_use','Uso']]);
      } catch (error) { showError('credits', error); }
    }
    async function loadUsers() {
      try {
        const data = await getJson('/api/admin/users');
        document.getElementById('users').innerHTML = table(data.users || [], [['created_at','Creato'],['username','Utente'],['mail_address','Mail'],['devices','Device'],['releases','Release'],['last_login_at','Ultimo login']]);
      } catch (error) { showError('users', error); }
    }
    async function loadSites() {
      try {
        const data = await getJson('/api/admin/sites');
        document.getElementById('sites').innerHTML = table(data.sites || [], [['address','Zona'],['owner','Owner'],['zone_status','Zona'],['version','Versione'],['release_status','Release'],['content_cid','CID'],['created_at','Data']]);
      } catch (error) { showError('sites', error); }
    }
    async function loadOceanoReviews() {
      try {
        const data = await getJson('/api/admin/oceano/submissions');
        const rows = data.submissions || [];
        document.getElementById('oceanoReviews').innerHTML = table(rows, [['submitted_at','Data'],['username','Autore'],['title','Titolo'],['summary','Riepilogo'],['content_type','Tipo'],['status','Stato'],['admin_note','Nota']]) +
          '<h3>Decisione</h3><p class="status">Inserisci ID contenuto e scegli APPROVED, CHANGES_REQUIRED o REJECTED.</p>' +
          '<input id="oceanoReviewId" placeholder="ID contenuto"><input id="oceanoDecision" placeholder="APPROVED / CHANGES_REQUIRED / REJECTED"><input id="oceanoNote" placeholder="Nota admin">' +
          '<button class="primary" onclick="decideOceano()">Conferma revisione</button>';
      } catch (error) { showError('oceanoReviews', error); }
    }
    async function decideOceano() {
      const id = document.getElementById('oceanoReviewId').value.trim();
      const decision = document.getElementById('oceanoDecision').value.trim().toUpperCase();
      const note = document.getElementById('oceanoNote').value.trim();
      if (!id || !decision) return;
      await postJson('/api/admin/oceano/submissions/' + encodeURIComponent(id) + '/decision', { decision, note });
      await loadOceanoReviews();
    }
    async function loadReports() {
      try {
        const data = await getJson('/api/admin/reports');
        document.getElementById('reports').innerHTML = '<h3>Mail spam</h3>' + table(data.mailSpam || [], [['created_at','Data'],['reason','Motivo'],['message_id','Messaggio']]) + '<h3>Forum</h3>' + table(data.forumModeration || [], [['created_at','Data'],['action','Azione'],['reason','Motivo'],['message_id','Messaggio']]);
      } catch (error) { showError('reports', error); }
    }
    async function loadAudit() {
      try {
        const data = await getJson('/api/admin/audit');
        document.getElementById('audit').innerHTML = '<h3>Audit firmato</h3>' + table(data.audit || [], [['created_at','Data'],['admin_id','Admin'],['action','Azione'],['target_type','Target'],['target_id','ID'],['reason','Motivo']]) + '<h3>Eventi operativi</h3>' + table(data.operational || [], [['created_at','Data'],['event_type','Evento'],['target_type','Target'],['summary','Sintesi'],['severity','Livello']]);
      } catch (error) { showError('audit', error); }
    }
    async function loadGuardian() {
      try {
        const data = await getJson('/api/admin/guardian');
        document.getElementById('guardian').innerHTML =
          '<div class="cards"><div class="card"><b>Stato</b><span>' + escapeHtml(data.status?.emergencyMode ? 'Emergenza' : 'Protetto') + '</span></div><div class="card"><b>Livelli</b><span>' + escapeHtml(String(data.status?.breachedLevels || 0)) + '/10</span></div><div class="card"><b>Multifirma</b><span>' + escapeHtml(String((data.cloudMultisig || []).length)) + '</span></div></div>' +
          '<h3>Livelli protezione</h3><p class="status">' + escapeHtml((data.levels || []).join(' / ')) + '</p>' +
          '<h3>Eventi Guardian</h3>' + table(data.events || [], [['created_at','Data'],['level','Livello'],['signal','Segnale'],['source','Fonte'],['target_type','Target'],['severity','Stato']]) +
          '<h3>Multifirma Cloud</h3>' + table(data.cloudMultisig || [], [['requested_at','Data'],['owner','Owner'],['cosigner_username','Seconda firma'],['status','Stato'],['approved_at','Attiva']]) +
          '<h3>Azione manuale</h3><input id="guardianLevel" placeholder="Livello 1-10"><input id="guardianSignal" placeholder="Segnale"><input id="guardianDetail" placeholder="Nota"><button class="primary" onclick="guardianSignal()">Registra segnale</button><button onclick="guardianReset()">Reset Guardian</button>';
      } catch (error) { showError('guardian', error); }
    }
    async function guardianSignal() {
      const level = Number(document.getElementById('guardianLevel').value || '1');
      const signal = document.getElementById('guardianSignal').value.trim() || 'ADMIN_SIGNAL';
      const detail = document.getElementById('guardianDetail').value.trim();
      await postJson('/api/admin/guardian/signal', { level, signal, detail });
      await loadGuardian();
    }
    async function guardianReset() {
      if (!confirm('Confermi reset Guardian?')) return;
      await postJson('/api/admin/guardian/reset', {});
      await loadGuardian();
    }
    async function loadAdminHealth() {
      try {
        const data = await getJson('/api/admin/health');
        document.getElementById('adminHealth').innerHTML = '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
      } catch (error) { showError('adminHealth', error); }
    }
    async function loadOpsStatus() {
      try {
        const data = await getJson('/api/admin/ops/status');
        document.getElementById('opsStatus').innerHTML =
          '<div class="cards"><div class="card"><b>Backup</b><span>' + escapeHtml(data.latestBackup?.status || 'Da registrare') + '</span></div><div class="card"><b>Restore test</b><span>' + escapeHtml(data.latestRestoreTest?.status || 'Da testare') + '</span></div><div class="card"><b>Uptime</b><span>' + escapeHtml(data.latestUptime?.status || 'Da controllare') + '</span></div><div class="card"><b>Modo</b><span>' + escapeHtml(data.backupMode || '-') + '</span></div></div>' +
          '<h3>Azioni</h3><input id="backupRef" placeholder="Riferimento backup"><input id="backupNote" placeholder="Nota backup"><button class="primary" onclick="recordBackup()">Registra backup completato</button><input id="restoreTarget" placeholder="Target test restore"><button onclick="recordRestore()">Registra restore test completato</button><button onclick="runUptimeCheck()">Esegui uptime check</button>' +
          '<h3>Stato</h3><pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
      } catch (error) { showError('opsStatus', error); }
    }
    async function recordBackup() {
      await postJson('/api/admin/ops/backup-record', { status: 'COMPLETED', backupRef: document.getElementById('backupRef').value.trim(), note: document.getElementById('backupNote').value.trim() || 'Backup registrato da admin' });
      await loadOpsStatus();
      await loadAdminHealth();
    }
    async function recordRestore() {
      await postJson('/api/admin/ops/restore-test-record', { status: 'COMPLETED', backupRef: document.getElementById('backupRef').value.trim(), restoreTarget: document.getElementById('restoreTarget').value.trim() || 'test', note: 'Restore test registrato da admin' });
      await loadOpsStatus();
      await loadAdminHealth();
    }
    async function runUptimeCheck() {
      await postJson('/api/admin/ops/uptime-check', {});
      await loadOpsStatus();
      await loadAdminHealth();
    }
    loadAll();
  </script>
</body>
</html>`;
}

function mobileWebManifest() {
  return JSON.stringify({
    name: "Velora Portal",
    short_name: "Velora",
    description: "Velora su mobile con account, strumenti, Cloud, forum, mining monitor e nodi.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#06131f",
    theme_color: "#e8c469",
    orientation: "portrait",
    icons: [
      { src: "/favicon.ico", sizes: "64x64", type: "image/svg+xml", purpose: "any maskable" }
    ],
    shortcuts: [
      { name: "Cloud", url: "/portal/cloud" },
      { name: "Mining", url: "/portal/mining" },
      { name: "Tools", url: "/portal/tools" }
    ]
  });
}

function mobileServiceWorker() {
  return `
self.addEventListener('install', event => {
  event.waitUntil(caches.open('velora-mobile-v2').then(cache => cache.addAll(['/portal','/app.webmanifest','/favicon.ico'])));
  self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  event.respondWith(fetch(request).catch(() => caches.match(request).then(response => response || caches.match('/portal'))));
});
`;
}

function appleWebManifest() {
  return JSON.stringify({
    name: "Velora Portal",
    short_name: "Velora",
    description: "Portale universale per usare Velora da Windows, Mac, iPhone, iPad e Android.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#06131f",
    theme_color: "#e8c469",
    orientation: "any",
    categories: ["productivity", "utilities", "social"],
    icons: [
      { src: "/favicon.ico", sizes: "64x64", type: "image/svg+xml", purpose: "any maskable" }
    ],
    shortcuts: [
      { name: "Search", url: "/portal/search" },
      { name: "Cloud", url: "/portal/cloud" },
      { name: "Mining", url: "/portal/mining" },
      { name: "Tools", url: "/portal/tools" }
    ],
    screenshots: [
      { src: "/favicon.ico", sizes: "64x64", type: "image/svg+xml", form_factor: "narrow" },
      { src: "/favicon.ico", sizes: "64x64", type: "image/svg+xml", form_factor: "wide" }
    ]
  });
}

function appleServiceWorker() {
  return `
const CACHE = 'velora-portal-v2';
const CORE = ['/portal','/portal/home','/portal/search','/portal/tools','/portal/help','/apple.webmanifest','/favicon.ico'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key.startsWith('velora-apple-')).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/downloads/')) return;
  event.respondWith(fetch(request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => undefined);
    return response;
  }).catch(() => caches.match(request).then(response => response || caches.match('/portal'))));
});
`;
}

function applePortalPage(section: string) {
  const initialSection = normalizeAppleSection(section);
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#e8c469">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Velora">
  <link rel="manifest" href="/apple.webmanifest">
  <title>Velora Portal</title>
  <style>
    :root{color-scheme:dark;--bg:#06131f;--panel:#10273b;--panel2:#071a2a;--line:#294963;--gold:#e8c469;--ink:#f5f8fb;--muted:#a9bdd0;--green:#2de0a0;--red:#ff9b8d;--blue:#5cc8ff}
    :root.light{color-scheme:light;--bg:#eef6fb;--panel:#ffffff;--panel2:#f3f8fc;--line:#c7d8e7;--ink:#0b1823;--muted:#526879;--gold:#a77917;--green:#087d57;--red:#b64030;--blue:#116d9e}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{margin:0;min-height:100vh;background:radial-gradient(circle at 16% 0,rgba(92,200,255,.24),transparent 34%),linear-gradient(180deg,var(--bg),#03101a 80%);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body.light{background:linear-gradient(180deg,#f4f9fd,#e7f1f8)}button,input,textarea,select{font:inherit}button{cursor:pointer}a{color:var(--blue);text-decoration:none}
    .app{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:18px;border-right:1px solid var(--line);background:rgba(6,19,31,.78);backdrop-filter:blur(20px);display:flex;flex-direction:column;overflow:auto}.light .sidebar{background:rgba(255,255,255,.78)}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}.logo{width:42px;height:42px;border:1px solid var(--gold);border-radius:14px;display:grid;place-items:center;color:var(--gold);font-weight:1000}.brand b{letter-spacing:.08em}.brand span{display:block;color:var(--muted);font-size:12px}
    .nav{display:grid;gap:7px}.nav button,.bottom button,.toolbar button,.primary,.ghost{border:1px solid var(--line);border-radius:15px;background:rgba(255,255,255,.04);color:var(--ink);padding:11px 12px;text-align:left}.nav button.active,.primary{background:linear-gradient(135deg,var(--gold),#f7df91);color:#06131f;border-color:transparent;font-weight:900}.bottom{margin-top:auto;display:grid;gap:8px;padding-top:14px}
    .main{min-width:0}.toolbar{position:sticky;top:0;z-index:4;display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:10px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);background:rgba(6,19,31,.75);backdrop-filter:blur(18px)}.light .toolbar{background:rgba(255,255,255,.75)}
    .searchbox,input,textarea,select{width:100%;border:1px solid var(--line);border-radius:16px;background:rgba(0,0,0,.18);color:var(--ink);padding:12px 14px}.lang-select{max-width:150px}.light .searchbox,.light input,.light textarea,.light select{background:#fff}textarea{min-height:110px;resize:vertical}
    .content{padding:18px;max-width:1500px;margin:auto}.hero,.panel{border:1px solid var(--line);border-radius:28px;background:linear-gradient(150deg,rgba(16,39,59,.92),rgba(7,26,42,.88));box-shadow:0 18px 70px rgba(0,0,0,.22)}.light .hero,.light .panel{background:linear-gradient(150deg,#fff,#f6fbff);box-shadow:0 18px 50px rgba(44,78,104,.12)}
    .hero{padding:26px;margin-bottom:16px}.kicker{color:var(--gold);font-size:12px;font-weight:1000;letter-spacing:.15em;text-transform:uppercase}h1{font-size:clamp(36px,6vw,72px);line-height:.92;margin:10px 0 14px}h2{margin:0 0 12px;font-size:23px}h3{margin:16px 0 8px}p{margin:0 0 10px;color:var(--muted);line-height:1.45}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-6{grid-column:span 6}.span-8{grid-column:span 8}.span-12{grid-column:1/-1}.panel{padding:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card,.item{border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.045);padding:13px}.light .card,.light .item{background:#fff}.card b{display:block;color:var(--gold);font-size:12px;letter-spacing:.08em;text-transform:uppercase}.card span{font-size:22px;font-weight:1000}.list{display:grid;gap:10px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.muted{color:var(--muted)}.ok{color:var(--green)}.bad{color:var(--red)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
    .module{display:none}.module.active{display:block}.mail-layout{display:grid;grid-template-columns:180px minmax(220px,320px) minmax(0,1fr);gap:12px}.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.drop{border:1px dashed var(--line);border-radius:18px;padding:18px;text-align:center}.hidden{display:none!important}.username-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid var(--line);border-radius:16px;background:rgba(0,0,0,.18);overflow:hidden}.username-wrap input{border:0;background:transparent;border-radius:0}.username-suffix{padding:0 14px;color:var(--gold);font-weight:900;white-space:nowrap}
    .mobile-tabs{display:none;position:fixed;left:10px;right:10px;bottom:10px;z-index:20;background:rgba(6,19,31,.94);border:1px solid var(--line);border-radius:24px;padding:8px;grid-template-columns:repeat(5,1fr);gap:6px;backdrop-filter:blur(18px);box-shadow:0 18px 55px rgba(0,0,0,.35)}.mobile-tabs button{border:0;border-radius:16px;padding:10px 4px;background:transparent;color:var(--ink);font-size:12px;text-align:center}.mobile-tabs button.active{background:var(--gold);color:#06131f;font-weight:900}
    :focus-visible{outline:3px solid var(--blue);outline-offset:2px}@media(prefers-reduced-motion:no-preference){.panel,.hero{animation:rise .28s ease both}@keyframes rise{from{opacity:.4;transform:translateY(8px)}to{opacity:1;transform:none}}}
    @media(max-width:980px){body{background:linear-gradient(180deg,#06131f,#081927 78%)}.app{grid-template-columns:1fr}.sidebar{display:none}.toolbar{grid-template-columns:1fr auto;gap:8px;padding:10px;top:0}.toolbar button:nth-of-type(2){display:none}.toolbar button:nth-of-type(3){display:none}.searchbox,input,textarea,select{font-size:16px;border-radius:15px}.content{padding:12px 10px 96px}.hero{padding:18px;border-radius:24px;margin-bottom:12px}.grid,.mail-layout,.split,.row,.three{display:grid;grid-template-columns:1fr;gap:10px}.panel{margin-bottom:12px;border-radius:22px;padding:14px}.span-3,.span-4,.span-6,.span-8,.span-12{grid-column:auto}.mobile-tabs{display:grid}h1{font-size:38px}h2{font-size:21px}.cards{grid-template-columns:1fr}.item button,.panel button{width:100%;text-align:center;margin-top:6px}iframe{height:68vh!important}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="logo">V</div><div><b>VELORA</b><span>Portal universale</span></div></div>
      <nav class="nav" id="sideNav"></nav>
      <div class="bottom"><button onclick="installHelp()">Installa</button><button onclick="logout()">Esci</button></div>
    </aside>
    <section class="main">
      <header class="toolbar">
        <input id="globalSearch" class="searchbox" placeholder="Cerca Velora o inserisci una zona" aria-label="Ricerca globale">
        <button onclick="runGlobalSearch()">Cerca</button>
        ${languageSelectorHtml()}
        <button onclick="toggleTheme()">Tema</button>
        <button onclick="showModule('settings')" id="profileButton">Profilo</button>
      </header>
      <main class="content">
        <section class="hero">
          <div class="kicker">Portale universale</div>
          <h1>Velora senza installazione</h1>
          <p>Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.</p>
          <p id="sessionState">Accesso non effettuato</p>
        </section>
        ${appleModulesHtml(initialSection)}
      </main>
    </section>
  </div>
  <nav class="mobile-tabs" id="mobileNav"></nav>
  ${veloraI18nScript()}
  <script>
    const initialSection = ${JSON.stringify(initialSection)};
    const tokenKey='velora.apple.token';
    const refreshKey='velora.apple.refresh';
    const userKey='velora.apple.user';
    let currentSection='${initialSection}';
    let selectedMessageId='';
    let currentForumSlug='global-chat';
    let deferredInstall=null;
    const modules=[
      ['home','Home'],['browser','Browser'],['search','Search'],['mail','VeloMail'],['cloud','Cloud'],['publisher','Publisher'],['tools','Tools'],['forum','Forum'],['mining','Mining'],['nodes','Nodi'],['nas','NAS'],['oceano','Oceano'],['help','Guida'],['settings','Impostazioni']
    ];
    function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
    function token(){return localStorage.getItem(tokenKey)||''}
    function headers(json=false){const h=token()?{Authorization:'Bearer '+token()}:{};return json?{...h,'content-type':'application/json'}:h}
    async function api(path,options={}){const res=await fetch(path,options);const text=await res.text();let data=text;try{data=text?JSON.parse(text):{}}catch{}if(!res.ok)throw new Error(typeof data==='object'&&data.message?data.message:text||String(res.status));return data}
    function card(k,v){return '<div class="card"><b>'+esc(k)+'</b><span>'+esc(v)+'</span></div>'}
    function item(t,b){return '<div class="item"><b>'+esc(t)+'</b><p>'+esc(b||'')+'</p></div>'}
    function renderNav(){const html=modules.map(([id,label])=>'<button class="'+(id===currentSection?'active':'')+'" onclick="showModule(\\''+id+'\\')">'+label+'</button>').join('');sideNav.innerHTML=html;mobileNav.innerHTML=modules.filter(x=>['home','search','browser','tools','settings'].includes(x[0])).map(([id,label])=>'<button class="'+(id===currentSection?'active':'')+'" onclick="showModule(\\''+id+'\\')">'+(id==='settings'?'Account':label)+'</button>').join('');window.veloraApplyLanguage&&window.veloraApplyLanguage()}
    function portalBase(){return location.pathname.startsWith('/apple')?'/apple':'/portal'}
    function showModule(id){currentSection=id;document.querySelectorAll('.module').forEach(el=>el.classList.toggle('active',el.id==='m-'+id));history.replaceState(null,'',portalBase()+'/'+id);renderNav();loadModule(id);window.veloraApplyLanguage&&window.veloraApplyLanguage()}
    function saveSession(data){localStorage.setItem(tokenKey,data.accessToken||data.token||'');if(data.refreshToken)localStorage.setItem(refreshKey,data.refreshToken);localStorage.setItem(userKey,JSON.stringify(data.user||{}))}
    function sessionUser(){try{return JSON.parse(localStorage.getItem(userKey)||'{}')}catch{return {}}}
    function setSessionState(){const u=sessionUser();const logged=Boolean(token());sessionState.textContent=logged?'Connesso come '+(u.username||'utente Velora'):'Accesso non effettuato';profileButton.textContent=logged?(u.username||'Profilo'):'Profilo';if(document.getElementById('authForm'))authForm.classList.toggle('hidden',logged);if(document.getElementById('accountBox'))accountBox.classList.toggle('hidden',!logged);if(document.getElementById('accountName'))accountName.textContent=u.username||'utente Velora';if(document.getElementById('accountMail'))accountMail.textContent=(u.mail||u.username||'account')+'';}
    function clearAuthFields(){if(document.getElementById('authPass'))authPass.value='';if(document.getElementById('authUser'))authUser.value='';}
    function authUsername(){return (authUser.value||'').trim().replace(/@velora$/i,'')+'@velora'}
    async function register(){try{const data=await api('/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:authUsername(),password:authPass.value})});saveSession(data);localStorage.setItem(userKey,JSON.stringify({...data.user,mail:data.mail?.address}));clearAuthFields();authMsg.textContent='Account creato';setSessionState();loadModule(currentSection)}catch(e){authMsg.textContent=e.message}}
    async function login(){try{const data=await api('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:authUsername(),password:authPass.value})});saveSession(data);localStorage.setItem(userKey,JSON.stringify({...data.user,mail:data.mail?.address}));clearAuthFields();authMsg.textContent='Accesso effettuato';setSessionState();loadModule(currentSection)}catch(e){authMsg.textContent=e.message}}
    async function refreshSession(){const refreshToken=localStorage.getItem(refreshKey);if(!refreshToken)return;try{const data=await api('/api/v1/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refreshToken})});saveSession({...data,user:sessionUser()});setSessionState()}catch{}}
    function logout(){localStorage.removeItem(tokenKey);localStorage.removeItem(refreshKey);localStorage.removeItem(userKey);setSessionState();showModule('home')}
    function toggleTheme(){document.documentElement.classList.toggle('light');document.body.classList.toggle('light');localStorage.setItem('velora.apple.theme',document.documentElement.classList.contains('light')?'light':'dark')}
    function installHelp(){const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;const isApple=/Mac|iPhone|iPad|iPod/.test(navigator.platform)||navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent);const isSafari=/Safari/.test(navigator.userAgent)&&!/Chrome|CriOS|Edg|Firefox|FxiOS/.test(navigator.userAgent);if(standalone)alert('Velora e gia aperta come app.');else if(isApple&&isSafari&&/iPhone|iPad|iPod/.test(navigator.userAgent))alert('Tocca Condividi e poi Aggiungi alla schermata Home.');else if(isApple&&isSafari)alert('Da Safari su Mac apri File e scegli Aggiungi al Dock.');else alert('Apri questa pagina in Safari per installare Velora nel Dock o nella schermata Home.');}
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e});
    if('serviceWorker'in navigator)navigator.serviceWorker.register('/apple-sw.js').catch(()=>undefined);
    window.addEventListener('message',async event=>{if(event.data?.type!=='VELORA_AUTH_REQUEST')return;if(!token()){showModule('home');authMsg.textContent='Accedi o registrati per collegare il sito al tuo account Velora';event.source?.postMessage({type:'VELORA_AUTH_STATE',loggedIn:false,reason:'LOGIN_REQUIRED'},'*');return}try{const state=await api('/api/v1/auth/portal-session',{headers:headers()});event.source?.postMessage({type:'VELORA_AUTH_STATE',loggedIn:true,username:state.user.username,mail:state.mail.address,identityLevel:state.user.identityLevel,scopes:state.scopes},'*')}catch(e){event.source?.postMessage({type:'VELORA_AUTH_STATE',loggedIn:false,reason:e.message},'*')}})
    async function runGlobalSearch(){showModule('search');searchQuery.value=globalSearch.value;await loadSearch()}
    function track(event,targetType,targetId,payload={}){fetch('/api/v1/analytics',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,targetType,targetId,summary:event,payload})}).catch(()=>undefined)}
    async function loadHome(){try{const [health,guardian,manifest]=await Promise.all([api('/health'),api('/api/v1/guardian/status'),api('/release-manifest.json')]);homeCards.innerHTML=card('Rete',health.ok?'Online':'Verifica')+card('Guardian',guardian.status||'Protetto')+card('Versione',manifest.version||'Beta')+card('PWA','Installabile');if(document.getElementById('nextActions'))nextActions.innerHTML=item('Cerca una zona','Apri Search e prova Velora Guide o Velora Tools')+item('Usa un tool','Apri Tools e prova Hash, Wallet Check o Link Check')+item('Pubblica','Prepara manifest e validazione dal Publisher')+item('Account','Accedi per VeloMail, Cloud, Forum e nodi')}catch(e){homeCards.innerHTML=item('Stato',e.message)}}
    async function loadSearch(){try{const q=(currentSection==='oceano'?oceanoQuery.value:searchQuery.value)||globalSearch.value||'velora';const data=await api('/api/v1/search?q='+encodeURIComponent(q));if(!(data.results||[]).length)track('SEARCH_EMPTY','SEARCH',q);const html=(data.results||[]).map(r=>'<div class="item"><b>'+esc(r.title||r.address)+'</b><p>'+esc(r.description||r.summary||'')+'</p><span class="mono">'+esc(r.address||r.zone||'')+'</span><button onclick="openZone(\\''+esc(r.address||r.zone||'')+'\\')">Apri</button></div>').join('')||item('Search','Nessun risultato disponibile');searchResults.innerHTML=html;if(document.getElementById('oceanoResults'))oceanoResults.innerHTML=html;}catch(e){track('SEARCH_ERROR','SEARCH',searchQuery.value||globalSearch.value,{message:e.message});const html=item('Search',e.message);searchResults.innerHTML=html;if(document.getElementById('oceanoResults'))oceanoResults.innerHTML=html;}}
    function openZone(address){if(!address)return;track('ZONE_OPEN','ZONE',address);browserAddress.value=address;showModule('browser');browserFrame.src='/zone/'+encodeURIComponent(address)}
    async function loadMail(){if(!token())return mailList.innerHTML=item('VeloMail','Accedi per leggere la posta');try{const [account,inbox]=await Promise.all([api('/api/v1/mail/account',{headers:headers()}),api('/api/v1/mail/inbox',{headers:headers()})]);mailAccount.textContent=account.address||'';mailList.innerHTML=(inbox.messages||[]).map(m=>'<button onclick="openMail(\\''+m.id+'\\')">'+esc(m.subject||'Messaggio')+'</button>').join('')||'<p>Nessun messaggio</p>'}catch(e){mailList.innerHTML=item('VeloMail',e.message)}}
    async function openMail(id){try{selectedMessageId=id;const m=await api('/api/v1/mail/messages/'+id,{headers:headers()});mailOpen.innerHTML='<h3>'+esc(m.subject||'Messaggio')+'</h3><p class="mono">'+esc(m.from_address||m.from||'')+'</p><p>'+esc(m.body||m.body_ciphertext||'Messaggio cifrato')+'</p>'}catch(e){mailOpen.innerHTML=item('Errore',e.message)}}
    async function sendMail(){try{await api('/api/v1/mail/send',{method:'POST',headers:headers(true),body:JSON.stringify({to:mailTo.value.split(',').map(x=>x.trim()).filter(Boolean),subject:mailSubject.value,body:mailBody.value,subjectCiphertext:mailSubject.value,bodyCiphertext:mailBody.value,encryptedByClient:true})});mailComposerMsg.textContent='Invio completato';loadMail()}catch(e){mailComposerMsg.textContent=e.message}}
    async function loadCloud(){if(!token())return cloudFiles.innerHTML=item('Cloud','Accedi per usare Cloud');try{const data=await api('/api/v1/cloud/files',{headers:headers()});cloudQuota.textContent=(data.quota?.quotaLabel||'25 MB')+' - usati '+(data.quota?.usedBytes||0)+' byte';cloudFiles.innerHTML=(data.files||[]).map(f=>'<div class="item"><b>'+esc(f.name)+'</b><p>'+esc(f.guardian_status||'PROTECTED')+' - '+f.size_bytes+' byte</p><button onclick="downloadCloud(\\''+f.id+'\\',\\''+esc(f.name)+'\\')">Download</button></div>').join('')||item('Cloud','Nessun file')}catch(e){cloudFiles.innerHTML=item('Cloud',e.message)}}
    async function uploadCloud(){const files=[...cloudInput.files];for(const file of files){const b64=await fileToBase64(file);await api('/api/v1/cloud/files',{method:'POST',headers:headers(true),body:JSON.stringify({name:file.name,mimeType:file.type||'application/octet-stream',contentBase64:b64})})}loadCloud()}
    function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(file)})}
    async function downloadCloud(id,name){const data=await fetch('/api/v1/cloud/files/'+id+'/download',{headers:headers()}).then(r=>r.text());const blob=new Blob([data]);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
    async function loadTools(){try{const data=await api('/api/v1/tools');const tools=(data.tools||[]).filter(t=>t.executable);toolList.innerHTML=tools.map(t=>'<div class="item"><b>'+esc(t.name||t.title)+'</b><p>'+esc(t.description)+'</p><span class="mono">'+esc(t.group||'Velora')+'</span><button onclick="runTool(\\''+esc(t.action||t.zone||t.address)+'\\')">Esegui</button></div>').join('')||item('Tools','Nessuno strumento disponibile')}catch(e){toolList.innerHTML=item('Tools',e.message)}}
    async function runTool(action){const text=toolInput.value.trim();let out='';track('TOOL_RUN','TOOL',action);try{if(action.includes('tts')){if(!text)throw new Error('Inserisci testo');speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));out='Lettura avviata'}else if(action.includes('hash')){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));out=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}else if(action.includes('wallet')){out=/^(4|8)[1-9A-HJ-NP-Za-km-z]{90,110}$|^Z[a-zA-Z0-9]{70,120}$/.test(text)?'Wallet pubblico valido':'Wallet non riconosciuto'}else if(action.includes('link-check')){let u=new URL(text);out=['https:','http:'].includes(u.protocol)?'Link leggibile: '+u.hostname:'Protocollo non consentito'}else if(action.includes('privacy')){const hits=[];if(/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/i.test(text))hits.push('email');if(/\\b\\d{8,}\\b/.test(text))hits.push('numeri lunghi');if(/seed|private key|password/i.test(text))hits.push('segreti');out=hits.length?'Possibili dati sensibili: '+hits.join(', '):'Nessun dato sensibile evidente'}else if(action.includes('publisher-validator')){try{const m=JSON.parse(text);out=m.address&&m.title&&m.entryFile?'Manifest leggibile':'Manifest incompleto'}catch{out='Incolla un manifest JSON valido'}}else if(action.includes('zone-explorer')){openZone(text||'velora.guide');out='Apertura zona avviata'}else if(action.includes('login-test')){out=token()?'Sessione Velora attiva':'Accedi a Velora per testare il login'}else if(action.includes('node-health')){const h=await api('/api/network/nodes/summary');out='Rete '+(h.network||'online')+' - nodi '+((h.nodes||[]).length)}else if(action.includes('mail-test')){out=token()?'VeloMail pronto: apri la sezione VeloMail per inviare un messaggio':'Accedi per testare VeloMail'}else if(action.includes('report-abuse')){out='Segnalazione pronta: descrivi contenuto, zona o utente e inviala dal pannello segnalazioni'}else throw new Error('Strumento non disponibile');toolOutput.textContent=out}catch(e){track('TOOL_ERROR','TOOL',action,{message:e.message});toolOutput.textContent=e.message}}
    async function loadForum(){if(!token())return forumMessages.innerHTML=item('Forum','Accedi per usare il forum');try{const sections=await api('/api/v1/forum/sections',{headers:headers()});currentForumSlug=(sections.sections||[])[0]?.slug||currentForumSlug;const data=await api('/api/v1/forum/sections/'+encodeURIComponent(currentForumSlug)+'/messages',{headers:headers()});forumMessages.innerHTML=(data.messages||[]).map(m=>item(m.username||'Velora',m.body||m.message||'')).join('')||item('Forum','Nessun messaggio')}catch(e){forumMessages.innerHTML=item('Forum',e.message)}}
    async function sendForum(){try{await api('/api/v1/forum/sections/'+encodeURIComponent(currentForumSlug)+'/messages',{method:'POST',headers:headers(true),body:JSON.stringify({body:forumDraft.value})});forumDraft.value='';loadForum()}catch(e){alert(e.message)}}
    async function loadMining(){if(!token())return miningBox.innerHTML=item('Mining','Accedi per vedere mining');try{const [progress,targets,history]=await Promise.all([api('/api/v1/mining/progress',{headers:headers()}),api('/api/v1/execution/targets',{headers:headers()}),api('/api/v1/mining/history',{headers:headers()})]);targetSelect.innerHTML=(targets.targets||[]).filter(t=>(t.capabilities||[]).includes('MINING_START')).map(t=>'<option value="'+esc(t.type+':'+t.id)+'">'+esc(t.label+' - '+t.status)+'</option>').join('');miningBox.innerHTML=(progress.workers||[]).map(w=>item(w.worker_id||'worker','Share ok '+(w.accepted_pool_shares||0)+' - payout '+(w.pending_label||'-')+' - soglia '+(w.payout_threshold_label||'-'))).join('')||item('Mining','Nessun worker');miningHistory.innerHTML=(history.payoutRequests||[]).map(p=>item(p.status,p.coin+' '+(p.payout_tx_hash||''))).join('')}catch(e){miningBox.innerHTML=item('Mining',e.message)}}
    async function execMining(op){const [type,id]=(targetSelect.value||'SERVER:').split(':');try{await api('/api/v1/execution/operations',{method:'POST',headers:headers(true),body:JSON.stringify({operation:op,targetType:type||'SERVER',targetId:id,requestedState:op,payload:{profile:miningProfile.value,coin:miningCoin.value},idempotencyKey:op+'-'+Date.now()})});loadMining()}catch(e){alert(e.message)}}
    async function loadNodes(){if(!token()){const html=item('Nodi','Accedi per vedere i nodi');nodesBox.innerHTML=html;if(document.getElementById('nasBox'))nasBox.innerHTML=html;return}try{const data=await api('/api/v1/execution/targets',{headers:headers()});const targets=data.targets||[];nodesBox.innerHTML=targets.map(t=>item(t.label,t.type+' - '+t.status+' - '+(t.online?'online':'offline'))).join('')||item('Nodi','Nessun nodo');if(document.getElementById('nasBox')){const nas=targets.filter(t=>t.type==='NAS');nasBox.innerHTML=nas.map(t=>item(t.label,(t.online?'online':'offline')+' - '+(t.storageAvailableBytesLabel||'spazio in verifica')+' - ultimo contatto '+(t.lastSeenAt||'-'))).join('')||item('NAS','Nessun NAS associato all account');}opsBox.innerHTML=(data.operations||[]).map(o=>item(o.operation,o.status+' - '+(o.target_type||''))).join('')||item('Operazioni','Nessuna operazione recente')}catch(e){nodesBox.innerHTML=item('Nodi',e.message);if(document.getElementById('nasBox'))nasBox.innerHTML=item('NAS',e.message)}}
    async function preparePublisher(){if(!token())return publisherStatus.textContent='Accedi per preparare una pubblicazione';try{const payload={address:publisherAddress.value.trim(),title:publisherTitle.value.trim(),description:publisherDescription.value.trim(),category:publisherCategory.value,keywords:publisherKeywords.value.split(',').map(x=>x.trim()).filter(Boolean),version:publisherVersion.value.trim()||'1.0.0',entryFile:'index.html',languages:['it'],ageRating:'EVERYONE',familySafe:true,permissions:{externalNetwork:false,clipboardRead:false,clipboardWrite:false,notifications:false,fileDownload:false},allowedExternalOrigins:[]};const data=await api('/api/v1/sites/portal-prepare',{method:'POST',headers:headers(true),body:JSON.stringify(payload)});publisherStatus.innerHTML=(data.ready?'<b class="ok">Pronto per pubblicare</b>':'<b class="bad">Correggi prima di pubblicare</b>')+'<pre>'+esc(JSON.stringify(data,null,2))+'</pre>';publisherManifest.value=JSON.stringify(data.manifest,null,2)}catch(e){publisherStatus.textContent=e.message}}
    async function queuePublish(){if(!token())return publisherStatus.textContent='Accedi per continuare';try{await preparePublisher();await api('/api/v1/execution/operations',{method:'POST',headers:headers(true),body:JSON.stringify({operation:'PUBLISH_VALIDATE',targetType:'SERVER',idempotencyKey:'publish-'+Date.now(),payload:{address:publisherAddress.value.trim(),source:'portal'}})});publisherStatus.innerHTML+='<p class="ok">Controllo registrato. Ora puoi completare la pubblicazione dal tuo dispositivo autorizzato.</p>'}catch(e){publisherStatus.textContent=e.message}}
    async function loadPublisher(){publisherStatus.textContent='Compila i campi, controlla il sito e prepara la pubblicazione.'}
    function loadModule(id){if(id==='home')loadHome();if(id==='search'||id==='oceano')loadSearch();if(id==='mail')loadMail();if(id==='cloud')loadCloud();if(id==='tools')loadTools();if(id==='forum')loadForum();if(id==='mining')loadMining();if(id==='nodes'||id==='nas')loadNodes();if(id==='publisher')loadPublisher();setTimeout(()=>window.veloraApplyLanguage&&window.veloraApplyLanguage(),0)}
    document.addEventListener('keydown',e=>{if(!e.metaKey)return;if(e.key.toLowerCase()==='k'){e.preventDefault();globalSearch.focus()}if(e.key.toLowerCase()==='l'){e.preventDefault();globalSearch.focus()}if(e.key.toLowerCase()==='r'){e.preventDefault();loadModule(currentSection)}if(e.key.toLowerCase()==='t'){e.preventDefault();showModule('browser')}})
    if(localStorage.getItem('velora.apple.theme')==='light')toggleTheme();renderNav();setSessionState();refreshSession();showModule(initialSection);
  </script>
</body>
</html>`;
}

function normalizeAppleSection(section: string) {
  const normalized = String(section || "home").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return ["home","browser","search","mail","cloud","publisher","tools","forum","mining","nodes","nas","oceano","help","settings"].includes(normalized) ? normalized : "home";
}

function appleModulesHtml(initialSection: string) {
  const active = (id: string) => id === initialSection ? " active" : "";
  return `
    <section id="m-home" class="module${active("home")}">
      <div class="grid">
        <div class="panel span-8"><h2>Accedi a Velora</h2><p>Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.</p><div id="authForm"><div class="row"><label class="username-wrap"><input id="authUser" autocomplete="username" placeholder="nomeutente"><span class="username-suffix">@velora</span></label><input id="authPass" autocomplete="current-password" type="password" placeholder="Password"></div><div class="row"><button class="primary" onclick="login()">Accedi</button><button onclick="register()">Crea account</button></div></div><div id="accountBox" class="hidden"><div class="card"><b>Account attivo</b><span id="accountName">utente Velora</span><p id="accountMail"></p></div><button onclick="logout()">Esci</button></div><p id="authMsg"></p></div>
        <div class="panel span-4"><h2>Uso rapido</h2><p>Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.</p><button onclick="installHelp()">Come salvarlo</button></div>
        <div class="panel span-12"><h2>Dashboard</h2><div id="homeCards" class="cards"></div></div>
        <div class="panel span-12"><h2>Cosa posso fare ora</h2><div id="nextActions" class="cards"></div></div>
        <div class="panel span-4"><h2>Esplora</h2><p>Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.</p><button onclick="showModule('search')">Cerca ora</button></div>
        <div class="panel span-4"><h2>Comunica</h2><p>VeloMail e forum usano la stessa sessione del tuo account.</p><button onclick="showModule('mail')">Apri VeloMail</button></div>
        <div class="panel span-4"><h2>Pubblica</h2><p>Il Publisher guidato genera un manifest valido e riduce gli errori.</p><button onclick="showModule('publisher')">Prepara sito</button></div>
      </div>
    </section>
    <section id="m-search" class="module${active("search")}"><div class="panel"><h2>Search</h2><div class="row"><input id="searchQuery" placeholder="Cerca zone, Oceano, tools, guide"><button class="primary" onclick="loadSearch()">Cerca</button></div><div id="searchResults" class="list"></div></div></section>
    <section id="m-browser" class="module${active("browser")}"><div class="panel"><h2>Browser Velora</h2><div class="row"><input id="browserAddress" placeholder="velora.guide"><button onclick="openZone(browserAddress.value)">Apri zona</button></div><iframe id="browserFrame" title="Velora Browser" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:20px;background:#fff"></iframe></div></section>
    <section id="m-mail" class="module${active("mail")}"><div class="mail-layout"><div class="panel"><h2>Cartelle</h2><p id="mailAccount"></p><button onclick="loadMail()">Inbox</button></div><div class="panel"><h2>Messaggi</h2><div id="mailList" class="list"></div></div><div class="panel"><h2>VeloMail</h2><div id="mailOpen"></div><h3>Componi</h3><input id="mailTo" placeholder="destinatario@velora"><input id="mailSubject" placeholder="Oggetto"><textarea id="mailBody" placeholder="Messaggio"></textarea><button class="primary" onclick="sendMail()">Invia</button><p id="mailComposerMsg"></p></div></div></section>
    <section id="m-cloud" class="module${active("cloud")}"><div class="split"><div class="panel"><h2>Velora Cloud</h2><p id="cloudQuota"></p><div class="drop"><input id="cloudInput" type="file" multiple><button class="primary" onclick="uploadCloud()">Carica</button></div></div><div class="panel"><h2>File</h2><div id="cloudFiles" class="list"></div></div></div></section>
    <section id="m-publisher" class="module${active("publisher")}"><div class="split"><div class="panel"><h2>Publisher Studio</h2><p>Prepara una zona Velora con titolo, descrizione, categoria e controllo iniziale.</p><input id="publisherAddress" placeholder="nome.zona"><input id="publisherTitle" placeholder="Titolo sito"><textarea id="publisherDescription" placeholder="Descrizione chiara del sito"></textarea><div class="row"><select id="publisherCategory"><option>shop</option><option>tool</option><option>social</option><option>video</option><option>blog</option><option>business</option><option>community</option><option>education</option><option>health</option><option>science</option><option>service</option><option>tech</option><option>cloud</option><option>portfolio</option><option>news</option></select><input id="publisherVersion" placeholder="1.0.0"></div><input id="publisherKeywords" placeholder="keyword separate da virgola"><div class="row"><button onclick="preparePublisher()">Controlla</button><button class="primary" onclick="queuePublish()">Prepara pubblicazione</button></div><div id="publisherStatus"></div></div><div class="panel"><h2>Stato pubblicazione</h2><textarea id="publisherManifest" readonly placeholder="Il riepilogo appare qui dopo il controllo"></textarea><h3>Accesso Velora</h3><p>I siti pubblicati possono usare l'account Velora senza creare account separati.</p></div></div></section>
    <section id="m-tools" class="module${active("tools")}"><div class="split"><div class="panel"><h2>Velora Tools</h2><p>Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.</p><textarea id="toolInput" placeholder="Testo, wallet, link o contenuto"></textarea><pre id="toolOutput"></pre></div><div class="panel"><h2>Tools disponibili</h2><div id="toolList" class="list"></div></div></div></section>
    <section id="m-forum" class="module${active("forum")}"><div class="panel"><h2>Forum e chat</h2><textarea id="forumDraft" placeholder="Scrivi nel forum"></textarea><button class="primary" onclick="sendForum()">Invia</button><button onclick="loadForum()">Aggiorna</button><div id="forumMessages" class="list"></div></div></section>
    <section id="m-mining" class="module${active("mining")}"><div class="grid"><div class="panel span-4"><h2>Comando remoto</h2><select id="targetSelect"></select><select id="miningCoin"><option>XMR</option><option>ZEPH</option></select><select id="miningProfile"><option>ECO</option><option>BILANCIATO</option><option>POTENZA</option></select><div class="three"><button onclick="execMining('MINING_START')">Avvia</button><button onclick="execMining('MINING_PAUSE')">Pausa</button><button onclick="execMining('MINING_STOP')">Stop</button></div></div><div class="panel span-8"><h2>Mining dashboard</h2><div id="miningBox" class="list"></div><h3>Storico payout</h3><div id="miningHistory" class="list"></div></div></div></section>
    <section id="m-nodes" class="module${active("nodes")}"><div class="split"><div class="panel"><h2>Nodi</h2><button onclick="loadNodes()">Aggiorna</button><div id="nodesBox" class="list"></div></div><div class="panel"><h2>Operazioni</h2><div id="opsBox" class="list"></div></div></div></section>
    <section id="m-nas" class="module${active("nas")}"><div class="panel"><h2>NAS</h2><p>Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.</p><button onclick="loadNodes()">Controlla NAS</button><div id="nasBox" class="list"></div></div></section>
    <section id="m-oceano" class="module${active("oceano")}"><div class="panel"><h2>Oceano</h2><p>Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.</p><div class="row"><input id="oceanoQuery" placeholder="Cerca in Oceano" oninput="searchQuery.value=this.value"><button onclick="loadSearch()">Cerca</button></div><div id="oceanoResults"></div></div></section>
    <section id="m-help" class="module${active("help")}"><div class="panel"><h2>Guida</h2><div class="cards"><div class="card"><b>Mac</b><span>Dock</span><p>Safari, File, Aggiungi al Dock.</p></div><div class="card"><b>iPhone</b><span>Home</span><p>Condividi, Aggiungi alla schermata Home.</p></div><div class="card"><b>Offline</b><span>Shell</span><p>La shell e la guida restano disponibili. Dati live richiedono rete.</p></div></div></div></section>
    <section id="m-settings" class="module${active("settings")}"><div class="panel"><h2>Impostazioni</h2><button onclick="toggleTheme()">Cambia tema</button><button onclick="Notification.requestPermission()">Consenti notifiche</button><button onclick="logout()">Logout</button></div></section>
  `;
}

function mobilePage() {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#e8c469">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Velora">
  <link rel="manifest" href="/app.webmanifest">
  <title>Velora Mobile</title>
  <style>
    :root{--bg:#06131f;--panel:#10273b;--panel2:#071b2b;--line:#294963;--gold:#e8c469;--ink:#f5f8fb;--muted:#a9bdd0;--green:#2de0a0;--red:#ff9b8d}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{margin:0;background:radial-gradient(circle at 20% 0,#214d67,transparent 35%),linear-gradient(180deg,#06131f,#04101a 70%);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
    header{position:sticky;top:0;z-index:5;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(6,19,31,.86);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:space-between;gap:12px}
    .brand{display:flex;align-items:center;gap:10px}.logo{width:38px;height:38px;border:1px solid var(--gold);border-radius:13px;display:grid;place-items:center;color:var(--gold);font-weight:1000}.brand b{letter-spacing:.08em}.brand span{display:block;color:var(--muted);font-size:12px}
    main{padding:16px 14px 96px;max-width:760px;margin:auto}.hero,.panel{border:1px solid var(--line);border-radius:26px;background:linear-gradient(160deg,rgba(16,39,59,.95),rgba(7,27,43,.9));box-shadow:0 18px 60px rgba(0,0,0,.28)}
    .hero{padding:22px;margin-bottom:14px}.hero p{color:var(--muted);line-height:1.45}.kicker{color:var(--gold);font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}h1{font-size:34px;line-height:.96;margin:10px 0 12px}h2{margin:0 0 12px;font-size:21px}h3{margin:14px 0 8px}p{margin:0 0 10px}
    .panel{padding:16px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.045);padding:12px}.card b{display:block;color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.card span{font-size:18px;font-weight:900}
    input,textarea,button,select{width:100%;border:1px solid var(--line);border-radius:16px;background:#06121d;color:var(--ink);padding:13px 14px;font:inherit}textarea{min-height:110px;resize:vertical}button{font-weight:900;background:linear-gradient(135deg,#264a64,#11263a);cursor:pointer}button.primary{background:linear-gradient(135deg,var(--gold),#f7df91);border:0;color:#07131e}.lang-select{max-width:150px}.username-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid var(--line);border-radius:16px;background:#06121d;overflow:hidden}.username-wrap input{border:0;background:transparent;border-radius:0}.username-suffix{padding:0 14px;color:var(--gold);font-weight:900;white-space:nowrap}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stack{display:grid;gap:10px}.muted{color:var(--muted)}.ok{color:var(--green)}.bad{color:var(--red)}.list{display:grid;gap:10px}.item{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;background:rgba(0,0,0,.13)}.item small{color:var(--muted)}
    nav.mobile{position:fixed;left:10px;right:10px;bottom:10px;z-index:10;background:rgba(6,19,31,.92);border:1px solid var(--line);border-radius:24px;padding:8px;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;backdrop-filter:blur(18px)}nav.mobile button{padding:10px 4px;border-radius:16px;font-size:12px}nav.mobile button.active{background:linear-gradient(135deg,var(--gold),#f6df95);color:#07131e}
    section[data-page]{display:none}section[data-page].active{display:block}.install{display:none}.install.show{display:block}
    @media(min-width:720px){h1{font-size:52px}.grid{grid-template-columns:repeat(4,1fr)}nav.mobile{max-width:760px;margin:auto}}
  </style>
</head>
<body>
  <header>
    <div class="brand"><div class="logo">V</div><div><b>VELORA</b><span>Mobile beta</span></div></div>
    ${languageSelectorHtml()}
    <button id="installBtn" style="max-width:150px">Installa</button>
  </header>
  <main>
    <section class="hero">
      <div class="kicker">Velora ovunque</div>
      <h1>L'Upper Web entra nel telefono</h1>
      <p>Accedi, usa i tool, controlla Cloud, forum, mining monitor, nodi e pubblicazioni da iOS e Android.</p>
      <p id="sessionState" class="muted">Accesso non effettuato</p>
    </section>

    <section data-page="home" class="active">
      <div class="panel">
        <h2>Cosa posso fare ora</h2>
        <div class="list">
          <button onclick="showPage('search',document.querySelector('[data-tab=search]'))">Cerca una zona</button>
          <button onclick="showPage('browser',document.querySelector('[data-tab=browser]'))">Apri Browser Velora</button>
          <button onclick="showPage('tools',document.querySelector('[data-tab=tools]'))">Usa Velora Tools</button>
          <button onclick="showPage('account',document.querySelector('[data-tab=account]'))">Gestisci account</button>
        </div>
      </div>
      <div class="panel">
        <h2>Stato Velora</h2>
        <div class="grid" id="homeCards"></div>
      </div>
    </section>

    <section data-page="search" id="search">
      <div class="panel stack">
        <h2>Cerca su Velora</h2>
        <input id="mobileSearch" placeholder="velora.guide, velora.tools, guida">
        <button class="primary" onclick="runMobileSearch()">Cerca</button>
        <div id="mobileSearchResults" class="list"></div>
      </div>
    </section>

    <section data-page="browser" id="browser">
      <div class="panel stack">
        <h2>Browser Velora</h2>
        <input id="mobileZone" placeholder="velora.guide">
        <button class="primary" onclick="openMobileZone(mobileZone.value)">Apri zona</button>
        <iframe id="mobileFrame" title="Browser Velora" style="width:100%;height:68vh;border:1px solid var(--line);border-radius:20px;background:#fff"></iframe>
      </div>
    </section>

    <section data-page="account" id="account">
      <div class="panel stack">
        <h2>Account Velora</h2>
        <label class="username-wrap"><input id="username" placeholder="nomeutente" autocomplete="username"><span class="username-suffix">@velora</span></label>
        <input id="email" placeholder="Email per nuova registrazione">
        <input id="password" type="password" placeholder="Password">
        <div class="row"><button class="primary" onclick="login()">Entra</button><button onclick="register()">Crea account</button></div>
        <button onclick="logout()">Esci</button>
        <p id="authMsg" class="muted"></p>
      </div>
    </section>

    <section data-page="tools" id="tools">
      <div class="panel stack">
        <h2>Velora Tools</h2>
        <textarea id="toolText" placeholder="Scrivi o incolla testo"></textarea>
        <div class="row"><button onclick="speakTool()">TTS</button><button onclick="translateTool()">Traduci</button></div>
        <div class="row"><button onclick="summarizeTool()">Riassumi</button><button onclick="hashTool()">SHA-256</button></div>
        <div class="row"><button onclick="walletTool()">Wallet check</button><button onclick="privacyTool()">Privacy check</button></div>
        <div id="toolOutput" class="item muted">Risultato pronto qui</div>
      </div>
      <div class="panel"><h2>Catalogo</h2><div id="toolList" class="list"></div></div>
    </section>

    <section data-page="cloud" id="cloud">
      <div class="panel stack">
        <h2>Velora Cloud</h2>
        <input id="cloudFile" type="file">
        <button class="primary" onclick="uploadCloud()">Carica file</button>
        <div id="cloudStatus" class="muted">25 MB beta per account</div>
        <div id="cloudFiles" class="list"></div>
      </div>
    </section>

    <section data-page="mining" id="mining">
      <div class="panel stack">
        <h2>Mining collettivo</h2>
        <p class="muted">Da mobile controlli worker, share, soglia e richieste payout. Il mining locale resta sul dispositivo desktop/NAS autorizzato.</p>
        <button class="primary" onclick="loadMining()">Aggiorna mining</button>
        <input id="payoutCoin" placeholder="Coin XMR o ZEPH" value="XMR">
        <input id="payoutDevice" placeholder="Device peer ID">
        <input id="payoutWallet" placeholder="Wallet payout pubblico">
        <button onclick="requestPayout()">Richiedi payout manuale</button>
        <div id="miningStatus" class="list"></div>
      </div>
    </section>

    <section data-page="nodes" id="nodes">
      <div class="panel stack">
        <h2>Nodi</h2>
        <p class="muted">Controlla nodi desktop e NAS collegati all'account.</p>
        <button class="primary" onclick="loadNodes()">Aggiorna nodi</button>
        <div id="nodeList" class="list"></div>
      </div>
    </section>

    <section data-page="forum" id="forum">
      <div class="panel stack">
        <h2>Forum Velora</h2>
        <textarea id="forumDraft" placeholder="Scrivi messaggio"></textarea>
        <button class="primary" onclick="sendForum()">Invia</button>
        <button onclick="loadForum()">Aggiorna</button>
        <div id="forumMessages" class="list"></div>
      </div>
    </section>
  </main>
  <nav class="mobile">
    <button class="active" data-tab="home" onclick="showPage('home',this)">Home</button>
    <button data-tab="search" onclick="showPage('search',this)">Cerca</button>
    <button data-tab="browser" onclick="showPage('browser',this)">Browser</button>
    <button data-tab="tools" onclick="showPage('tools',this)">Tools</button>
    <button data-tab="account" onclick="showPage('account',this)">Account</button>
  </nav>
  ${veloraI18nScript()}
  <script>
    let deferredInstall = null;
    let currentForumSlug = 'global';
    const tokenKey = 'velora.mobile.token';
    const userKey = 'velora.mobile.user';
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; document.getElementById('installBtn').style.display = 'block'; });
    document.getElementById('installBtn').onclick = async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } else { alert('Su iPhone usa Condividi e poi Aggiungi alla schermata Home. Su Android usa Installa app dal menu browser.'); } };
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/mobile-sw.js').catch(() => undefined);
    function token(){ return localStorage.getItem(tokenKey) || ''; }
    function headers(json){ const h = token() ? { Authorization: 'Bearer ' + token() } : {}; return json ? { ...h, 'content-type':'application/json' } : h; }
    function setMsg(id,msg,cls){ const el=document.getElementById(id); el.className=cls||'muted'; el.textContent=msg; }
    function card(label,value){ return '<div class="card"><b>'+esc(label)+'</b><span>'+esc(String(value))+'</span></div>'; }
    function item(title,body){ return '<div class="item"><b>'+esc(title)+'</b><br><small>'+esc(body||'')+'</small></div>'; }
    function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
    async function api(path,options){ const res=await fetch(path,options||{}); const text=await res.text(); let data=text; try{ data=text?JSON.parse(text):{}; }catch{} if(!res.ok) throw new Error(typeof data==='object' && data.message ? data.message : text || res.status); return data; }
    function track(event,targetType,targetId,payload){ fetch('/api/v1/analytics',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,targetType,targetId,summary:event,payload:payload||{}})}).catch(()=>undefined); }
    function showPage(page,button){ document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page)); document.querySelectorAll('nav.mobile button').forEach(el=>el.classList.remove('active')); if(button) button.classList.add('active'); location.hash=page; if(page==='tools') loadTools(); setTimeout(()=>window.veloraApplyLanguage&&window.veloraApplyLanguage(),0); }
    async function runMobileSearch(){ try{ const q=mobileSearch.value.trim()||'velora'; const data=await api('/api/v1/search?q='+encodeURIComponent(q)); if(!(data.results||[]).length)track('SEARCH_EMPTY','SEARCH',q); mobileSearchResults.innerHTML=(data.results||[]).map(r=>'<div class="item"><b>'+esc(r.title||r.address)+'</b><br><small>'+esc(r.description||r.summary||'')+'</small><button onclick="openMobileZone(\\''+esc(r.address||r.zone||'')+'\\')">Apri</button></div>').join('')||item('Search','Nessun risultato disponibile'); }catch(e){ track('SEARCH_ERROR','SEARCH',mobileSearch.value,{message:e.message}); mobileSearchResults.innerHTML=item('Search',e.message); } }
    function openMobileZone(zone){ if(!zone)return; track('ZONE_OPEN','ZONE',zone); mobileZone.value=zone; showPage('browser',document.querySelector('[data-tab=browser]')); mobileFrame.src='/zone/'+encodeURIComponent(zone); }
    function authUsername(){ return (username.value||'').trim().replace(/@velora$/i,'') + '@velora'; }
    async function register(){ try{ const body={username:authUsername(),email:email.value.trim(),password:password.value}; const data=await api('/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); saveSession(data); setMsg('authMsg','Account creato','ok'); boot(); }catch(e){ setMsg('authMsg',e.message,'bad'); } }
    async function login(){ try{ const body={username:authUsername(),password:password.value}; const data=await api('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); saveSession(data); setMsg('authMsg','Accesso effettuato','ok'); boot(); }catch(e){ setMsg('authMsg',e.message,'bad'); } }
    function saveSession(data){ localStorage.setItem(tokenKey,data.accessToken||data.token||''); localStorage.setItem(userKey, JSON.stringify(data.user||{})); }
    function logout(){ localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); boot(); }
    async function boot(){ const user=JSON.parse(localStorage.getItem(userKey)||'{}'); sessionState.textContent=token() ? 'Connesso come ' + (user.username||'utente Velora') : 'Accesso non effettuato'; await loadHome(); }
    async function loadHome(){ try{ const health=await api('/health'); const guardian=await api('/api/v1/guardian/status'); homeCards.innerHTML=card('API',health.ok?'online':'verifica')+card('Guardian',guardian.status||'protetto')+card('Livelli',guardian.totalLevels||10)+card('Mobile','attivo'); }catch(e){ homeCards.innerHTML=item('Stato',e.message); } }
    async function loadTools(){ try{ const data=await api('/api/v1/tools'); toolList.innerHTML=(data.tools||[]).filter(t=>t.executable).map(t=>item(t.name,t.description)).join('')||item('Tools','Nessuno strumento disponibile'); }catch(e){ toolList.innerHTML=item('Errore',e.message); } }
    function speakTool(){ const text=toolText.value.trim(); if(!text) return setMsg('toolOutput','Inserisci testo','bad'); speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); setMsg('toolOutput','Lettura avviata','ok'); }
    function translateTool(){ const text=toolText.value.trim(); if(!text) return setMsg('toolOutput','Inserisci testo','bad'); const dict={ciao:'hello',grazie:'thank you',si:'yes',no:'no',buongiorno:'good morning',buonasera:'good evening',veloce:'fast',sicuro:'safe',semplice:'simple'}; const out=text.split(/\\s+/).map(w=>dict[w.toLowerCase()]||w).join(' '); setMsg('toolOutput',out,'ok'); }
    function summarizeTool(){ const text=toolText.value.trim(); const parts=text.split(/[.!?\\n]/).map(x=>x.trim()).filter(Boolean); setMsg('toolOutput',parts.slice(0,3).join('. ') || 'Inserisci testo','ok'); }
    async function hashTool(){ const text=toolText.value; const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)); setMsg('toolOutput',Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(),'ok'); }
    function walletTool(){ const v=toolText.value.trim(); const ok=/^(4|8)[1-9A-HJ-NP-Za-km-z]{90,110}$/.test(v)||/^Z[a-zA-Z0-9]{70,120}$/.test(v); setMsg('toolOutput',ok?'Wallet pubblico valido per controllo beta':'Formato wallet non riconosciuto',''+(ok?'ok':'bad')); }
    function privacyTool(){ const text=toolText.value; const hits=[]; if(/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/i.test(text)) hits.push('email'); if(/\\b\\d{8,}\\b/.test(text)) hits.push('numeri lunghi'); if(/seed|private key|password/i.test(text)) hits.push('segreti'); setMsg('toolOutput',hits.length?'Possibili dati sensibili: '+hits.join(', '):'Nessun dato sensibile evidente','ok'); }
    async function loadCloud(){ if(!token()) return setMsg('cloudStatus','Accedi per usare Cloud','bad'); try{ const data=await api('/api/v1/cloud/files',{headers:headers()}); cloudStatus.textContent=(data.quota?.quotaLabel||'25 MB')+' disponibili - usati '+(data.quota?.usedBytes||0)+' byte'; cloudFiles.innerHTML=(data.files||[]).map(f=>item(f.name,(f.guardian_status||'PROTECTED')+' - '+f.size_bytes+' byte')).join('')||item('Cloud','Nessun file'); }catch(e){ setMsg('cloudStatus',e.message,'bad'); } }
    async function uploadCloud(){ if(!token()) return setMsg('cloudStatus','Accedi per caricare','bad'); const f=cloudFile.files[0]; if(!f) return; const reader=new FileReader(); reader.onload=async()=>{ try{ const b64=String(reader.result).split(',')[1]||''; await api('/api/v1/cloud/files',{method:'POST',headers:headers(true),body:JSON.stringify({name:f.name,mimeType:f.type||'application/octet-stream',contentBase64:b64})}); setMsg('cloudStatus','File caricato','ok'); loadCloud(); }catch(e){ setMsg('cloudStatus',e.message,'bad'); } }; reader.readAsDataURL(f); }
    async function loadMining(){ if(!token()) return miningStatus.innerHTML=item('Mining','Accedi per vedere i dati'); try{ const data=await api('/api/v1/mining/progress',{headers:headers()}); miningStatus.innerHTML=(data.workers||[]).map(w=>item(w.worker_id||'worker', 'Coin '+w.coin+' - Share ok '+(w.accepted_pool_shares||0)+' - Payout '+(w.pending_label||'-')+' - Soglia '+(w.payout_threshold_label||'-'))).join('')||item('Mining','Nessun worker registrato'); }catch(e){ miningStatus.innerHTML=item('Mining',e.message); } }
    async function requestPayout(){ if(!token()) return; try{ await api('/api/v1/mining/payout-requests',{method:'POST',headers:headers(true),body:JSON.stringify({coin:payoutCoin.value,devicePeerId:payoutDevice.value,payoutWallet:payoutWallet.value,note:'Richiesta da Velora Mobile'})}); alert('Richiesta payout inviata'); loadMining(); }catch(e){ alert(e.message); } }
    async function loadNodes(){ if(!token()) return nodeList.innerHTML=item('Nodi','Accedi per vedere i nodi'); try{ const data=await api('/api/v1/contribution/profile',{headers:headers()}); nodeList.innerHTML=(data.nodes||[]).map(n=>item(n.module||'Nodo', (n.status||'-')+' - '+(n.devicePeerId||n.device_peer_id||'-')+' - ultimo contatto '+(n.lastHeartbeatAt||n.last_heartbeat_at||'-'))).join('')||item('Nodi','Nessun nodo collegato'); }catch(e){ nodeList.innerHTML=item('Nodi',e.message); } }
    async function loadForum(){ if(!token()) return forumMessages.innerHTML=item('Forum','Accedi per leggere e scrivere'); try{ const sections=await api('/api/v1/forum/sections',{headers:headers()}); currentForumSlug=(sections.sections||[])[0]?.slug||currentForumSlug; const data=await api('/api/v1/forum/sections/'+encodeURIComponent(currentForumSlug)+'/messages',{headers:headers()}); forumMessages.innerHTML=(data.messages||[]).slice(0,30).map(m=>item(m.username||'Velora',m.body||m.message||'')).join('')||item('Forum','Nessun messaggio'); }catch(e){ forumMessages.innerHTML=item('Forum',e.message); } }
    async function sendForum(){ if(!token()) return; try{ await api('/api/v1/forum/sections/'+encodeURIComponent(currentForumSlug)+'/messages',{method:'POST',headers:headers(true),body:JSON.stringify({body:forumDraft.value})}); forumDraft.value=''; loadForum(); }catch(e){ alert(e.message); } }
    boot(); if(location.hash) showPage(location.hash.slice(1), document.querySelector('nav.mobile button'));
  </script>
</body>
</html>`;
}

async function publicPage(page: string) {
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
    cookie: "Cookie Policy",
    terms: "Termini"
  }[page] ?? "VELORA";
  const publicBaseUrl = "https://www.webvelora.it";
  const canonicalPath = page === "home" ? "/" : page === "privacy" ? "/legal/privacy" : page === "cookie" ? "/legal/cookie" : page === "terms" ? "/legal/terms" : `/${page}`;
  const canonicalUrl = `${publicBaseUrl}${canonicalPath}`;
  const description = {
    home: "Velora e una piattaforma Upper Web con portale universale, account unico, siti pubblicati, cloud, VeloMail, tools, nodi e sicurezza Guardian.",
    download: "Scarica Velora Beta per Windows, Mac, mobile PWA e NAS fallback con hash SHA-256 e stato versione.",
    security: "Velora Guardian protegge cloud, account e operazioni sensibili con livelli di sicurezza, audit e controlli admin.",
    publishers: "Strumenti e guida per pubblicare siti e applicazioni nell'Upper Web Velora con manifest, login e validazione.",
    privacy: "Informativa privacy Velora per account, portale, cloud, mail, publishing e funzioni beta.",
    cookie: "Cookie Policy Velora per cookie tecnici, sessione, sicurezza e preferenze essenziali.",
    terms: "Termini d'uso Velora per portale, beta, download, publishing, cloud e community."
  }[page] ?? "Velora Upper Web: portale, browser, search, cloud, VeloMail, publishing, nodi e sicurezza.";
  const downloadUrl = "/downloads/windows/Velora_0.1.0_x64_en-US.msi";
  const checksumUrl = "/downloads/windows/Velora_0.1.0_x64_en-US.msi.sha256.txt";
  const macosDownloadUrl = "/downloads/macos/Velora_0.1.0_aarch64.dmg";
  const macosChecksumUrl = "/downloads/macos/Velora_0.1.0_aarch64.dmg.sha256.txt";
  const macosIntelDownloadUrl = "/downloads/macos/Velora_0.1.0_x86_64.dmg";
  const macosIntelChecksumUrl = "/downloads/macos/Velora_0.1.0_x86_64.dmg.sha256.txt";
  const mobileUrl = "/portal";
  const mobilePackageUrl = `/downloads/mobile/${mobilePwaName}`;
  const mobileChecksumUrl = `/downloads/mobile/${mobilePwaChecksumName}`;
  const releaseManifest = await readReleaseManifestSafe();
  const releasedAt = releaseManifest?.releasedAt ? new Date(releaseManifest.releasedAt).toLocaleDateString("it-IT") : "in aggiornamento";
  const macArm = releaseManifest?.platforms?.["macos-aarch64"] ?? {};
  const macIntel = releaseManifest?.platforms?.["macos-x86_64"] ?? {};
  const mobile = releaseManifest?.platforms?.["mobile-pwa"] ?? {};
  const nasFallbackUrl = "/downloads/nas/velora-nas-fallback-agent-0.1.0-beta.zip";
  const moneroWalletUrl = "https://www.getmonero.org/downloads/";
  const zephyrWalletUrl = "https://zephyrprotocol.com/";
  const body = page === "download" ? `
    <section class="panel">
      <h1>Velora</h1>
      <p>Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.</p>
      <section class="cards">
        <article>
          <b>Portale Velora</b>
          <p>Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati</p>
          <a class="cta" href="${mobileUrl}">Apri Velora</a>
        </article>
        <article>
          <b>Windows</b>
          <p>Installer MSI per mining, nodo locale e funzioni desktop avanzate</p>
          <a class="cta" href="${downloadUrl}">Scarica per Windows</a>
          <a class="ghost" href="${checksumUrl}">Verifica SHA-256</a>
        </article>
        <article>
          <b>Mac Apple Silicon</b>
          <p>Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS</p>
          <a class="cta" href="${macosDownloadUrl}">Scarica per Mac Apple Silicon</a>
          <a class="ghost" href="${macosChecksumUrl}">Verifica SHA-256</a>
        </article>
        <article>
          <b>Mac Intel</b>
          <p>Beta avanzata per Mac Intel non notarizzata</p>
          <a class="cta" href="${macosIntelDownloadUrl}">Scarica per Mac Intel</a>
          <a class="ghost" href="${macosIntelChecksumUrl}">Verifica SHA-256</a>
        </article>
        <article>
          <b>Nodo NAS fallback</b>
          <p>Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso</p>
          <a class="cta" href="${nasFallbackUrl}">Scarica nodo NAS</a>
        </article>
      </section>
      <dl>
        <dt>Versione</dt><dd>0.1.0 Beta</dd>
        <dt>Data build</dt><dd>${escapeHtml(releasedAt)}</dd>
        <dt>Stato Mac</dt><dd>Beta con firma ad hoc, non ancora notarizzata da Apple</dd>
        <dt>Portale</dt><dd>Windows, Mac, iPhone, iPad e Android<br>Nessuna installazione obbligatoria</dd>
        <dt>Apple Silicon</dt><dd>${escapeHtml(String(macArm.size ?? 0))} byte<br>${escapeHtml(String(macArm.sha256 ?? "hash in aggiornamento"))}</dd>
        <dt>Intel</dt><dd>${escapeHtml(String(macIntel.size ?? 0))} byte<br>${escapeHtml(String(macIntel.sha256 ?? "hash in aggiornamento"))}</dd>
      </dl>
      <h2>Changelog beta</h2>
      <ul>
        ${releaseChangelog().map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
    <section class="panel">
      <h2>Installazione su Mac</h2>
      <p>Velora e attualmente distribuita come Beta non ancora notarizzata da Apple<br>macOS mostrera quindi un avviso al primo avvio<br>Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente</p>
      <ol>
        <li>Scarica Velora per il tuo Mac</li>
        <li>Apri il file DMG</li>
        <li>Trascina Velora nella cartella Applicazioni</li>
        <li>Prova ad aprire Velora</li>
        <li>Quando macOS la blocca, premi Fine</li>
        <li>Apri Impostazioni di Sistema</li>
        <li>Vai in Privacy e Sicurezza</li>
        <li>Scorri fino al messaggio relativo a Velora</li>
        <li>Premi Apri comunque</li>
        <li>Conferma Apri</li>
      </ol>
      <p>Per scegliere la versione apri menu Apple, Informazioni su questo Mac e controlla se compare Chip Apple oppure Processore Intel</p>
      <details><summary class="ghost">Velora non si apre dopo Apri comunque</summary>
        <ol><li>Verifica di aver spostato Velora in Applicazioni</li><li>Verifica di aver scaricato la build corretta</li><li>Riavvia il Mac una sola volta</li><li>Prova ad aprire nuovamente Velora</li><li>Invia all'assistenza il file Library/Logs/Velora/startup.log</li></ol>
      </details>
    </section>
    <section class="panel">
      <h2>Wallet Mining Partner</h2>
      <p>Usa soltanto wallet ufficiali e custodisci tu seed phrase e chiavi private<br>Velora non chiede mai seed, private key, password o file wallet</p>
      <a class="ghost" href="${moneroWalletUrl}" rel="noopener noreferrer">Wallet Monero ufficiale</a>
      <a class="ghost" href="${zephyrWalletUrl}" rel="noopener noreferrer">Wallet Zephyr ufficiale</a>
      <p>Durante la beta puoi richiedere payout manuale dal tuo account quando la quota viene verificata nel pannello admin</p>
    </section>` : page === "privacy" ? `
    <section class="panel">
      <h1>Privacy Velora</h1>
      <p>Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.</p>
      <div class="cards">
        <article><b>Dati account</b><p>Username Velora, sessioni, dispositivi autorizzati e log di sicurezza necessari al funzionamento.</p></article>
        <article><b>Contenuti utente</b><p>File cloud, messaggi, siti pubblicati e richieste vengono conservati per fornire il servizio e prevenire abusi.</p></article>
        <article><b>Contatti</b><p>Email supporto: srivarola104 gmail.com</p></article>
      </div>
      <p>Non chiediamo seed phrase, chiavi private, password wallet o file wallet. Le credenziali sensibili non devono essere inviate tramite form pubblici.</p>
      <a class="ghost" href="/legal/cookie">Cookie Policy</a>
      <a class="ghost" href="/legal/terms">Termini d'uso</a>
    </section>` : page === "cookie" ? `
    <section class="panel">
      <h1>Cookie Policy</h1>
      <p>Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.</p>
      <div class="cards">
        <article><b>Sessione</b><p>Mantiene l'accesso Velora e riduce login ripetuti.</p></article>
        <article><b>Sicurezza</b><p>Aiuta a proteggere account, rate limit, integrita richieste e operazioni sensibili.</p></article>
        <article><b>Preferenze</b><p>Memorizza tema, stato consenso e impostazioni essenziali dell'interfaccia.</p></article>
      </div>
      <p>Non sono attivi cookie pubblicitari di terze parti nella beta pubblica Velora.</p>
      <a class="cta" href="/portal">Apri Velora</a>
    </section>` : page === "terms" ? `
    <section class="panel">
      <h1>Termini Velora</h1>
      <p>Velora e in beta pubblica. Usa il servizio in modo lecito, non pubblicare contenuti abusivi, non tentare accessi non autorizzati e verifica sempre hash e fonti ufficiali dei download.</p>
      <p>Le funzioni avanzate come mining, nodi, NAS, payout, cloud e publishing possono essere soggette a limiti, verifiche manuali e sospensioni di sicurezza.</p>
      <a class="ghost" href="/legal/privacy">Privacy</a>
      <a class="ghost" href="/legal/cookie">Cookie</a>
    </section>` : page === "security" ? `
    <section class="panel">
      <h1>Velora Guardian</h1>
      <p>Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio</p>
      <div class="cards">
        <article><b>10 livelli</b><p>Ogni livello riduce la superficie di attacco e registra segnali per l'admin</p></article>
        <article><b>Cloud protetto</b><p>I nuovi file vengono custoditi in forma cifrata e verificata</p></article>
        <article><b>Multifirma</b><p>Puoi richiedere una seconda firma con un altro account Velora per operazioni cloud sensibili</p></article>
      </div>
      <a class="cta" href="/download">Aggiorna Velora</a>
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
    <section class="hero home-hero">
      <div class="velora-orbit" aria-label="Velora Upper Web">
        <div class="orbit-ring ring-a"></div>
        <div class="orbit-ring ring-b"></div>
        <div class="orbit-core"><b>V</b><span>Velora</span></div>
        <a class="orbit-node n-search" href="/portal/search">Search</a>
        <a class="orbit-node n-mail" href="/portal/mail">VeloMail</a>
        <a class="orbit-node n-cloud" href="/portal/cloud">Cloud</a>
        <a class="orbit-node n-publish" href="/portal/publisher">Publisher</a>
        <a class="orbit-node n-tools" href="/portal/tools">Tools</a>
        <div class="orbit-status"><span></span>rete operativa</div>
      </div>
      <div class="entry-panel">
        <span>PUBLIC BETA</span>
        <h1>Velora</h1>
        <p class="lead">Cerca zone, apri strumenti, usa VeloMail, salva file e pubblica contenuti da un solo account</p>
        <form class="hero-search" action="/portal/search">
          <input name="q" placeholder="Cerca o inserisci una zona" aria-label="Cerca su Velora">
          <button type="submit">Vai</button>
        </form>
        <div class="hero-actions"><a class="cta" href="/portal">Apri Velora</a><a class="ghost" href="/download">Scarica beta</a></div>
        <div class="mini-metrics">
          <b>Account @velora</b>
          <b>Cloud protetto</b>
          <b>Desktop e mobile</b>
        </div>
      </div>
    </section>
    <section class="flow-grid">
      <a href="/portal"><span>START</span><b>Portale</b><p>Accesso immediato da browser</p></a>
      <a href="/portal/tools"><span>TOOLS</span><b>Velora Tools</b><p>Strumenti pronti per uso quotidiano</p></a>
      <a href="/portal/publisher"><span>PUBLISH</span><b>Publisher Studio</b><p>Controllo sito, upload e stato online</p></a>
      <a href="/security"><span>GUARDIAN</span><b>Sicurezza</b><p>Protezione account, cloud e attività sensibili</p></a>
    </section>`;
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - Velora</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Velora" />
  <meta property="og:title" content="${escapeHtml(title)} - Velora" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    :root{color:#f7fbff;background:#050b12;font-family:"Aptos Display","Segoe UI Variable Display","Segoe UI",sans-serif}
    body{margin:0;background:linear-gradient(115deg,#06192d 0%,#0a1721 42%,#071016 100%);min-height:100vh}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 18% 18%,rgba(90,180,255,.22),transparent 26%),radial-gradient(circle at 78% 12%,rgba(216,174,85,.16),transparent 24%),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(0deg,rgba(255,255,255,.028) 1px,transparent 1px);background-size:auto,auto,72px 72px,72px 72px;mask-image:linear-gradient(to bottom,#000 0%,rgba(0,0,0,.72) 55%,transparent 100%)}
    header,main,footer{max-width:1180px;margin:auto;padding:24px}
    nav{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
    nav a{color:#c8d9ea;text-decoration:none}
    nav a:first-child{color:#f1d68b;font-weight:900;letter-spacing:.18em}
    .lang-select{width:auto;border:1px solid rgba(216,174,85,.5);border-radius:14px;background:rgba(6,17,31,.78);color:#f7fbff;padding:10px 12px}
    .hero,.panel,.cards article,.flow-grid a{border:1px solid rgba(150,202,255,.18);background:linear-gradient(180deg,rgba(12,35,55,.82),rgba(7,20,32,.78));border-radius:28px;box-shadow:0 28px 80px rgba(0,0,0,.36)}
    .hero{padding:clamp(26px,4.5vw,54px);margin-top:28px;position:relative;overflow:hidden}
    .home-hero{display:grid;grid-template-columns:minmax(420px,1fr) minmax(360px,.82fr);gap:38px;align-items:center;min-height:620px}
    .hero:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,255,255,.07),transparent 34%),radial-gradient(circle at 30% 50%,rgba(95,205,255,.16),transparent 28%),radial-gradient(circle at 86% 24%,rgba(241,214,139,.13),transparent 24%);pointer-events:none}
    .hero span{color:#f1d68b;letter-spacing:.18em;font-weight:900}
    h1{font-size:clamp(42px,6vw,76px);line-height:.9;margin:14px 0;letter-spacing:-.065em;max-width:850px}
    .entry-panel{position:relative;z-index:1;border:1px solid rgba(150,202,255,.18);background:rgba(4,13,22,.66);border-radius:32px;padding:30px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
    .entry-panel h1{font-size:clamp(42px,5.5vw,76px);line-height:.9;margin:14px 0 12px}
    h2{font-size:clamp(30px,3.8vw,52px);line-height:1;margin:8px 0 0;letter-spacing:-.045em}
    p,dd{color:#c8d9ea;font-size:18px}
    .lead{font-size:clamp(18px,2vw,22px);max-width:620px;line-height:1.38}
    .hero-search{display:flex;gap:10px;align-items:center;margin:26px 0 0;max-width:620px;padding:8px;border:1px solid rgba(150,202,255,.24);border-radius:20px;background:rgba(3,11,19,.72)}
    .hero-search input{flex:1;min-width:0;border:0;background:transparent;color:#f7fbff;font-size:17px;padding:13px 14px;outline:none}
    .hero-search input::placeholder{color:#8fa8bd}
    .hero-search button{border:0;border-radius:15px;background:#f1d68b;color:#06111f;font-weight:1000;padding:13px 18px;cursor:pointer}
    .cta,.ghost{display:inline-flex;margin:18px 12px 0 0;padding:14px 18px;border-radius:16px;text-decoration:none;border:1px solid rgba(216,174,85,.5)}
    .cta{background:linear-gradient(135deg,#f1d68b,#d8ae55);color:#06111f;font-weight:900}
    .ghost{color:#f1d68b}
    .hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.hero-actions .cta,.hero-actions .ghost{margin-top:0}
    .mini-metrics{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}.mini-metrics b{font-size:14px;color:#dcecff;border:1px solid rgba(150,202,255,.2);border-radius:999px;padding:8px 11px;background:rgba(255,255,255,.045)}
    .velora-orbit{position:relative;z-index:1;min-height:520px;border-radius:36px;background:radial-gradient(circle at center,rgba(103,217,255,.12),transparent 32%),linear-gradient(160deg,rgba(4,12,20,.82),rgba(10,34,52,.52));border:1px solid rgba(150,202,255,.18);overflow:hidden}
    .velora-orbit:before{content:"";position:absolute;inset:26px;border-radius:32px;background:linear-gradient(90deg,rgba(255,255,255,.032) 1px,transparent 1px),linear-gradient(0deg,rgba(255,255,255,.026) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(circle at center,#000 0%,transparent 72%)}
    .orbit-ring{position:absolute;left:50%;top:50%;border:1px solid rgba(241,214,139,.3);border-radius:50%;transform:translate(-50%,-50%) rotate(-12deg);animation:orbitPulse 5s ease-in-out infinite}
    .ring-a{width:74%;height:48%}.ring-b{width:56%;height:76%;border-color:rgba(103,217,255,.26);animation-delay:1.2s}
    .orbit-core{position:absolute;left:50%;top:50%;width:148px;height:148px;border-radius:34px;display:grid;place-items:center;transform:translate(-50%,-50%);background:linear-gradient(135deg,#f1d68b,#c69432);color:#06111f;box-shadow:0 34px 90px rgba(216,174,85,.22)}
    .orbit-core b{font-size:72px;line-height:.8}.orbit-core span{position:absolute;bottom:18px;color:#06111f;letter-spacing:.18em;font-size:11px}
    .orbit-node{position:absolute;text-decoration:none;color:#f7fbff;border:1px solid rgba(150,202,255,.28);background:rgba(5,16,27,.82);border-radius:999px;padding:12px 15px;font-weight:900;box-shadow:0 18px 48px rgba(0,0,0,.32);transition:transform .18s ease,border-color .18s ease,background .18s ease}
    .orbit-node:hover{transform:translateY(-4px) scale(1.03);border-color:#f1d68b;background:rgba(241,214,139,.12)}
    .n-search{left:8%;top:18%}.n-mail{right:9%;top:20%}.n-cloud{right:12%;bottom:22%}.n-publish{left:9%;bottom:24%}.n-tools{left:50%;bottom:8%;transform:translateX(-50%)}.n-tools:hover{transform:translateX(-50%) translateY(-4px) scale(1.03)}
    .orbit-status{position:absolute;left:22px;bottom:22px;display:flex;align-items:center;gap:10px;color:#dfffee;border:1px solid rgba(87,227,155,.24);background:rgba(87,227,155,.08);border-radius:999px;padding:10px 13px}.orbit-status span{width:10px;height:10px;border-radius:50%;background:#57e39b;box-shadow:0 0 22px #57e39b;letter-spacing:0}
    @keyframes orbitPulse{0%,100%{opacity:.55;transform:translate(-50%,-50%) rotate(-12deg) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) rotate(-8deg) scale(1.025)}}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:22px}
    .flow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-top:22px}.flow-grid a{display:block;min-height:170px;padding:22px;text-decoration:none;color:#f7fbff;transition:transform .18s ease,border-color .18s ease}.flow-grid a:hover{transform:translateY(-4px);border-color:rgba(241,214,139,.66)}.flow-grid span{color:#f1d68b;font-weight:1000;letter-spacing:.16em}.flow-grid b{display:block;font-size:25px;line-height:1.05;margin:22px 0 10px}.flow-grid p{font-size:16px;margin:0;color:#c8d9ea}
    .cards article,.panel{padding:24px}
    dt{color:#f1d68b;margin-top:14px}
    dd{margin-left:0;overflow-wrap:anywhere}
    footer{color:#9fb4c8}.cookie-banner{position:fixed;left:18px;right:18px;bottom:18px;z-index:30;display:none;gap:14px;align-items:center;justify-content:space-between;max-width:980px;margin:auto;padding:16px;border:1px solid rgba(216,174,85,.45);border-radius:22px;background:rgba(6,17,31,.96);box-shadow:0 20px 70px rgba(0,0,0,.45)}.cookie-banner.show{display:flex}.cookie-banner p{margin:0;font-size:15px}.cookie-banner button{width:auto;border:0;border-radius:14px;background:#f1d68b;color:#06111f;padding:11px 16px;font-weight:900;cursor:pointer}@media(max-width:900px){.home-hero{grid-template-columns:1fr;min-height:auto}.flow-grid{grid-template-columns:1fr 1fr}.velora-orbit{min-height:440px;order:2}.entry-panel{order:1}}@media(max-width:720px){header,main,footer{padding:16px}nav{flex-wrap:nowrap;overflow-x:auto;padding-bottom:6px}.hero{border-radius:24px}.entry-panel{padding:22px}.entry-panel h1{font-size:58px}.hero-search{flex-direction:column;align-items:stretch}.hero-actions a{flex:1;justify-content:center}.mini-metrics b{flex:1;text-align:center}.flow-grid{grid-template-columns:1fr}.velora-orbit{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:auto;padding:16px}.velora-orbit:before,.orbit-ring{display:none}.orbit-core{position:relative;left:auto;top:auto;grid-column:1/-1;width:auto;height:112px;transform:none;border-radius:24px}.orbit-core b{font-size:54px}.orbit-core span{bottom:13px}.orbit-node{position:relative;left:auto;right:auto;top:auto;bottom:auto;transform:none;text-align:center;font-size:13px;padding:12px}.orbit-node:hover,.n-tools:hover{transform:translateY(-2px)}.n-tools{left:auto;bottom:auto;transform:none}.orbit-status{position:relative;left:auto;bottom:auto;grid-column:1/-1;justify-content:center}.cookie-banner{display:none;flex-direction:column;align-items:flex-start}.cookie-banner.show{display:flex}}@media(max-width:420px){.entry-panel h1{font-size:48px}.velora-orbit{grid-template-columns:1fr}.orbit-core,.orbit-status{grid-column:auto}}
  </style>
</head>
<body>
  <header><nav><a href="/">VELORA</a><a href="/portal">Portale</a><a href="/download">Download</a><a href="/what-is-velora">Upper Web</a><a href="/security">Sicurezza</a><a href="/publishers">Publisher</a><a href="/publishers/guide">Guida</a><a href="/developers">Developers</a><a href="/pricing">Pricing</a><a href="/status">Status</a>${languageSelectorHtml()}</nav></header>
  <main>${body}</main>
  <footer><p>Velora Beta pubblica</p><p><a href="/legal/privacy">Privacy</a> · <a href="/legal/cookie">Cookie</a> · <a href="/legal/terms">Termini</a> · Supporto: srivarola104 gmail.com</p></footer>
  <div class="cookie-banner" id="cookieBanner"><p>Velora usa solo cookie e storage tecnici necessari per accesso, sicurezza e preferenze essenziali.</p><div><a class="ghost" href="/legal/cookie">Leggi policy</a><button onclick="localStorage.setItem('velora.cookie.ok','1');cookieBanner.classList.remove('show')">Accetta</button></div></div>
  ${veloraI18nScript()}
  <script>if(!localStorage.getItem('velora.cookie.ok'))cookieBanner.classList.add('show')</script>
</body>
</html>`;
}

function routeParam(params: unknown, key: string) {
  return String((params as Record<string, string>)[key]);
}

function languageSelectorHtml() {
  return `<select class="lang-select" data-velora-language aria-label="Language">
    <option value="it">Italiano</option>
    <option value="en">English</option>
    <option value="fr">Français</option>
    <option value="de">Deutsch</option>
    <option value="es">Español</option>
    <option value="ru">Русский</option>
    <option value="zh">中文</option>
  </select>`;
}

function veloraI18nDictionaryComplete() {
  const dict = veloraI18nDictionary() as Record<string, Record<string, string>>;
  const additions: Record<string, Record<string, string>> = {
    en: {
      "VELORA PUBLIC BETA": "VELORA PUBLIC BETA",
      "Velora unisce browser, search, VeloMail, Cloud, Publisher, Tools, nodi e sicurezza in un portale unico. Entri, scegli cosa fare e inizi subito.": "Velora brings browser, search, VeloMail, Cloud, Publisher, Tools, nodes and security into one portal. Enter, choose what to do and start immediately.",
      "Desktop e mobile": "Desktop and mobile",
      "Cloud protetto": "Protected Cloud",
      "Velora Live Console": "Velora Live Console",
      "Ricerca interna": "Internal search",
      "Trova servizi Velora senza uscire dal portale": "Find Velora services without leaving the portal",
      "Search apre contenuti, strumenti e zone pubblicate dentro l'ambiente Velora, con lo stesso account e stato di sicurezza.": "Search opens content, tools and published zones inside Velora, with the same account and security status.",
      "Carica file e ritrovali nel tuo account": "Upload files and find them in your account",
      "Velora Cloud collega spazio utente, sessione stabile e controlli Guardian per proteggere i dati personali.": "Velora Cloud links user storage, stable session and Guardian checks to protect personal data.",
      "Comunicazione": "Communication",
      "VeloMail usa la stessa identita Velora": "VeloMail uses the same Velora identity",
      "Invio, ricezione e forum condividono lo stesso account, senza profili paralleli o login separati.": "Sending, receiving and forum share the same account, without parallel profiles or separate logins.",
      "Prepara una zona prima di pubblicarla": "Prepare a zone before publishing it",
      "Publisher Studio guida manifest, validazione, login Velora e stato pubblicazione prima della messa online.": "Publisher Studio guides manifest, validation, Velora Login and publishing status before going online.",
      "Guardian controlla rischio, log e cloud": "Guardian checks risk, logs and cloud",
      "Audit, protezione dati e segnali admin rendono leggibile cosa sta succedendo all'ecosistema.": "Audit, data protection and admin signals make ecosystem status readable.",
      "Una sessione. Più funzioni. Stato leggibile.": "One session. More functions. Clear status.",
      "Velora Search": "Velora Search",
      "Cerca contenuti, moduli e zone pubblicate senza perdere il contesto del portale.": "Search content, modules and published zones without losing portal context.",
      "VeloMail e Cloud": "VeloMail and Cloud",
      "Messaggi, file e account lavorano insieme con sessione persistente e controlli Guardian.": "Messages, files and account work together with persistent session and Guardian checks.",
      "Publisher Studio": "Publisher Studio",
      "Prepara manifest, valida una pubblicazione e segui lo stato prima di andare online.": "Prepare a manifest, validate a publication and follow status before going online.",
      "Velora Guardian": "Velora Guardian",
      "Protezione multilivello, audit e segnali admin per account, cloud e operazioni sensibili.": "Multi-level protection, audit and admin signals for accounts, cloud and sensitive operations.",
      "Il portale è il punto di accesso. Il desktop aggiunge potenza locale.": "The portal is the access point. Desktop adds local power.",
      "La beta pubblica serve a provare funzioni reali: account, ricerca, VeloMail, Cloud, Tools, Publisher, nodi e sicurezza Guardian.": "The public beta is for testing real functions: account, search, VeloMail, Cloud, Tools, Publisher, nodes and Guardian security.",
      "verifica": "checking"
    },
    fr: {
      "VELORA PUBLIC BETA": "BETA PUBLIQUE VELORA",
      "Velora unisce browser, search, VeloMail, Cloud, Publisher, Tools, nodi e sicurezza in un portale unico. Entri, scegli cosa fare e inizi subito.": "Velora réunit navigateur, recherche, VeloMail, Cloud, Publisher, Tools, nœuds et sécurité dans un portail unique. Entrez, choisissez et commencez.",
      "Desktop e mobile": "Desktop et mobile",
      "Cloud protetto": "Cloud protégé",
      "Velora Live Console": "Console Velora",
      "Ricerca interna": "Recherche interne",
      "Trova servizi Velora senza uscire dal portale": "Trouvez les services Velora sans quitter le portail",
      "Search apre contenuti, strumenti e zone pubblicate dentro l'ambiente Velora, con lo stesso account e stato di sicurezza.": "Search ouvre contenus, outils et zones publiées dans Velora, avec le même compte et le même état de sécurité.",
      "Carica file e ritrovali nel tuo account": "Importez des fichiers et retrouvez-les dans votre compte",
      "Velora Cloud collega spazio utente, sessione stabile e controlli Guardian per proteggere i dati personali.": "Velora Cloud relie espace utilisateur, session stable et contrôles Guardian pour protéger les données personnelles.",
      "Comunicazione": "Communication",
      "VeloMail usa la stessa identita Velora": "VeloMail utilise la même identité Velora",
      "Invio, ricezione e forum condividono lo stesso account, senza profili paralleli o login separati.": "Envoi, réception et forum partagent le même compte, sans profils parallèles ni connexions séparées.",
      "Prepara una zona prima di pubblicarla": "Préparez une zone avant publication",
      "Publisher Studio guida manifest, validazione, login Velora e stato pubblicazione prima della messa online.": "Publisher Studio guide le manifest, la validation, le Login Velora et l’état de publication avant la mise en ligne.",
      "Guardian controlla rischio, log e cloud": "Guardian contrôle risque, logs et cloud",
      "Audit, protezione dati e segnali admin rendono leggibile cosa sta succedendo all'ecosistema.": "Audit, protection des données et signaux admin rendent l’état de l’écosystème lisible.",
      "Una sessione. Più funzioni. Stato leggibile.": "Une session. Plus de fonctions. Un état lisible.",
      "Velora Search": "Velora Search",
      "Cerca contenuti, moduli e zone pubblicate senza perdere il contesto del portale.": "Recherchez contenus, modules et zones publiées sans perdre le contexte du portail.",
      "VeloMail e Cloud": "VeloMail et Cloud",
      "Messaggi, file e account lavorano insieme con sessione persistente e controlli Guardian.": "Messages, fichiers et compte travaillent ensemble avec session persistante et contrôles Guardian.",
      "Publisher Studio": "Publisher Studio",
      "Prepara manifest, valida una pubblicazione e segui lo stato prima di andare online.": "Préparez un manifest, validez une publication et suivez l’état avant la mise en ligne.",
      "Velora Guardian": "Velora Guardian",
      "Protezione multilivello, audit e segnali admin per account, cloud e operazioni sensibili.": "Protection multiliveau, audit et signaux admin pour comptes, cloud et opérations sensibles.",
      "Il portale è il punto di accesso. Il desktop aggiunge potenza locale.": "Le portail est le point d’accès. Le desktop ajoute la puissance locale.",
      "La beta pubblica serve a provare funzioni reali: account, ricerca, VeloMail, Cloud, Tools, Publisher, nodi e sicurezza Guardian.": "La bêta publique sert à tester des fonctions réelles : compte, recherche, VeloMail, Cloud, Tools, Publisher, nœuds et sécurité Guardian.",
      "verifica": "vérification"
    },
    de: {
      "VELORA PUBLIC BETA": "VELORA PUBLIC BETA",
      "Velora unisce browser, search, VeloMail, Cloud, Publisher, Tools, nodi e sicurezza in un portale unico. Entri, scegli cosa fare e inizi subito.": "Velora bündelt Browser, Suche, VeloMail, Cloud, Publisher, Tools, Knoten und Sicherheit in einem Portal. Einloggen, auswählen, starten.",
      "Desktop e mobile": "Desktop und mobil",
      "Cloud protetto": "Geschützte Cloud",
      "Velora Live Console": "Velora Live Console",
      "Ricerca interna": "Interne Suche",
      "Trova servizi Velora senza uscire dal portale": "Velora-Dienste finden, ohne das Portal zu verlassen",
      "Search apre contenuti, strumenti e zone pubblicate dentro l'ambiente Velora, con lo stesso account e stato di sicurezza.": "Search öffnet Inhalte, Tools und veröffentlichte Zonen in Velora, mit demselben Konto und Sicherheitsstatus.",
      "Carica file e ritrovali nel tuo account": "Dateien hochladen und im Konto wiederfinden",
      "Velora Cloud collega spazio utente, sessione stabile e controlli Guardian per proteggere i dati personali.": "Velora Cloud verbindet Speicher, stabile Sitzung und Guardian-Prüfungen zum Schutz persönlicher Daten.",
      "Comunicazione": "Kommunikation",
      "VeloMail usa la stessa identita Velora": "VeloMail nutzt dieselbe Velora-Identität",
      "Invio, ricezione e forum condividono lo stesso account, senza profili paralleli o login separati.": "Senden, Empfangen und Forum teilen dasselbe Konto, ohne Parallelprofile oder getrennte Logins.",
      "Prepara una zona prima di pubblicarla": "Zone vor der Veröffentlichung vorbereiten",
      "Publisher Studio guida manifest, validazione, login Velora e stato pubblicazione prima della messa online.": "Publisher Studio führt Manifest, Validierung, Velora Login und Veröffentlichungsstatus vor dem Onlinegang.",
      "Guardian controlla rischio, log e cloud": "Guardian prüft Risiko, Logs und Cloud",
      "Audit, protezione dati e segnali admin rendono leggibile cosa sta succedendo all'ecosistema.": "Audit, Datenschutz und Admin-Signale machen den Zustand des Ökosystems lesbar.",
      "Una sessione. Più funzioni. Stato leggibile.": "Eine Sitzung. Mehr Funktionen. Klarer Status.",
      "Velora Search": "Velora Search",
      "Cerca contenuti, moduli e zone pubblicate senza perdere il contesto del portale.": "Inhalte, Module und veröffentlichte Zonen suchen, ohne den Portalkontext zu verlieren.",
      "VeloMail e Cloud": "VeloMail und Cloud",
      "Messaggi, file e account lavorano insieme con sessione persistente e controlli Guardian.": "Nachrichten, Dateien und Konto arbeiten mit persistenter Sitzung und Guardian-Prüfungen zusammen.",
      "Publisher Studio": "Publisher Studio",
      "Prepara manifest, valida una pubblicazione e segui lo stato prima di andare online.": "Manifest vorbereiten, Veröffentlichung validieren und Status vor dem Onlinegang verfolgen.",
      "Velora Guardian": "Velora Guardian",
      "Protezione multilivello, audit e segnali admin per account, cloud e operazioni sensibili.": "Mehrstufiger Schutz, Audit und Admin-Signale für Konten, Cloud und sensible Vorgänge.",
      "Il portale è il punto di accesso. Il desktop aggiunge potenza locale.": "Das Portal ist der Zugangspunkt. Desktop ergänzt lokale Leistung.",
      "La beta pubblica serve a provare funzioni reali: account, ricerca, VeloMail, Cloud, Tools, Publisher, nodi e sicurezza Guardian.": "Die öffentliche Beta testet reale Funktionen: Konto, Suche, VeloMail, Cloud, Tools, Publisher, Knoten und Guardian-Sicherheit.",
      "verifica": "Prüfung"
    },
    es: {
      "VELORA PUBLIC BETA": "BETA PUBLICA VELORA",
      "Velora unisce browser, search, VeloMail, Cloud, Publisher, Tools, nodi e sicurezza in un portale unico. Entri, scegli cosa fare e inizi subito.": "Velora une navegador, búsqueda, VeloMail, Cloud, Publisher, Tools, nodos y seguridad en un único portal. Entra, elige y empieza.",
      "Desktop e mobile": "Desktop y móvil",
      "Cloud protetto": "Cloud protegido",
      "Velora Live Console": "Consola Velora",
      "Ricerca interna": "Búsqueda interna",
      "Trova servizi Velora senza uscire dal portale": "Encuentra servicios Velora sin salir del portal",
      "Search apre contenuti, strumenti e zone pubblicate dentro l'ambiente Velora, con lo stesso account e stato di sicurezza.": "Search abre contenidos, herramientas y zonas publicadas dentro de Velora, con la misma cuenta y estado de seguridad.",
      "Carica file e ritrovali nel tuo account": "Sube archivos y encuéntralos en tu cuenta",
      "Velora Cloud collega spazio utente, sessione stabile e controlli Guardian per proteggere i dati personali.": "Velora Cloud conecta espacio de usuario, sesión estable y controles Guardian para proteger datos personales.",
      "Comunicazione": "Comunicación",
      "VeloMail usa la stessa identita Velora": "VeloMail usa la misma identidad Velora",
      "Invio, ricezione e forum condividono lo stesso account, senza profili paralleli o login separati.": "Envío, recepción y foro comparten la misma cuenta, sin perfiles paralelos ni logins separados.",
      "Prepara una zona prima di pubblicarla": "Prepara una zona antes de publicarla",
      "Publisher Studio guida manifest, validazione, login Velora e stato pubblicazione prima della messa online.": "Publisher Studio guía manifest, validación, Login Velora y estado de publicación antes de ponerlo online.",
      "Guardian controlla rischio, log e cloud": "Guardian controla riesgo, logs y cloud",
      "Audit, protezione dati e segnali admin rendono leggibile cosa sta succedendo all'ecosistema.": "Auditoría, protección de datos y señales admin hacen legible el estado del ecosistema.",
      "Una sessione. Più funzioni. Stato leggibile.": "Una sesión. Más funciones. Estado claro.",
      "Velora Search": "Velora Search",
      "Cerca contenuti, moduli e zone pubblicate senza perdere il contesto del portale.": "Busca contenidos, módulos y zonas publicadas sin perder el contexto del portal.",
      "VeloMail e Cloud": "VeloMail y Cloud",
      "Messaggi, file e account lavorano insieme con sessione persistente e controlli Guardian.": "Mensajes, archivos y cuenta trabajan juntos con sesión persistente y controles Guardian.",
      "Publisher Studio": "Publisher Studio",
      "Prepara manifest, valida una pubblicazione e segui lo stato prima di andare online.": "Prepara manifest, valida una publicación y sigue el estado antes de ponerla online.",
      "Velora Guardian": "Velora Guardian",
      "Protezione multilivello, audit e segnali admin per account, cloud e operazioni sensibili.": "Protección multinivel, auditoría y señales admin para cuentas, cloud y operaciones sensibles.",
      "Il portale è il punto di accesso. Il desktop aggiunge potenza locale.": "El portal es el punto de acceso. Desktop añade potencia local.",
      "La beta pubblica serve a provare funzioni reali: account, ricerca, VeloMail, Cloud, Tools, Publisher, nodi e sicurezza Guardian.": "La beta pública prueba funciones reales: cuenta, búsqueda, VeloMail, Cloud, Tools, Publisher, nodos y seguridad Guardian.",
      "verifica": "verificación"
    }
  };
  for (const [language, values] of Object.entries(additions)) {
    dict[language] = { ...(dict[language] ?? {}), ...values };
  }
  dict.en = {
    ...(dict.en ?? {}),
    "Cerca zone, apri strumenti, usa VeloMail, salva file e pubblica contenuti da un solo account": "Search zones, open tools, use VeloMail, save files and publish content from one account",
    "Cerca o inserisci una zona": "Search or enter a zone",
    "Vai": "Go",
    "Apri Velora": "Open Velora",
    "Scarica beta": "Download beta",
    "Trova contenuti e zone": "Find content and zones",
    "Search interno, guide e strumenti Velora": "Internal search, guides and Velora tools",
    "Salva file personali": "Save personal files",
    "Apri VeloMail": "Open VeloMail",
    "Messaggi tra account Velora": "Messages between Velora accounts",
    "Usa strumenti rapidi": "Use quick tools",
    "Wallet, hash, link check, TTS e sicurezza": "Wallet, hash, link check, TTS and security",
    "rete operativa": "network online",
    "Browser integrato": "Integrated browser",
    "Accesso immediato da browser": "Instant browser access",
    "Strumenti pronti per uso quotidiano": "Tools ready for everyday use",
    "Controllo sito, upload e stato online": "Site check, upload and online status",
    "Protezione account, cloud e attività sensibili": "Account, cloud and sensitive activity protection"
  };
  dict.fr = {
    ...(dict.fr ?? {}),
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "Un portail unique pour rechercher, communiquer, protéger les fichiers et publier des zones Velora",
    "Entra nel portale": "Entrer dans le portail",
    "Scarica beta": "Télécharger la bêta",
    "Browser integrato": "Navigateur intégré",
    "Zone, guide, tools, contenuti Velora": "Zones, guides, outils, contenus Velora",
    "Proteggi file": "Protéger les fichiers",
    "Cloud personale con account unico": "Cloud personnel avec compte unique",
    "Usa VeloMail": "Utiliser VeloMail",
    "Messaggi tra identità Velora": "Messages entre identités Velora",
    "Pubblica una zona": "Publier une zone",
    "Validazione, manifest e messa online": "Validation, manifest et mise en ligne",
    "Rete operativa": "Réseau opérationnel",
    "Guardian attivo": "Guardian actif",
    "Accesso immediato da browser": "Accès immédiat depuis le navigateur",
    "Strumenti pronti per uso quotidiano": "Outils prêts pour l’usage quotidien",
    "Controllo sito, upload e stato online": "Contrôle du site, upload et état en ligne",
    "Protezione account, cloud e attività sensibili": "Protection du compte, du cloud et des activités sensibles"
  };
  dict.de = {
    ...(dict.de ?? {}),
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "Ein Portal zum Suchen, Kommunizieren, Schützen von Dateien und Veröffentlichen von Velora-Zonen",
    "Entra nel portale": "Portal öffnen",
    "Scarica beta": "Beta herunterladen",
    "Browser integrato": "Integrierter Browser",
    "Zone, guide, tools, contenuti Velora": "Zonen, Guides, Tools, Velora-Inhalte",
    "Proteggi file": "Dateien schützen",
    "Cloud personale con account unico": "Persönliche Cloud mit einem Konto",
    "Usa VeloMail": "VeloMail nutzen",
    "Messaggi tra identità Velora": "Nachrichten zwischen Velora-Identitäten",
    "Pubblica una zona": "Zone veröffentlichen",
    "Validazione, manifest e messa online": "Validierung, Manifest und Veröffentlichung",
    "Rete operativa": "Netzwerk online",
    "Guardian attivo": "Guardian aktiv",
    "Accesso immediato da browser": "Sofortzugang im Browser",
    "Strumenti pronti per uso quotidiano": "Tools für den Alltag",
    "Controllo sito, upload e stato online": "Site-Prüfung, Upload und Online-Status",
    "Protezione account, cloud e attività sensibili": "Schutz für Konto, Cloud und sensible Aktivitäten"
  };
  dict.es = {
    ...(dict.es ?? {}),
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "Un portal único para buscar, comunicar, proteger archivos y publicar zonas Velora",
    "Entra nel portale": "Entrar al portal",
    "Scarica beta": "Descargar beta",
    "Browser integrato": "Navegador integrado",
    "Zone, guide, tools, contenuti Velora": "Zonas, guías, herramientas, contenidos Velora",
    "Proteggi file": "Proteger archivos",
    "Cloud personale con account unico": "Cloud personal con cuenta única",
    "Usa VeloMail": "Usar VeloMail",
    "Messaggi tra identità Velora": "Mensajes entre identidades Velora",
    "Pubblica una zona": "Publicar una zona",
    "Validazione, manifest e messa online": "Validación, manifest y puesta online",
    "Rete operativa": "Red operativa",
    "Guardian attivo": "Guardian activo",
    "Accesso immediato da browser": "Acceso inmediato desde navegador",
    "Strumenti pronti per uso quotidiano": "Herramientas listas para uso diario",
    "Controllo sito, upload e stato online": "Control del sitio, upload y estado online",
    "Protezione account, cloud e attività sensibili": "Protección de cuenta, cloud y actividades sensibles"
  };
  dict.ru = {
    ...(dict.ru ?? {}),
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "Единый портал для поиска, общения, защиты файлов и публикации зон Velora",
    "Entra nel portale": "Войти в портал",
    "Scarica beta": "Скачать бета",
    "Browser integrato": "Встроенный браузер",
    "Zone, guide, tools, contenuti Velora": "Зоны, руководства, инструменты, контент Velora",
    "Proteggi file": "Защитить файлы",
    "Cloud personale con account unico": "Личное облако с единым аккаунтом",
    "Usa VeloMail": "Открыть VeloMail",
    "Messaggi tra identità Velora": "Сообщения между идентичностями Velora",
    "Pubblica una zona": "Опубликовать зону",
    "Validazione, manifest e messa online": "Проверка, manifest и публикация онлайн",
    "Rete operativa": "Сеть работает",
    "Guardian attivo": "Guardian активен",
    "Accesso immediato da browser": "Быстрый доступ из браузера",
    "Strumenti pronti per uso quotidiano": "Инструменты для ежедневного использования",
    "Controllo sito, upload e stato online": "Проверка сайта, загрузка и онлайн-статус",
    "Protezione account, cloud e attività sensibili": "Защита аккаунта, cloud и чувствительных действий"
  };
  dict.zh = {
    ...(dict.zh ?? {}),
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "一个门户即可搜索、通信、保护文件并发布 Velora 区域",
    "Entra nel portale": "进入门户",
    "Scarica beta": "下载 Beta",
    "Browser integrato": "集成浏览器",
    "Zone, guide, tools, contenuti Velora": "区域、指南、工具、Velora 内容",
    "Proteggi file": "保护文件",
    "Cloud personale con account unico": "单一账号的个人 Cloud",
    "Usa VeloMail": "使用 VeloMail",
    "Messaggi tra identità Velora": "Velora 身份之间的消息",
    "Pubblica una zona": "发布区域",
    "Validazione, manifest e messa online": "验证、manifest 与上线",
    "Rete operativa": "网络运行中",
    "Guardian attivo": "Guardian 已启用",
    "Accesso immediato da browser": "浏览器即时访问",
    "Strumenti pronti per uso quotidiano": "日常可用工具",
    "Controllo sito, upload e stato online": "站点检查、上传和在线状态",
    "Protezione account, cloud e attività sensibili": "账号、cloud 和敏感操作保护"
  };
  dict.ru = {
    ...(dict.ru ?? {}),
    "VELORA PUBLIC BETA": "ПУБЛИЧНАЯ БЕТА VELORA",
    "Velora unisce browser, search, VeloMail, Cloud, Publisher, Tools, nodi e sicurezza in un portale unico. Entri, scegli cosa fare e inizi subito.": "Velora объединяет браузер, поиск, VeloMail, Cloud, Publisher, Tools, узлы и безопасность в одном портале. Войдите, выберите действие и начните сразу.",
    "Desktop e mobile": "ПК и мобильные устройства",
    "Cloud protetto": "Защищенный Cloud",
    "Velora Live Console": "Живая консоль Velora",
    "Ricerca interna": "Внутренний поиск",
    "Trova servizi Velora senza uscire dal portale": "Находите сервисы Velora, не выходя из портала",
    "Search apre contenuti, strumenti e zone pubblicate dentro l'ambiente Velora, con lo stesso account e stato di sicurezza.": "Search открывает контент, инструменты и опубликованные зоны внутри Velora с тем же аккаунтом и статусом безопасности.",
    "Carica file e ritrovali nel tuo account": "Загружайте файлы и находите их в своем аккаунте",
    "Velora Cloud collega spazio utente, sessione stabile e controlli Guardian per proteggere i dati personali.": "Velora Cloud соединяет пользовательское хранилище, стабильную сессию и проверки Guardian для защиты личных данных.",
    "Comunicazione": "Связь",
    "VeloMail usa la stessa identita Velora": "VeloMail использует ту же идентичность Velora",
    "Invio, ricezione e forum condividono lo stesso account, senza profili paralleli o login separati.": "Отправка, получение и форум используют один аккаунт, без параллельных профилей и отдельных входов.",
    "Prepara una zona prima di pubblicarla": "Подготовьте зону перед публикацией",
    "Publisher Studio guida manifest, validazione, login Velora e stato pubblicazione prima della messa online.": "Publisher Studio ведет через manifest, проверку, Velora Login и статус публикации перед выходом онлайн.",
    "Guardian controlla rischio, log e cloud": "Guardian проверяет риски, журналы и cloud",
    "Audit, protezione dati e segnali admin rendono leggibile cosa sta succedendo all'ecosistema.": "Аудит, защита данных и сигналы администратора делают состояние экосистемы понятным.",
    "Una sessione. Più funzioni. Stato leggibile.": "Одна сессия. Больше функций. Понятный статус.",
    "Velora Search": "Velora Search",
    "Cerca contenuti, moduli e zone pubblicate senza perdere il contesto del portale.": "Ищите контент, модули и опубликованные зоны, не теряя контекст портала.",
    "VeloMail e Cloud": "VeloMail и Cloud",
    "Messaggi, file e account lavorano insieme con sessione persistente e controlli Guardian.": "Сообщения, файлы и аккаунт работают вместе со стабильной сессией и проверками Guardian.",
    "Publisher Studio": "Publisher Studio",
    "Prepara manifest, valida una pubblicazione e segui lo stato prima di andare online.": "Подготовьте manifest, проверьте публикацию и отслеживайте статус перед выходом онлайн.",
    "Velora Guardian": "Velora Guardian",
    "Protezione multilivello, audit e segnali admin per account, cloud e operazioni sensibili.": "Многоуровневая защита, аудит и сигналы администратора для аккаунтов, cloud и чувствительных операций.",
    "Il portale è il punto di accesso. Il desktop aggiunge potenza locale.": "Портал является точкой доступа. Desktop добавляет локальную мощность.",
    "La beta pubblica serve a provare funzioni reali: account, ricerca, VeloMail, Cloud, Tools, Publisher, nodi e sicurezza Guardian.": "Публичная бета нужна для теста реальных функций: аккаунт, поиск, VeloMail, Cloud, Tools, Publisher, узлы и Guardian.",
    "verifica": "проверка"
  };
  dict.zh = {
    ...(dict.zh ?? {}),
    "VELORA PUBLIC BETA": "VELORA 公测版",
    "Velora unisce browser, search, VeloMail, Cloud, Publisher, Tools, nodi e sicurezza in un portale unico. Entri, scegli cosa fare e inizi subito.": "Velora 将浏览器、搜索、VeloMail、Cloud、Publisher、Tools、节点和安全能力集中在一个门户中。登录后选择操作，立即开始。",
    "Desktop e mobile": "桌面与移动端",
    "Cloud protetto": "受保护的 Cloud",
    "Velora Live Console": "Velora 实时控制台",
    "Ricerca interna": "内部搜索",
    "Trova servizi Velora senza uscire dal portale": "无需离开门户即可找到 Velora 服务",
    "Search apre contenuti, strumenti e zone pubblicate dentro l'ambiente Velora, con lo stesso account e stato di sicurezza.": "Search 在 Velora 环境中打开内容、工具和已发布区域，并保持同一账号与安全状态。",
    "Carica file e ritrovali nel tuo account": "上传文件，并在账号中随时找到",
    "Velora Cloud collega spazio utente, sessione stabile e controlli Guardian per proteggere i dati personali.": "Velora Cloud 将用户空间、稳定会话和 Guardian 检查连接起来，以保护个人数据。",
    "Comunicazione": "通信",
    "VeloMail usa la stessa identita Velora": "VeloMail 使用同一个 Velora 身份",
    "Invio, ricezione e forum condividono lo stesso account, senza profili paralleli o login separati.": "发送、接收和论坛共用同一账号，不需要并行资料或单独登录。",
    "Prepara una zona prima di pubblicarla": "发布前先准备区域",
    "Publisher Studio guida manifest, validazione, login Velora e stato pubblicazione prima della messa online.": "Publisher Studio 会在上线前引导完成 manifest、验证、Velora Login 和发布状态检查。",
    "Guardian controlla rischio, log e cloud": "Guardian 检查风险、日志和 cloud",
    "Audit, protezione dati e segnali admin rendono leggibile cosa sta succedendo all'ecosistema.": "审计、数据保护和管理员信号让生态状态清晰可读。",
    "Una sessione. Più funzioni. Stato leggibile.": "一个会话。更多功能。状态清晰。",
    "Velora Search": "Velora Search",
    "Cerca contenuti, moduli e zone pubblicate senza perdere il contesto del portale.": "在不离开门户上下文的情况下搜索内容、模块和已发布区域。",
    "VeloMail e Cloud": "VeloMail 与 Cloud",
    "Messaggi, file e account lavorano insieme con sessione persistente e controlli Guardian.": "消息、文件和账号通过持久会话与 Guardian 检查协同工作。",
    "Publisher Studio": "Publisher Studio",
    "Prepara manifest, valida una pubblicazione e segui lo stato prima di andare online.": "准备 manifest、验证发布，并在上线前跟踪状态。",
    "Velora Guardian": "Velora Guardian",
    "Protezione multilivello, audit e segnali admin per account, cloud e operazioni sensibili.": "为账号、cloud 和敏感操作提供多层保护、审计和管理员信号。",
    "Il portale è il punto di accesso. Il desktop aggiunge potenza locale.": "门户是入口，桌面端提供本地能力。",
    "La beta pubblica serve a provare funzioni reali: account, ricerca, VeloMail, Cloud, Tools, Publisher, nodi e sicurezza Guardian.": "公测版用于测试真实功能：账号、搜索、VeloMail、Cloud、Tools、Publisher、节点和 Guardian 安全。",
    "verifica": "检查"
  };
  Object.assign(dict.ru, {
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "Единый портал для поиска, общения, защиты файлов и публикации зон Velora",
    "Entra nel portale": "Войти в портал",
    "Scarica beta": "Скачать бета",
    "Browser integrato": "Встроенный браузер",
    "Zone, guide, tools, contenuti Velora": "Зоны, руководства, инструменты, контент Velora",
    "Proteggi file": "Защитить файлы",
    "Cloud personale con account unico": "Личное облако с единым аккаунтом",
    "Usa VeloMail": "Открыть VeloMail",
    "Messaggi tra identità Velora": "Сообщения между идентичностями Velora",
    "Pubblica una zona": "Опубликовать зону",
    "Validazione, manifest e messa online": "Проверка, manifest и публикация онлайн",
    "Rete operativa": "Сеть работает",
    "Guardian attivo": "Guardian активен",
    "Accesso immediato da browser": "Быстрый доступ из браузера",
    "Strumenti pronti per uso quotidiano": "Инструменты для ежедневного использования",
    "Controllo sito, upload e stato online": "Проверка сайта, загрузка и онлайн-статус",
    "Protezione account, cloud e attività sensibili": "Защита аккаунта, cloud и чувствительных действий"
  });
  Object.assign(dict.zh, {
    "Un portale unico per cercare, comunicare, proteggere file e pubblicare zone Velora": "一个门户即可搜索、通信、保护文件并发布 Velora 区域",
    "Entra nel portale": "进入门户",
    "Scarica beta": "下载 Beta",
    "Browser integrato": "集成浏览器",
    "Zone, guide, tools, contenuti Velora": "区域、指南、工具、Velora 内容",
    "Proteggi file": "保护文件",
    "Cloud personale con account unico": "单一账号的个人 Cloud",
    "Usa VeloMail": "使用 VeloMail",
    "Messaggi tra identità Velora": "Velora 身份之间的消息",
    "Pubblica una zona": "发布区域",
    "Validazione, manifest e messa online": "验证、manifest 与上线",
    "Rete operativa": "网络运行中",
    "Guardian attivo": "Guardian 已启用",
    "Accesso immediato da browser": "浏览器即时访问",
    "Strumenti pronti per uso quotidiano": "日常可用工具",
    "Controllo sito, upload e stato online": "站点检查、上传和在线状态",
    "Protezione account, cloud e attività sensibili": "账号、cloud 和敏感操作保护"
  });
  return dict;
}

function veloraI18nScript() {
  return `<script>
(() => {
  const key = "velora.language";
  const supported = ["it","en","fr","de","es","ru","zh"];
  const names = { it:"Italiano", en:"English", fr:"Français", de:"Deutsch", es:"Español", ru:"Русский", zh:"中文" };
  const pick = () => {
    const saved = localStorage.getItem(key);
    if (supported.includes(saved)) return saved;
    const nav = (navigator.language || "it").slice(0,2).toLowerCase();
    return supported.includes(nav) ? nav : "it";
  };
  const dict = ${JSON.stringify(veloraI18nDictionaryComplete())};
  const phrases = ${JSON.stringify(veloraPhraseDictionary())};
  const placeholders = ${JSON.stringify(veloraPlaceholderDictionary())};
  Object.assign(placeholders.en ||= {}, { "Cerca o inserisci una zona": "Search or enter a zone" });
  Object.assign(placeholders.fr ||= {}, { "Cerca o inserisci una zona": "Rechercher ou saisir une zone" });
  Object.assign(placeholders.de ||= {}, { "Cerca o inserisci una zona": "Suchen oder Zone eingeben" });
  Object.assign(placeholders.es ||= {}, { "Cerca o inserisci una zona": "Buscar o introducir una zona" });
  Object.assign(placeholders.ru ||= {}, { "Cerca o inserisci una zona": "Искать или ввести зону" });
  Object.assign(placeholders.zh ||= {}, { "Cerca o inserisci una zona": "搜索或输入区域" });
  function tr(text, lang = pick()) {
    const source = String(text || "").trim();
    if (!source || lang === "it") return source;
    const exact = dict[lang]?.[source];
    if (exact) return exact;
    let translated = source;
    Object.entries(phrases[lang] || {}).sort((a,b) => b[0].length - a[0].length).forEach(([from,to]) => {
      translated = translated.split(from).join(String(to));
    });
    return translated;
  }
  function apply(root = document) {
    const lang = pick();
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-velora-language]").forEach(select => {
      select.value = lang;
      select.onchange = () => { localStorage.setItem(key, select.value); apply(document); window.dispatchEvent(new CustomEvent("velora:language", { detail: { language: select.value } })); };
    });
    root.querySelectorAll("button,a,b,span,p,h1,h2,h3,dt,dd,li,label,summary,small,option,div.card span,div.card b").forEach(el => {
      if (el.closest("[data-no-translate]")) return;
      if (el.childElementCount > 0) return;
      const raw = el.dataset.vlSrc || el.textContent.trim();
      if (!raw) return;
      el.dataset.vlSrc = raw;
      const next = tr(raw, lang);
      if (next && el.textContent !== next) el.textContent = next;
    });
    root.querySelectorAll("input,textarea").forEach(el => {
      const raw = el.dataset.vlPhSrc || el.getAttribute("placeholder") || "";
      if (!raw) return;
      el.dataset.vlPhSrc = raw;
      el.setAttribute("placeholder", placeholders[lang]?.[raw] || raw);
      const label = el.getAttribute("aria-label");
      if (label) el.setAttribute("aria-label", dict[lang]?.[label] || label);
    });
  }
  window.veloraLanguage = () => pick();
  window.veloraTranslate = tr;
  window.veloraApplyLanguage = apply;
  window.addEventListener("DOMContentLoaded", () => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, pick());
    apply(document);
    const observer = new MutationObserver(() => apply(document));
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
</script>`;
}

function zoneTranslationRuntime(address: string) {
  return `<script>
(() => {
  function ready(){
    const lang=(localStorage.getItem("velora.language")||navigator.language||"it").slice(0,2).toLowerCase();
    const box=document.querySelector("[data-velora-zone-translate]");
    if(!box || lang==="it") return;
    box.style.display="inline-flex";
    const label={en:"Translate page",fr:"Traduire la page",de:"Seite übersetzen",es:"Traducir página",ru:"Перевести страницу",zh:"翻译页面"}[lang]||"Translate page";
    box.textContent=label;
    box.onclick=()=>{window.veloraApplyLanguage&&window.veloraApplyLanguage(document);document.body.dataset.veloraTranslated=lang;box.textContent={en:"Translated",fr:"Traduit",de:"Übersetzt",es:"Traducida",ru:"Переведено",zh:"已翻译"}[lang]||"Translated";};
  }
  window.addEventListener("DOMContentLoaded",ready);
  window.addEventListener("velora:language",ready);
})();
</script>`;
}

function veloraI18nDictionary() {
  return {
    en: {
      "VELORA BETA PUBBLICA": "VELORA PUBLIC BETA", "Naviga zone. Pubblica siti. Proteggi dati.": "Browse zones. Publish sites. Protect data.", "Un portale operativo sopra il web tradizionale: account unico, ricerca interna, siti pubblicati, VeloMail, Cloud, Tools e nodi nello stesso ambiente.": "An operational portal above the traditional web: unified account, internal search, published sites, VeloMail, Cloud, Tools and nodes in one environment.",
      "Portale online": "Portal online", "Account @velora": "@velora account", "Windows e Mac": "Windows and Mac", "Mobile ready": "Mobile ready", "Apri": "Open", "Zona": "Zone", "online": "online", "attivo": "active", "protetto": "protected", "pronti": "ready", "Search, VeloMail, Cloud e Publisher condividono la stessa sessione": "Search, VeloMail, Cloud and Publisher share the same session",
      "Entra senza attrito": "Enter without friction", "Apri zone reali": "Open real zones", "Pubblica con controllo": "Publish with control", "Gestisci sicurezza": "Manage security", "Da browser o desktop. Un solo account per portale, mail, cloud, forum e pubblicazione.": "From browser or desktop. One account for portal, mail, cloud, forum and publishing.", "Il motore interno porta a siti pubblicati, contenuti Oceano e strumenti Velora.": "The internal engine opens published sites, Oceano content and Velora tools.", "Manifest, validazione, login Velora e stato pubblicazione leggibile prima di andare online.": "Manifest, validation, Velora Login and readable publishing status before going online.", "Guardian, audit, privacy, cookie tecnici e protezione Cloud sono parte dell’esperienza.": "Guardian, audit, privacy, technical cookies and Cloud protection are part of the experience.", "PER CHI LO PROVA OGGI": "FOR PEOPLE TRYING IT TODAY", "Velora è già usabile dal portale. Il desktop aggiunge potenza locale.": "Velora is already usable from the portal. Desktop adds local power.", "La beta serve a testare accesso, ricerca, zone pubblicate, VeloMail, Cloud, Tools e Publisher con persone reali, non con schermate simulate.": "The beta tests access, search, published zones, VeloMail, Cloud, Tools and Publisher with real people, not simulated screens.",
      "VELORA - L'UPPER WEB": "VELORA - THE UPPER WEB", "Un nuovo livello per navigare, pubblicare e proteggere contenuti": "A new level for browsing, publishing and protecting content", "HTTPS attivo": "HTTPS active", "Account unico": "Unified account", "Beta pubblica": "Public beta", "Entra dal portale": "Enter from the portal", "Cerca zone e contenuti": "Search zones and content", "Pubblica siti Velora": "Publish Velora sites", "Proteggi account e cloud": "Protect account and cloud", "VISIONE": "VISION", "Velora non sostituisce Internet. Lo eleva.": "Velora does not replace the Internet. It elevates it.",
      "Usa Velora subito da browser, iPhone, Android, Windows e Mac senza installazione obbligatoria.": "Use Velora immediately from browser, iPhone, Android, Windows and Mac with no mandatory installation.", "Apri siti pubblicati, contenuti Oceano e strumenti Velora da un motore interno dedicato.": "Open published sites, Oceano content and Velora tools from a dedicated internal engine.", "Prepara manifest, login Velora e validazione per rendere online progetti e applicazioni.": "Prepare manifests, Velora Login and validation to bring projects and applications online.", "Guardian, audit, policy cookie, privacy e controlli sicurezza sono integrati nel sistema.": "Guardian, audit, cookie policy, privacy and security checks are built into the system.", "Un ambiente sopra il web tradizionale dove identita, pubblicazione, ricerca, comunicazione e protezione lavorano insieme invece di restare separati.": "An environment above the traditional web where identity, publishing, search, communication and protection work together instead of staying separate.",
      "Portale": "Portal", "Sicurezza": "Security", "Guida": "Guide", "Termini": "Terms", "Accetta": "Accept", "Leggi policy": "Read policy",
      "Velora Beta pubblica": "Velora Public Beta", "Apri Velora": "Open Velora", "Scarica app beta": "Download beta app", "Scarica Velora": "Download Velora",
      "Portale Velora": "Velora Portal", "Scarica per Windows": "Download for Windows", "Scarica per Mac Apple Silicon": "Download for Mac Apple Silicon", "Scarica per Mac Intel": "Download for Mac Intel", "Scarica nodo NAS": "Download NAS node", "Verifica SHA-256": "Verify SHA-256",
      "Versione": "Version", "Data build": "Build date", "Stato Mac": "Mac status", "Installazione su Mac": "Installation on Mac", "Wallet Mining Partner": "Mining Partner Wallet",
      "Home": "Home", "Browser": "Browser", "Search": "Search", "VeloMail": "VeloMail", "Cloud": "Cloud", "Publisher": "Publisher", "Tools": "Tools", "Forum": "Forum", "Mining": "Mining", "Nodi": "Nodes", "Oceano": "Oceano", "Impostazioni": "Settings", "Account": "Account",
      "Cerca": "Search", "Tema": "Theme", "Profilo": "Profile", "Installa": "Install", "Esci": "Sign out", "Accedi a Velora": "Sign in to Velora", "Crea account": "Create account", "Accedi": "Sign in", "Account attivo": "Active account", "Accesso non effettuato": "Not signed in", "Accesso effettuato": "Signed in", "Account creato": "Account created",
      "Portale universale": "Universal portal", "Velora senza installazione": "Velora without installation", "Dashboard": "Dashboard", "Cosa posso fare ora": "What can I do now", "Uso rapido": "Quick start", "Come salvarlo": "How to save it",
      "Cerca ora": "Search now", "Apri VeloMail": "Open VeloMail", "Prepara sito": "Prepare site", "Apri zona": "Open zone", "Carica": "Upload", "File": "Files", "Tools disponibili": "Available tools", "Invia": "Send", "Aggiorna": "Refresh", "Controlla NAS": "Check NAS",
      "Traduci": "Translate", "Riassumi": "Summarize", "Wallet check": "Wallet check", "Privacy check": "Privacy check", "Risultato pronto qui": "Result appears here"
    },
    fr: {
      "Portale": "Portail", "Sicurezza": "Sécurité", "Guida": "Guide", "Termini": "Conditions", "Accetta": "Accepter", "Leggi policy": "Lire la politique",
      "Velora Beta pubblica": "Bêta publique Velora", "Apri Velora": "Ouvrir Velora", "Scarica app beta": "Télécharger la bêta", "Scarica Velora": "Télécharger Velora",
      "Portale Velora": "Portail Velora", "Scarica per Windows": "Télécharger pour Windows", "Scarica per Mac Apple Silicon": "Télécharger pour Mac Apple Silicon", "Scarica per Mac Intel": "Télécharger pour Mac Intel", "Scarica nodo NAS": "Télécharger le nœud NAS", "Verifica SHA-256": "Vérifier SHA-256",
      "Versione": "Version", "Data build": "Date de build", "Stato Mac": "État Mac", "Installazione su Mac": "Installation sur Mac", "Wallet Mining Partner": "Wallet Mining Partner",
      "Home": "Accueil", "Browser": "Navigateur", "Search": "Recherche", "Cloud": "Cloud", "Publisher": "Publisher", "Tools": "Outils", "Forum": "Forum", "Mining": "Mining", "Nodi": "Nœuds", "Oceano": "Oceano", "Impostazioni": "Réglages", "Account": "Compte",
      "Cerca": "Rechercher", "Tema": "Thème", "Profilo": "Profil", "Installa": "Installer", "Esci": "Déconnexion", "Accedi a Velora": "Connexion à Velora", "Crea account": "Créer un compte", "Accedi": "Connexion", "Account attivo": "Compte actif", "Accesso non effettuato": "Non connecté", "Accesso effettuato": "Connexion réussie", "Account creato": "Compte créé",
      "Portale universale": "Portail universel", "Velora senza installazione": "Velora sans installation", "Dashboard": "Tableau de bord", "Cosa posso fare ora": "Que puis-je faire maintenant", "Uso rapido": "Démarrage rapide", "Come salvarlo": "Comment l’enregistrer",
      "Cerca ora": "Rechercher maintenant", "Apri VeloMail": "Ouvrir VeloMail", "Prepara sito": "Préparer le site", "Apri zona": "Ouvrir la zone", "Carica": "Téléverser", "File": "Fichiers", "Tools disponibili": "Outils disponibles", "Invia": "Envoyer", "Aggiorna": "Actualiser", "Controlla NAS": "Vérifier le NAS",
      "Traduci": "Traduire", "Riassumi": "Résumer", "Wallet check": "Vérifier wallet", "Privacy check": "Contrôle confidentialité", "Risultato pronto qui": "Le résultat s’affiche ici"
    },
    de: {
      "Portale": "Portal", "Sicurezza": "Sicherheit", "Guida": "Anleitung", "Termini": "Bedingungen", "Accetta": "Akzeptieren", "Leggi policy": "Richtlinie lesen",
      "Velora Beta pubblica": "Öffentliche Velora Beta", "Apri Velora": "Velora öffnen", "Scarica app beta": "Beta-App laden", "Scarica Velora": "Velora herunterladen",
      "Portale Velora": "Velora Portal", "Scarica per Windows": "Für Windows herunterladen", "Scarica per Mac Apple Silicon": "Für Mac Apple Silicon herunterladen", "Scarica per Mac Intel": "Für Mac Intel herunterladen", "Scarica nodo NAS": "NAS-Knoten laden", "Verifica SHA-256": "SHA-256 prüfen",
      "Versione": "Version", "Data build": "Build-Datum", "Stato Mac": "Mac-Status", "Installazione su Mac": "Installation auf Mac", "Wallet Mining Partner": "Mining-Partner-Wallet",
      "Home": "Start", "Browser": "Browser", "Search": "Suche", "Cloud": "Cloud", "Publisher": "Publisher", "Tools": "Tools", "Forum": "Forum", "Mining": "Mining", "Nodi": "Knoten", "Oceano": "Oceano", "Impostazioni": "Einstellungen", "Account": "Konto",
      "Cerca": "Suchen", "Tema": "Design", "Profilo": "Profil", "Installa": "Installieren", "Esci": "Abmelden", "Accedi a Velora": "Bei Velora anmelden", "Crea account": "Konto erstellen", "Accedi": "Anmelden", "Account attivo": "Aktives Konto", "Accesso non effettuato": "Nicht angemeldet", "Accesso effettuato": "Angemeldet", "Account creato": "Konto erstellt",
      "Portale universale": "Universelles Portal", "Velora senza installazione": "Velora ohne Installation", "Dashboard": "Dashboard", "Cosa posso fare ora": "Was kann ich jetzt tun", "Uso rapido": "Schnellstart", "Come salvarlo": "So speichern",
      "Cerca ora": "Jetzt suchen", "Apri VeloMail": "VeloMail öffnen", "Prepara sito": "Website vorbereiten", "Apri zona": "Zone öffnen", "Carica": "Hochladen", "File": "Dateien", "Tools disponibili": "Verfügbare Tools", "Invia": "Senden", "Aggiorna": "Aktualisieren", "Controlla NAS": "NAS prüfen",
      "Traduci": "Übersetzen", "Riassumi": "Zusammenfassen", "Wallet check": "Wallet prüfen", "Privacy check": "Datenschutz prüfen", "Risultato pronto qui": "Ergebnis erscheint hier"
    },
    es: {
      "Portale": "Portal", "Sicurezza": "Seguridad", "Guida": "Guía", "Termini": "Términos", "Accetta": "Aceptar", "Leggi policy": "Leer política",
      "Velora Beta pubblica": "Beta pública de Velora", "Apri Velora": "Abrir Velora", "Scarica app beta": "Descargar beta", "Scarica Velora": "Descargar Velora",
      "Portale Velora": "Portal Velora", "Scarica per Windows": "Descargar para Windows", "Scarica per Mac Apple Silicon": "Descargar para Mac Apple Silicon", "Scarica per Mac Intel": "Descargar para Mac Intel", "Scarica nodo NAS": "Descargar nodo NAS", "Verifica SHA-256": "Verificar SHA-256",
      "Versione": "Versión", "Data build": "Fecha de build", "Stato Mac": "Estado Mac", "Installazione su Mac": "Instalación en Mac", "Wallet Mining Partner": "Wallet Mining Partner",
      "Home": "Inicio", "Browser": "Navegador", "Search": "Buscar", "Cloud": "Cloud", "Publisher": "Publisher", "Tools": "Herramientas", "Forum": "Foro", "Mining": "Mining", "Nodi": "Nodos", "Oceano": "Oceano", "Impostazioni": "Ajustes", "Account": "Cuenta",
      "Cerca": "Buscar", "Tema": "Tema", "Profilo": "Perfil", "Installa": "Instalar", "Esci": "Salir", "Accedi a Velora": "Acceder a Velora", "Crea account": "Crear cuenta", "Accedi": "Entrar", "Account attivo": "Cuenta activa", "Accesso non effettuato": "Sin sesión", "Accesso effettuato": "Sesión iniciada", "Account creato": "Cuenta creada",
      "Portale universale": "Portal universal", "Velora senza installazione": "Velora sin instalación", "Dashboard": "Panel", "Cosa posso fare ora": "Qué puedo hacer ahora", "Uso rapido": "Inicio rápido", "Come salvarlo": "Cómo guardarlo",
      "Cerca ora": "Buscar ahora", "Apri VeloMail": "Abrir VeloMail", "Prepara sito": "Preparar sitio", "Apri zona": "Abrir zona", "Carica": "Subir", "File": "Archivos", "Tools disponibili": "Herramientas disponibles", "Invia": "Enviar", "Aggiorna": "Actualizar", "Controlla NAS": "Comprobar NAS",
      "Traduci": "Traducir", "Riassumi": "Resumir", "Wallet check": "Comprobar wallet", "Privacy check": "Comprobar privacidad", "Risultato pronto qui": "El resultado aparece aquí"
    },
    ru: {
      "Portale": "Портал", "Sicurezza": "Безопасность", "Guida": "Руководство", "Termini": "Условия", "Accetta": "Принять", "Leggi policy": "Открыть правила",
      "Velora Beta pubblica": "Публичная бета Velora", "Apri Velora": "Открыть Velora", "Scarica app beta": "Скачать бета-приложение", "Scarica Velora": "Скачать Velora",
      "Portale Velora": "Портал Velora", "Scarica per Windows": "Скачать для Windows", "Scarica per Mac Apple Silicon": "Скачать для Mac Apple Silicon", "Scarica per Mac Intel": "Скачать для Mac Intel", "Scarica nodo NAS": "Скачать NAS-узел", "Verifica SHA-256": "Проверить SHA-256",
      "Versione": "Версия", "Data build": "Дата сборки", "Stato Mac": "Статус Mac", "Installazione su Mac": "Установка на Mac", "Wallet Mining Partner": "Кошелёк Mining Partner",
      "Home": "Главная", "Browser": "Браузер", "Search": "Поиск", "Cloud": "Cloud", "Publisher": "Publisher", "Tools": "Инструменты", "Forum": "Форум", "Mining": "Mining", "Nodi": "Узлы", "Oceano": "Oceano", "Impostazioni": "Настройки", "Account": "Аккаунт",
      "Cerca": "Поиск", "Tema": "Тема", "Profilo": "Профиль", "Installa": "Установить", "Esci": "Выйти", "Accedi a Velora": "Войти в Velora", "Crea account": "Создать аккаунт", "Accedi": "Войти", "Account attivo": "Активный аккаунт", "Accesso non effettuato": "Вход не выполнен", "Accesso effettuato": "Вход выполнен", "Account creato": "Аккаунт создан",
      "Portale universale": "Универсальный портал", "Velora senza installazione": "Velora без установки", "Dashboard": "Панель", "Cosa posso fare ora": "Что можно сделать сейчас", "Uso rapido": "Быстрый старт", "Come salvarlo": "Как сохранить",
      "Cerca ora": "Искать сейчас", "Apri VeloMail": "Открыть VeloMail", "Prepara sito": "Подготовить сайт", "Apri zona": "Открыть зону", "Carica": "Загрузить", "File": "Файлы", "Tools disponibili": "Доступные инструменты", "Invia": "Отправить", "Aggiorna": "Обновить", "Controlla NAS": "Проверить NAS",
      "Traduci": "Перевести", "Riassumi": "Кратко изложить", "Wallet check": "Проверка кошелька", "Privacy check": "Проверка приватности", "Risultato pronto qui": "Результат появится здесь"
    },
    zh: {
      "Portale": "门户", "Sicurezza": "安全", "Guida": "指南", "Termini": "条款", "Accetta": "接受", "Leggi policy": "阅读政策",
      "Velora Beta pubblica": "Velora 公开测试版", "Apri Velora": "打开 Velora", "Scarica app beta": "下载测试版应用", "Scarica Velora": "下载 Velora",
      "Portale Velora": "Velora 门户", "Scarica per Windows": "下载 Windows 版", "Scarica per Mac Apple Silicon": "下载 Mac Apple Silicon 版", "Scarica per Mac Intel": "下载 Mac Intel 版", "Scarica nodo NAS": "下载 NAS 节点", "Verifica SHA-256": "验证 SHA-256",
      "Versione": "版本", "Data build": "构建日期", "Stato Mac": "Mac 状态", "Installazione su Mac": "在 Mac 上安装", "Wallet Mining Partner": "Mining Partner 钱包",
      "Home": "首页", "Browser": "浏览器", "Search": "搜索", "Cloud": "云", "Publisher": "发布", "Tools": "工具", "Forum": "论坛", "Mining": "挖矿", "Nodi": "节点", "Oceano": "Oceano", "Impostazioni": "设置", "Account": "账户",
      "Cerca": "搜索", "Tema": "主题", "Profilo": "资料", "Installa": "安装", "Esci": "退出", "Accedi a Velora": "登录 Velora", "Crea account": "创建账户", "Accedi": "登录", "Account attivo": "当前账户", "Accesso non effettuato": "未登录", "Accesso effettuato": "已登录", "Account creato": "账户已创建",
      "Portale universale": "通用门户", "Velora senza installazione": "无需安装即可使用 Velora", "Dashboard": "仪表板", "Cosa posso fare ora": "现在可以做什么", "Uso rapido": "快速开始", "Come salvarlo": "如何保存",
      "Cerca ora": "立即搜索", "Apri VeloMail": "打开 VeloMail", "Prepara sito": "准备网站", "Apri zona": "打开区域", "Carica": "上传", "File": "文件", "Tools disponibili": "可用工具", "Invia": "发送", "Aggiorna": "刷新", "Controlla NAS": "检查 NAS",
      "Traduci": "翻译", "Riassumi": "摘要", "Wallet check": "钱包检查", "Privacy check": "隐私检查", "Risultato pronto qui": "结果显示在这里"
    }
  };
}

function veloraPlaceholderDictionary() {
  return {
    en: { "Cerca Velora o inserisci una zona": "Search Velora or enter a zone", "nomeutente": "username", "Password": "Password", "Cerca zone, Oceano, tools, guide": "Search zones, Oceano, tools, guides", "Testo, wallet, link o contenuto": "Text, wallet, link or content", "velora.guide, velora.tools, guida": "velora.guide, velora.tools, guide", "velora.guide": "velora.guide", "Scrivi o incolla testo": "Write or paste text", "Email per nuova registrazione": "Email for new registration", "Wallet payout pubblico": "Public payout wallet" },
    fr: { "Cerca Velora o inserisci una zona": "Rechercher dans Velora ou saisir une zone", "nomeutente": "nom utilisateur", "Password": "Mot de passe", "Cerca zone, Oceano, tools, guide": "Rechercher zones, Oceano, outils, guides", "Testo, wallet, link o contenuto": "Texte, wallet, lien ou contenu", "velora.guide, velora.tools, guida": "velora.guide, velora.tools, guide", "velora.guide": "velora.guide", "Scrivi o incolla testo": "Écrire ou coller du texte", "Email per nuova registrazione": "Email pour nouvelle inscription", "Wallet payout pubblico": "Wallet public de payout" },
    de: { "Cerca Velora o inserisci una zona": "Velora durchsuchen oder Zone eingeben", "nomeutente": "Benutzername", "Password": "Passwort", "Cerca zone, Oceano, tools, guide": "Zonen, Oceano, Tools, Anleitungen suchen", "Testo, wallet, link o contenuto": "Text, Wallet, Link oder Inhalt", "velora.guide, velora.tools, guida": "velora.guide, velora.tools, Anleitung", "velora.guide": "velora.guide", "Scrivi o incolla testo": "Text schreiben oder einfügen", "Email per nuova registrazione": "E-Mail für neue Registrierung", "Wallet payout pubblico": "Öffentliche Payout-Wallet" },
    es: { "Cerca Velora o inserisci una zona": "Buscar en Velora o introducir una zona", "nomeutente": "usuario", "Password": "Contraseña", "Cerca zone, Oceano, tools, guide": "Buscar zonas, Oceano, herramientas, guías", "Testo, wallet, link o contenuto": "Texto, wallet, enlace o contenido", "velora.guide, velora.tools, guida": "velora.guide, velora.tools, guía", "velora.guide": "velora.guide", "Scrivi o incolla testo": "Escribe o pega texto", "Email per nuova registrazione": "Email para nuevo registro", "Wallet payout pubblico": "Wallet público de payout" },
    ru: { "Cerca Velora o inserisci una zona": "Искать в Velora или ввести зону", "nomeutente": "имя пользователя", "Password": "Пароль", "Cerca zone, Oceano, tools, guide": "Поиск зон, Oceano, инструментов и руководств", "Testo, wallet, link o contenuto": "Текст, кошелёк, ссылка или контент", "velora.guide, velora.tools, guida": "velora.guide, velora.tools, руководство", "velora.guide": "velora.guide", "Scrivi o incolla testo": "Введите или вставьте текст", "Email per nuova registrazione": "Email для новой регистрации", "Wallet payout pubblico": "Публичный кошелёк для payout" },
    zh: { "Cerca Velora o inserisci una zona": "搜索 Velora 或输入区域", "nomeutente": "用户名", "Password": "密码", "Cerca zone, Oceano, tools, guide": "搜索区域、Oceano、工具、指南", "Testo, wallet, link o contenuto": "文本、钱包、链接或内容", "velora.guide, velora.tools, guida": "velora.guide、velora.tools、指南", "velora.guide": "velora.guide", "Scrivi o incolla testo": "输入或粘贴文本", "Email per nuova registrazione": "新注册邮箱", "Wallet payout pubblico": "公开 payout 钱包" }
  };
}

function veloraPhraseDictionary() {
  return {
    en: {
      "Velora unisce portale web, account unico, motore di ricerca interno, siti pubblicati, VeloMail, Cloud, Tools, nodi e sicurezza Guardian in un unico ecosistema accessibile da ogni dispositivo.": "Velora brings together the web portal, unified account, internal search engine, published sites, VeloMail, Cloud, Tools, nodes and Guardian security in one ecosystem available on every device.",
      "Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.": "Use the portal from any device. Installers are only needed for advanced local features.",
      "Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati": "Recommended. Works on Windows, Mac, iPhone, iPad and Android without installing unsigned files",
      "Installer MSI per mining, nodo locale e funzioni desktop avanzate": "MSI installer for mining, local node and advanced desktop features",
      "Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS": "Advanced non-notarized beta. Use the portal if you want to avoid macOS warnings",
      "Beta avanzata per Mac Intel non notarizzata": "Advanced non-notarized beta for Intel Mac",
      "Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso": "Package for installing a support node on a NAS or always-on PC",
      "Velora e attualmente distribuita come Beta non ancora notarizzata da Apple": "Velora is currently distributed as a beta not yet notarized by Apple",
      "macOS mostrera quindi un avviso al primo avvio": "macOS will therefore show a warning on first launch",
      "Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente": "After manual authorization, Velora should open normally",
      "Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.": "Velora processes the data required for accounts, access, security, site publishing, VeloMail, Cloud, forum, nodes and beta features.",
      "Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.": "Velora only uses technical cookies and storage required for login, security, interface preferences, cookie consent and portal operation.",
      "Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio": "Velora Cloud now protects files with chained encryption, redundant checks and automatic sensitive-data lock when a serious risk is detected",
      "Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.": "Official guide, technical specification, manifest schema and examples for preparing Velora sites and applications.",
      "Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.": "On mobile you do not need to install anything. Save the portal to the Home screen if you want to open it like an app.",
      "Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.": "Enter only your username. Velora automatically adds the account suffix.",
      "Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.": "Search zones, Oceano and guides. Results open in the Velora browser.",
      "VeloMail e forum usano la stessa sessione del tuo account.": "VeloMail and forum use the same session as your account.",
      "Il Publisher guidato genera un manifest valido e riduce gli errori.": "The guided Publisher creates a valid manifest and reduces errors.",
      "Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.": "Ready tools for quick checks, security, content and publishing.",
      "Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.": "Managed through Velora API and authorized NAS Agent. DSM credentials are never shown in the portal.",
      "Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.": "Search indexed content and open results in the Velora Browser.",
      "Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.": "Access from Windows, Mac, iPhone, iPad and Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodes and NAS use the same data as the desktop client."
    },
    fr: {
      "Velora unisce portale web, account unico, motore di ricerca interno, siti pubblicati, VeloMail, Cloud, Tools, nodi e sicurezza Guardian in un unico ecosistema accessibile da ogni dispositivo.": "Velora réunit portail web, compte unique, moteur de recherche interne, sites publiés, VeloMail, Cloud, Tools, nœuds et sécurité Guardian dans un écosystème accessible depuis chaque appareil.",
      "Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.": "Utilisez le portail depuis n’importe quel appareil. Les installateurs servent uniquement aux fonctions locales avancées.",
      "Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati": "Recommandé. Fonctionne sur Windows, Mac, iPhone, iPad et Android sans installer de fichiers non signés",
      "Installer MSI per mining, nodo locale e funzioni desktop avanzate": "Installateur MSI pour mining, nœud local et fonctions desktop avancées",
      "Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS": "Bêta avancée non notarizée. Utilisez le portail pour éviter les alertes macOS",
      "Beta avanzata per Mac Intel non notarizzata": "Bêta avancée non notarizée pour Mac Intel",
      "Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso": "Paquet pour installer un nœud de support sur NAS ou PC toujours allumé",
      "Velora e attualmente distribuita come Beta non ancora notarizzata da Apple": "Velora est actuellement distribuée comme bêta non encore notarizée par Apple",
      "macOS mostrera quindi un avviso al primo avvio": "macOS affichera donc une alerte au premier lancement",
      "Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente": "Après autorisation manuelle, Velora doit s’ouvrir normalement",
      "Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.": "Velora traite les données nécessaires aux comptes, accès, sécurité, publication de sites, VeloMail, Cloud, forum, nœuds et fonctions bêta.",
      "Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.": "Velora utilise uniquement des cookies et stockages techniques nécessaires à la connexion, sécurité, préférences d’interface, consentement cookies et fonctionnement du portail.",
      "Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio": "Velora Cloud protège maintenant les fichiers avec chiffrement chaîné, contrôles redondants et blocage automatique des données sensibles lorsqu’un risque sérieux est détecté",
      "Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.": "Guide officielle, spécification technique, schéma de manifest et exemples pour préparer sites et applications Velora.",
      "Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.": "Depuis un téléphone, aucune installation n’est nécessaire. Enregistrez le portail sur l’écran d’accueil pour l’ouvrir comme une app.",
      "Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.": "Saisissez seulement votre nom utilisateur. Velora ajoute automatiquement le suffixe du compte.",
      "Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.": "Recherchez zones, Oceano et guides. Les résultats s’ouvrent dans le navigateur Velora.",
      "VeloMail e forum usano la stessa sessione del tuo account.": "VeloMail et le forum utilisent la même session que votre compte.",
      "Il Publisher guidato genera un manifest valido e riduce gli errori.": "Le Publisher guidé crée un manifest valide et réduit les erreurs.",
      "Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.": "Outils prêts pour contrôles rapides, sécurité, contenus et publication.",
      "Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.": "Gestion via Velora API et NAS Agent autorisé. Aucune identité DSM n’est affichée dans le portail.",
      "Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.": "Recherche de contenus indexés et ouverture des résultats dans le navigateur Velora.",
      "Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.": "Accédez depuis Windows, Mac, iPhone, iPad et Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nœuds et NAS utilisent les mêmes données que le client desktop."
    },
    de: {
      "Velora unisce portale web, account unico, motore di ricerca interno, siti pubblicati, VeloMail, Cloud, Tools, nodi e sicurezza Guardian in un unico ecosistema accessibile da ogni dispositivo.": "Velora vereint Webportal, einheitliches Konto, interne Suche, veröffentlichte Websites, VeloMail, Cloud, Tools, Knoten und Guardian-Sicherheit in einem Ökosystem für jedes Gerät.",
      "Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.": "Nutzen Sie das Portal auf jedem Gerät. Installer sind nur für erweiterte lokale Funktionen nötig.",
      "Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati": "Empfohlen. Funktioniert auf Windows, Mac, iPhone, iPad und Android ohne Installation unsignierter Dateien",
      "Installer MSI per mining, nodo locale e funzioni desktop avanzate": "MSI-Installer für Mining, lokalen Knoten und erweiterte Desktop-Funktionen",
      "Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS": "Erweiterte, nicht notarisierten Beta. Nutzen Sie das Portal, wenn Sie macOS-Warnungen vermeiden möchten",
      "Beta avanzata per Mac Intel non notarizzata": "Erweiterte, nicht notarisierten Beta für Intel Mac",
      "Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso": "Paket zur Installation eines Support-Knotens auf NAS oder dauerhaft laufendem PC",
      "Velora e attualmente distribuita come Beta non ancora notarizzata da Apple": "Velora wird derzeit als Beta verteilt und ist noch nicht von Apple notarisiert",
      "macOS mostrera quindi un avviso al primo avvio": "macOS zeigt daher beim ersten Start eine Warnung",
      "Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente": "Nach manueller Freigabe sollte Velora normal starten",
      "Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.": "Velora verarbeitet die Daten, die für Konten, Zugriff, Sicherheit, Website-Veröffentlichung, VeloMail, Cloud, Forum, Knoten und Beta-Funktionen erforderlich sind.",
      "Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.": "Velora verwendet nur technische Cookies und Speicher für Login, Sicherheit, Oberflächenpräferenzen, Cookie-Zustimmung und Portalbetrieb.",
      "Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio": "Velora Cloud schützt Dateien jetzt mit verketteter Verschlüsselung, redundanten Prüfungen und automatischer Sperre sensibler Daten bei ernstem Risiko",
      "Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.": "Offizielle Anleitung, technische Spezifikation, Manifest-Schema und Beispiele zur Vorbereitung von Velora-Websites und Anwendungen.",
      "Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.": "Auf dem Telefon ist keine Installation nötig. Speichern Sie das Portal auf dem Startbildschirm, um es wie eine App zu öffnen.",
      "Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.": "Geben Sie nur Ihren Benutzernamen ein. Velora fügt den Kontosuffix automatisch hinzu.",
      "Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.": "Suchen Sie Zonen, Oceano und Anleitungen. Ergebnisse öffnen im Velora-Browser.",
      "VeloMail e forum usano la stessa sessione del tuo account.": "VeloMail und Forum verwenden dieselbe Sitzung wie Ihr Konto.",
      "Il Publisher guidato genera un manifest valido e riduce gli errori.": "Der geführte Publisher erstellt ein gültiges Manifest und reduziert Fehler.",
      "Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.": "Bereite Tools für Schnellprüfungen, Sicherheit, Inhalte und Veröffentlichung.",
      "Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.": "Verwaltung über Velora API und autorisierten NAS Agent. DSM-Zugangsdaten werden im Portal nie angezeigt.",
      "Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.": "Suche indexierter Inhalte und Öffnung der Ergebnisse im Velora-Browser.",
      "Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.": "Zugriff von Windows, Mac, iPhone, iPad und Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Knoten und NAS nutzen dieselben Daten wie der Desktop-Client."
    },
    es: {
      "Velora unisce portale web, account unico, motore di ricerca interno, siti pubblicati, VeloMail, Cloud, Tools, nodi e sicurezza Guardian in un unico ecosistema accessibile da ogni dispositivo.": "Velora une portal web, cuenta única, buscador interno, sitios publicados, VeloMail, Cloud, Tools, nodos y seguridad Guardian en un ecosistema accesible desde cualquier dispositivo.",
      "Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.": "Usa el portal desde cualquier dispositivo. Los instaladores solo sirven para funciones locales avanzadas.",
      "Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati": "Recomendado. Funciona en Windows, Mac, iPhone, iPad y Android sin instalar archivos no firmados",
      "Installer MSI per mining, nodo locale e funzioni desktop avanzate": "Instalador MSI para mining, nodo local y funciones desktop avanzadas",
      "Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS": "Beta avanzada no notarizada. Usa el portal si quieres evitar avisos de macOS",
      "Beta avanzata per Mac Intel non notarizzata": "Beta avanzada no notarizada para Mac Intel",
      "Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso": "Paquete para instalar un nodo de apoyo en NAS o PC siempre encendido",
      "Velora e attualmente distribuita come Beta non ancora notarizzata da Apple": "Velora se distribuye actualmente como beta aún no notarizada por Apple",
      "macOS mostrera quindi un avviso al primo avvio": "macOS mostrará un aviso en el primer inicio",
      "Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente": "Después de la autorización manual, Velora debería abrirse normalmente",
      "Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.": "Velora trata los datos necesarios para cuentas, acceso, seguridad, publicación de sitios, VeloMail, Cloud, foro, nodos y funciones beta.",
      "Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.": "Velora usa solo cookies y almacenamiento técnico necesarios para login, seguridad, preferencias de interfaz, consentimiento de cookies y funcionamiento del portal.",
      "Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio": "Velora Cloud protege ahora los archivos con cifrado encadenado, controles redundantes y bloqueo automático de datos sensibles cuando se detecta un riesgo serio",
      "Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.": "Guía oficial, especificación técnica, esquema manifest y ejemplos para preparar sitios y aplicaciones Velora.",
      "Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.": "Desde el teléfono no hace falta instalar nada. Guarda el portal en la pantalla de inicio para abrirlo como app.",
      "Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.": "Escribe solo tu nombre de usuario. Velora añade automáticamente el sufijo de la cuenta.",
      "Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.": "Busca zonas, Oceano y guías. Los resultados se abren en el navegador Velora.",
      "VeloMail e forum usano la stessa sessione del tuo account.": "VeloMail y el foro usan la misma sesión de tu cuenta.",
      "Il Publisher guidato genera un manifest valido e riduce gli errori.": "El Publisher guiado genera un manifest válido y reduce errores.",
      "Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.": "Herramientas listas para controles rápidos, seguridad, contenido y publicación.",
      "Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.": "Gestión mediante Velora API y NAS Agent autorizado. No se muestran credenciales DSM en el portal.",
      "Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.": "Busca contenido indexado y abre resultados en el navegador Velora.",
      "Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.": "Accede desde Windows, Mac, iPhone, iPad y Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodos y NAS usan los mismos datos que el cliente desktop."
    },
    ru: {
      "Velora unisce portale web, account unico, motore di ricerca interno, siti pubblicati, VeloMail, Cloud, Tools, nodi e sicurezza Guardian in un unico ecosistema accessibile da ogni dispositivo.": "Velora объединяет веб-портал, единый аккаунт, внутренний поиск, опубликованные сайты, VeloMail, Cloud, Tools, узлы и Guardian Security в одной экосистеме для любого устройства.",
      "Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.": "Используйте портал с любого устройства. Установщики нужны только для расширенных локальных функций.",
      "Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati": "Рекомендуется. Работает на Windows, Mac, iPhone, iPad и Android без установки неподписанных файлов",
      "Installer MSI per mining, nodo locale e funzioni desktop avanzate": "MSI-установщик для mining, локального узла и расширенных desktop-функций",
      "Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS": "Расширенная бета без notarization. Используйте портал, если хотите избежать предупреждений macOS",
      "Beta avanzata per Mac Intel non notarizzata": "Расширенная бета для Mac Intel без notarization",
      "Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso": "Пакет для установки поддерживающего узла на NAS или постоянно включённый PC",
      "Velora e attualmente distribuita come Beta non ancora notarizzata da Apple": "Velora сейчас распространяется как бета, ещё не notarized Apple",
      "macOS mostrera quindi un avviso al primo avvio": "macOS покажет предупреждение при первом запуске",
      "Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente": "После ручного разрешения Velora должна открываться нормально",
      "Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.": "Velora обрабатывает данные, необходимые для аккаунтов, доступа, безопасности, публикации сайтов, VeloMail, Cloud, форума, узлов и бета-функций.",
      "Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.": "Velora использует только технические cookies и storage, необходимые для входа, безопасности, настроек интерфейса, согласия cookies и работы портала.",
      "Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio": "Velora Cloud теперь защищает файлы цепочным шифрованием, резервными проверками и автоматической блокировкой чувствительных данных при серьёзном риске",
      "Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.": "Официальное руководство, техническая спецификация, схема manifest и примеры для подготовки сайтов и приложений Velora.",
      "Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.": "На телефоне ничего устанавливать не нужно. Сохраните портал на главный экран, чтобы открывать его как приложение.",
      "Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.": "Введите только имя пользователя. Velora автоматически добавит суффикс аккаунта.",
      "Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.": "Ищите зоны, Oceano и руководства. Результаты открываются в браузере Velora.",
      "VeloMail e forum usano la stessa sessione del tuo account.": "VeloMail и форум используют ту же сессию аккаунта.",
      "Il Publisher guidato genera un manifest valido e riduce gli errori.": "Пошаговый Publisher создаёт корректный manifest и снижает ошибки.",
      "Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.": "Готовые инструменты для быстрых проверок, безопасности, контента и публикации.",
      "Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.": "Управление через Velora API и авторизованный NAS Agent. Данные DSM не отображаются в портале.",
      "Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.": "Поиск индексированного контента и открытие результатов в браузере Velora.",
      "Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.": "Доступ с Windows, Mac, iPhone, iPad и Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, узлы и NAS используют те же данные, что desktop-клиент."
    },
    zh: {
      "Velora unisce portale web, account unico, motore di ricerca interno, siti pubblicati, VeloMail, Cloud, Tools, nodi e sicurezza Guardian in un unico ecosistema accessibile da ogni dispositivo.": "Velora 将网页门户、统一账户、内部搜索、已发布网站、VeloMail、Cloud、Tools、节点和 Guardian 安全整合到一个可在任何设备访问的生态中。",
      "Usa il portale da qualsiasi dispositivo. Gli installer servono solo per funzioni avanzate locali.": "可从任何设备使用门户。安装包仅用于高级本地功能。",
      "Consigliato. Funziona su Windows, Mac, iPhone, iPad e Android senza installare file non firmati": "推荐。可在 Windows、Mac、iPhone、iPad 和 Android 上运行，无需安装未签名文件",
      "Installer MSI per mining, nodo locale e funzioni desktop avanzate": "用于 mining、本地节点和高级桌面功能的 MSI 安装包",
      "Beta avanzata non notarizzata. Usa il portale se vuoi evitare avvisi macOS": "未 notarized 的高级测试版。如需避免 macOS 警告，请使用门户",
      "Beta avanzata per Mac Intel non notarizzata": "适用于 Mac Intel 的未 notarized 高级测试版",
      "Pacchetto per installare un nodo di supporto su NAS o PC sempre acceso": "用于在 NAS 或常开 PC 上安装支持节点的包",
      "Velora e attualmente distribuita come Beta non ancora notarizzata da Apple": "Velora 当前作为尚未通过 Apple notarization 的测试版发布",
      "macOS mostrera quindi un avviso al primo avvio": "macOS 会在首次启动时显示警告",
      "Dopo l'autorizzazione manuale, Velora deve aprirsi normalmente": "手动授权后，Velora 应能正常打开",
      "Velora tratta i dati necessari per account, accesso, sicurezza, pubblicazione siti, VeloMail, Cloud, forum, nodi e funzioni beta.": "Velora 处理账户、访问、安全、网站发布、VeloMail、Cloud、论坛、节点和测试功能所需的数据。",
      "Velora usa solo cookie e storage tecnici necessari a login, sicurezza, preferenze interfaccia, consenso cookie e funzionamento del portale.": "Velora 仅使用登录、安全、界面偏好、cookie 同意和门户运行所需的技术 cookie 与存储。",
      "Il Cloud Velora ora protegge i file con cifratura concatenata, controlli ridondanti e blocco automatico dei dati sensibili quando viene rilevato un rischio serio": "Velora Cloud 现在通过链式加密、冗余检查和严重风险时的敏感数据自动锁定来保护文件",
      "Guida ufficiale, specifica tecnica, schema manifest ed esempi per preparare siti e applicazioni Velora.": "用于准备 Velora 网站和应用的官方指南、技术规范、manifest schema 与示例。",
      "Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.": "手机上无需安装任何内容。若想像应用一样打开，可将门户保存到主屏幕。",
      "Scrivi solo il tuo nome utente. Velora aggiunge automaticamente il suffisso dell'account.": "只输入用户名。Velora 会自动添加账户后缀。",
      "Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.": "搜索区域、Oceano 和指南。结果会在 Velora 浏览器中打开。",
      "VeloMail e forum usano la stessa sessione del tuo account.": "VeloMail 和论坛使用同一账户会话。",
      "Il Publisher guidato genera un manifest valido e riduce gli errori.": "引导式 Publisher 会生成有效 manifest 并减少错误。",
      "Strumenti pronti per controlli rapidi, sicurezza, contenuti e pubblicazione.": "用于快速检查、安全、内容和发布的可用工具。",
      "Gestione tramite Velora API e NAS Agent autorizzato. Nessuna credenziale DSM viene mostrata nel portale.": "通过 Velora API 和授权 NAS Agent 管理。门户不会显示 DSM 凭据。",
      "Ricerca contenuti indicizzati e apertura risultati nel Browser Velora.": "搜索已索引内容并在 Velora 浏览器中打开结果。",
      "Accedi da Windows, Mac, iPhone, iPad e Android. Account, Search, Browser, VeloMail, Cloud, Publisher, Tools, Forum, Mining Monitor, Nodi e NAS usano gli stessi dati del client desktop.": "可从 Windows、Mac、iPhone、iPad 和 Android 访问。Account、Search、Browser、VeloMail、Cloud、Publisher、Tools、Forum、Mining Monitor、节点和 NAS 使用与桌面客户端相同的数据。"
    }
  };
}

function normalizeVeloraUsername(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase().normalize("NFKC");
  if (!raw) return "";
  const local = raw.endsWith("@velora") ? raw.slice(0, -7) : raw;
  const normalizedLocal = local.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{2,30}$/.test(normalizedLocal)) return "";
  return `${normalizedLocal}@velora`;
}

async function findLoginUser(canonicalUsername: string, submittedUsername: unknown, userRepository: typeof repository) {
  const direct = await userRepository.findUserByUsername(canonicalUsername);
  if (direct) return direct;
  const raw = String(submittedUsername ?? "").trim().toLowerCase().normalize("NFKC");
  const legacy = raw.endsWith("@velora") ? raw.slice(0, -7) : raw;
  return legacy && legacy !== canonicalUsername ? userRepository.findUserByUsername(legacy) : undefined;
}

async function hitRateLimit(bucket: string, maxHits: number) {
  try {
    const result = await requirePool().query(
      `INSERT INTO api_rate_limits (bucket, window_start, hit_count, updated_at)
       VALUES ($1, date_trunc('minute', NOW()), 1, NOW())
       ON CONFLICT (bucket) DO UPDATE SET
         hit_count = CASE
           WHEN api_rate_limits.window_start < date_trunc('minute', NOW()) THEN 1
           ELSE api_rate_limits.hit_count + 1
         END,
         window_start = CASE
           WHEN api_rate_limits.window_start < date_trunc('minute', NOW()) THEN date_trunc('minute', NOW())
           ELSE api_rate_limits.window_start
         END,
         updated_at = NOW()
       RETURNING hit_count`,
      [bucket]
    );
    return Number(result.rows[0]?.hit_count ?? 0) > maxHits;
  } catch {
    return false;
  }
}

async function readReleaseManifestSafe() {
  const candidates = [resolve("releases/beta/release-manifest.json"), resolve("../releases/beta/release-manifest.json"), resolve("../../releases/beta/release-manifest.json")];
  for (const manifest of candidates) {
    try {
      return JSON.parse((await readFile(manifest, "utf8")).replace(/^\uFEFF/, "")) as Record<string, any>;
    } catch {
      continue;
    }
  }
  return undefined;
}

function releaseChangelog() {
  return [
    "Aggiornatore desktop: endpoint versione, manifest, hash e changelog pubblico",
    "Mining: dashboard con potenza collettiva, worker, share, soglia payout e storico",
    "Admin: pannelli payout, utenti, nodi, siti, segnalazioni, audit e health",
    "Account: sessioni persistenti, recovery key personale e profilo completo",
    "Publisher: stato pubblicazione piu leggibile e pagina pubblica per zona",
    "Sicurezza: rate limit, audit operativo e nessun segreto esposto nei log/API"
  ];
}

async function ensureRecoveryToken(userId: string, forceShow: boolean) {
  const pool = requirePool();
  const existing = await pool.query("SELECT recovery_token_hash, recovery_token_seen_at FROM users WHERE id = $1", [userId]);
  const row = existing.rows[0];
  if (row?.recovery_token_hash && row.recovery_token_seen_at && !forceShow) {
    return { required: false, visibleOnce: false };
  }
  const token = `vlk-${randomBytes(18).toString("base64url")}`;
  await pool.query("UPDATE users SET recovery_token_hash = COALESCE(recovery_token_hash, $1) WHERE id = $2", [hashValue(token), userId]);
  if (row?.recovery_token_hash && !forceShow) {
    return { required: true, visibleOnce: false, message: "Key token gia generato. Conferma di averlo visto dalle impostazioni se lo hai salvato." };
  }
  return {
    required: true,
    visibleOnce: true,
    token,
    message: "Salva questo key token personale. Serve per recuperare l'account. Dopo conferma non verra piu mostrato."
  };
}

async function verifyRecoveryToken(userId: string, token: string) {
  const result = await requirePool().query("SELECT 1 FROM users WHERE id = $1 AND recovery_token_hash = $2", [userId, hashValue(token)]);
  return Boolean(result.rows[0]);
}

async function buildAccountProfile(userId: string) {
  const pool = requirePool();
  const [devices, nodes, zones, mining, payouts, notifications] = await Promise.all([
    pool.query("SELECT id, device_name, peer_id, status, created_at, updated_at FROM devices WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20", [userId]),
    pool.query("SELECT id, module, status, device_peer_id, resource_profile, last_heartbeat_at, updated_at FROM contributor_nodes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20", [userId]).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT nz.address, nz.status, sr.version, sr.status AS release_status, sr.content_cid, sr.created_at
       FROM navigation_zones nz
       LEFT JOIN LATERAL (SELECT * FROM site_releases sr WHERE sr.zone_id = nz.id ORDER BY sr.created_at DESC LIMIT 1) sr ON TRUE
       WHERE nz.owner_user_id = $1
       ORDER BY COALESCE(sr.created_at, nz.updated_at) DESC LIMIT 50`,
      [userId]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT mw.id, mw.worker_id, mw.coin, mw.status, mw.payout_wallet, md.device_peer_id, mw.updated_at
       FROM mining_workers mw JOIN mining_devices md ON md.id = mw.mining_device_id
       WHERE md.user_id = $1 ORDER BY mw.updated_at DESC LIMIT 20`,
      [userId]
    ).catch(() => ({ rows: [] })),
    pool.query("SELECT id, coin, payout_wallet, status, requested_at, decided_at, paid_at, payout_tx_hash FROM mining_payout_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 20", [userId]).catch(() => ({ rows: [] })),
    pool.query("SELECT COUNT(*)::int AS unread FROM user_notifications WHERE user_id = $1 AND status = 'UNREAD'", [userId]).catch(() => ({ rows: [{ unread: 0 }] }))
  ]);
  return {
    devices: devices.rows,
    nodes: nodes.rows,
    sites: zones.rows,
    mining: mining.rows.map(mapMiningWorker),
    payoutRequests: payouts.rows.map((row) => ({ ...row, payout_wallet: maskWallet(String(row.payout_wallet ?? "")) })),
    unreadNotifications: Number(notifications.rows[0]?.unread ?? 0),
    limits: { maxDevicesPerAccount: 3, maxAccountsPerDevice: 3 }
  };
}

async function notifyUser(userId: string, type: string, title: string, body: string, payload: Record<string, unknown> = {}) {
  try {
    await requirePool().query(
      "INSERT INTO user_notifications (id, user_id, type, title, body, payload) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), userId, type, title, body, JSON.stringify(payload)]
    );
  } catch {
    // Notification failures must not block the user action.
  }
}

async function appendUserEvent(userId: string, eventType: string, targetType: string, targetId: string, summary: string, payload: Record<string, unknown> = {}) {
  try {
    await requirePool().query(
      `INSERT INTO operational_events (id, actor_user_id, event_type, target_type, target_id, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), userId, eventType, targetType, targetId, summary, JSON.stringify(payload)]
    );
  } catch {
    // Operational audit is best effort on legacy databases before migrations run.
  }
}

async function findPublicZone(address: string) {
  try {
    const result = await requirePool().query(
      `SELECT nz.address, nz.status AS zone_status, u.username AS owner,
              sr.version, sr.status AS release_status, sr.content_cid, sr.manifest_json, sr.created_at
       FROM navigation_zones nz
       LEFT JOIN users u ON u.id = nz.owner_user_id
       LEFT JOIN LATERAL (
         SELECT * FROM site_releases sr WHERE sr.zone_id = nz.id AND sr.status IN ('ACTIVE','PUBLISHED','APPROVED') ORDER BY sr.created_at DESC LIMIT 1
       ) sr ON TRUE
       WHERE nz.address = $1
       LIMIT 1`,
      [address]
    );
    if (result.rows[0]) {
      return result.rows[0];
    }
    const indexed = await requirePool().query(
      `SELECT address, category, slug, title, description, searchable_text AS body, publisher,
              age_rating, family_safe, trust_level, content_cid, release_version AS version,
              availability, updated_at AS created_at, 'INDEXED' AS release_status
       FROM search_documents
       WHERE address = $1
       LIMIT 1`,
      [address]
    );
    if (indexed.rows[0]) {
      return { ...indexed.rows[0], manifest_json: { title: indexed.rows[0].title, description: indexed.rows[0].description, category: indexed.rows[0].category } };
    }
  } catch {
    return undefined;
  }
}

async function sendZoneRuntime(address: string, row: any, reply: FastifyReply) {
  const safeAddress = normalizeZoneAddress(address);
  const siteRoot = safeAddress ? await findPublishedSiteRoot(safeAddress) : undefined;
  if (siteRoot) {
    const indexPath = join(siteRoot, "index.html");
    try {
      const raw = await readFile(indexPath, "utf8");
      const html = injectZoneRuntime(raw, safeAddress, row);
      reply.header("Content-Security-Policy", "default-src 'self' data: blob:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline'; connect-src 'self' https://www.webvelora.it https://velora-beta-20260629-9a9196313b42.herokuapp.com; frame-ancestors 'self'");
      return reply.type("text/html; charset=utf-8").send(html);
    } catch {
      await appendOperationalEvent({ eventType: "ZONE_INDEX_MISSING", targetType: "ZONE", targetId: safeAddress, summary: "Index zona non leggibile", payload: { address: safeAddress } });
    }
  }
  if (!row) {
    await appendOperationalEvent({ eventType: "ZONE_NOT_OPENABLE", targetType: "ZONE", targetId: address, summary: "Zona richiesta non trovata", payload: { address } });
  } else if (!siteRoot) {
    await appendOperationalEvent({ eventType: "ZONE_CONTENT_MISSING", targetType: "ZONE", targetId: safeAddress || address, summary: "Zona indicizzata senza runtime locale", payload: { address, contentCid: row.content_cid ?? null } });
  }
  return reply.type("text/html; charset=utf-8").send(publicZonePage(address, row, Boolean(siteRoot)));
}

async function sendZoneAsset(address: string, asset: string, reply: FastifyReply) {
  const safeAddress = normalizeZoneAddress(address);
  if (!safeAddress) return reply.notFound("zone not found");
  const siteRoot = await findPublishedSiteRoot(safeAddress);
  if (!siteRoot) return reply.notFound("zone asset not found");
  const cleanAsset = normalize(String(asset || "")).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  if (!cleanAsset || cleanAsset.includes("..")) return reply.notFound("zone asset not found");
  const assetPath = resolve(siteRoot, cleanAsset);
  const relativeAsset = relative(siteRoot, assetPath);
  if (relativeAsset.startsWith("..") || relativeAsset.includes(":")) return reply.notFound("zone asset not found");
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) return reply.notFound("zone asset not found");
    reply.header("Cache-Control", "public, max-age=300");
    reply.header("Content-Length", String(info.size));
    reply.type(mimeFromPath(assetPath));
    return reply.send(createReadStream(assetPath));
  } catch {
    return reply.notFound("zone asset not found");
  }
}

function normalizeZoneAddress(address: string) {
  const normalized = String(address || "").trim().toLowerCase().normalize("NFKC");
  return /^[a-z0-9][a-z0-9.-]{1,90}[a-z0-9]$/.test(normalized) && normalized.includes(".") ? normalized : "";
}

async function findPublishedSiteRoot(address: string) {
  for (const root of publishedSiteRoots) {
    const candidate = resolve(root, address);
    if (!candidate.startsWith(resolve(root))) continue;
    try {
      const info = await stat(join(candidate, "index.html"));
      if (info.isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function injectZoneRuntime(html: string, address: string, row: any) {
  const baseTag = `<base href="/zone-assets/${escapeHtml(address)}/">`;
  const status = row?.release_status ?? row?.zone_status ?? "LOCAL_RUNTIME";
  const shell = `<div data-velora-runtime style="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid rgba(232,196,105,.45);border-radius:16px;background:rgba(6,19,31,.9);color:#f6fbff;font:13px system-ui;box-shadow:0 12px 35px rgba(0,0,0,.28)"><span data-no-translate>Zona ${escapeHtml(address)} · ${escapeHtml(String(status))}</span><button data-velora-zone-translate style="display:none;border:0;border-radius:12px;background:#15324a;color:#f6fbff;padding:8px 10px;font-weight:800">Traduci pagina</button><button data-velora-auth style="border:0;border-radius:12px;background:#e8c469;color:#06131f;padding:8px 10px;font-weight:800">Login Velora</button><span data-velora-auth-state>non collegato</span></div>`;
  const bridge = `<script>(()=>{const s=document.querySelector("[data-velora-auth-state]");document.addEventListener("click",e=>{const t=e.target&&e.target.closest?e.target.closest("[data-velora-auth],a[href^='velora://auth']"):null;if(!t)return;e.preventDefault();window.parent.postMessage({type:"VELORA_AUTH_REQUEST",zone:${JSON.stringify(address)}},"*")});window.addEventListener("message",e=>{if(!e.data||e.data.type!=="VELORA_AUTH_STATE")return;if(s)s.textContent=e.data.loggedIn?"collegato: "+(e.data.mail||e.data.username||"utente"):"serve accesso Velora"})})();</script>`;
  const withBase = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`) : `${baseTag}${html}`;
  const runtime = `${shell}${veloraI18nScript()}${zoneTranslationRuntime(address)}${bridge}`;
  return /<\/body>/i.test(withBase) ? withBase.replace(/<\/body>/i, `${runtime}</body>`) : `${withBase}${runtime}`;
}

function mimeFromPath(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function publicZonePage(address: string, row: any, hasRuntime = false) {
  const manifest = row?.manifest_json ?? {};
  const title = String(manifest.title ?? row?.address ?? address);
  const description = String(manifest.description ?? "Zona Velora pubblicata");
  const status = row?.release_status ?? row?.zone_status ?? "NON_TROVATA";
  const body = String(row?.body ?? "").trim();
  const found = Boolean(row);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Velora</title>
  <style>body{margin:0;background:linear-gradient(160deg,#071524,#0b2236 62%,#09131d);color:#f6fbff;font-family:ui-serif,Georgia,serif}main{max-width:980px;margin:auto;padding:clamp(22px,5vw,60px)}.card{border:1px solid #35506a;border-radius:28px;background:rgba(13,34,54,.94);padding:clamp(22px,4vw,38px);box-shadow:0 24px 80px rgba(0,0,0,.28)}h1{font-size:clamp(32px,8vw,68px);line-height:.95;margin:8px 0 16px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.pill{border:1px solid #4d6b86;border-radius:999px;padding:8px 11px;color:#dce8f2;background:#07131f}.body{white-space:pre-wrap;line-height:1.62;font-size:18px;color:#eaf3fb;margin-top:22px}button,a{color:#f1d68b}button{border:1px solid #5b7794;border-radius:14px;background:#10283d;padding:12px 16px;font:inherit;cursor:pointer}.auth{margin-top:18px;padding:14px 16px;border-radius:18px;background:#07131f;color:#dce8f2}.notfound{border-color:#8b5b5b;background:#2d1720}</style></head>
  <body><main><div class="card ${found ? "" : "notfound"}"><p>Zona Velora</p><h1>${escapeHtml(found ? title : "Zona non trovata")}</h1><p>${escapeHtml(found ? description : "Questa zona non e ancora pubblicata o indicizzata. Torna al portale e cerca un risultato disponibile.")}</p><div class="meta"><span class="pill">Indirizzo: ${escapeHtml(address)}</span><span class="pill">Stato: ${escapeHtml(String(status))}</span><span class="pill">${hasRuntime ? "Contenuto disponibile" : "Contenuto non disponibile"}</span><span class="pill">Release: ${escapeHtml(String(row?.version ?? "non disponibile"))}</span></div>${!hasRuntime && found ? `<div class="auth">Il contenuto della zona non e disponibile ora. Riprova piu tardi o torna al portale per aprire un'altra zona.</div>` : ""}${body ? `<div class="body">${escapeHtml(body.slice(0, 12000))}</div>` : ""}<button data-velora-auth>Accedi con Velora</button><div class="auth" data-velora-auth-state>Accesso Velora non ancora collegato</div><p><a href="/portal">Apri portale Velora</a></p></div></main><script>
(() => {
  const state = document.querySelector("[data-velora-auth-state]");
  const requestAuth = (event) => { event.preventDefault(); window.parent.postMessage({ type: "VELORA_AUTH_REQUEST", zone: ${JSON.stringify(address)} }, "*"); };
  document.addEventListener("click", (event) => { const target = event.target && event.target.closest ? event.target.closest("[data-velora-auth],a[href^='velora://auth']") : null; if (target) requestAuth(event); });
  window.addEventListener("message", (event) => { if (!event.data || event.data.type !== "VELORA_AUTH_STATE") return; state.textContent = event.data.loggedIn ? "Account Velora collegato: " + (event.data.mail || event.data.username || "utente") : "Accedi dal portale Velora per continuare"; });
})();
</script></body></html>`;
}

async function buildAdminOverview() {
  const pool = requirePool();
  const [dashboard, mining, payouts, nodes, sites, reports] = await Promise.all([
    repository.dashboard(),
    buildMiningNetworkStats().catch((error) => ({ error: error instanceof Error ? error.message : "mining stats unavailable" })),
    pool.query("SELECT status, COUNT(*)::int AS count FROM mining_payout_requests GROUP BY status").catch(() => ({ rows: [] })),
    betaLogicalNodeCluster.publicStatus().catch(() => ({ ok: false })),
    pool.query("SELECT COUNT(*)::int AS count FROM site_releases").catch(() => ({ rows: [{ count: 0 }] })),
    pool.query("SELECT COUNT(*)::int AS count FROM forum_moderation_actions").catch(() => ({ rows: [{ count: 0 }] }))
  ]);
  return { dashboard, mining, payoutRequests: payouts.rows, nodes, sites: sites.rows[0], reports: reports.rows[0] };
}

async function buildOpsStatus() {
  const pool = requirePool();
  const [latestBackup, latestRestoreTest, latestUptime, counts] = await Promise.all([
    pool.query("SELECT id, status, backup_ref, note, created_at FROM database_backup_events WHERE kind='BACKUP' ORDER BY created_at DESC LIMIT 1").catch(() => ({ rows: [] })),
    pool.query("SELECT id, status, backup_ref, restore_target, note, created_at FROM database_backup_events WHERE kind='RESTORE_TEST' ORDER BY created_at DESC LIMIT 1").catch(() => ({ rows: [] })),
    pool.query("SELECT id, source, status, latency_ms, error_message, checked_at FROM uptime_checks ORDER BY checked_at DESC LIMIT 1").catch(() => ({ rows: [] })),
    pool.query("SELECT kind, status, COUNT(*)::int AS count FROM database_backup_events GROUP BY kind,status ORDER BY kind,status").catch(() => ({ rows: [] }))
  ]);
  return {
    backupConfigured: Boolean(process.env.HEROKU_API_KEY || process.env.DATABASE_BACKUP_URL || process.env.DATABASE_URL),
    backupMode: process.env.DATABASE_BACKUP_URL ? "external" : "heroku-postgres",
    latestBackup: latestBackup.rows[0] ?? null,
    latestRestoreTest: latestRestoreTest.rows[0] ?? null,
    latestUptime: latestUptime.rows[0] ?? null,
    backupEvents: counts.rows,
    recommendedActions: [
      latestBackup.rows[0] ? "Backup registrato" : "Registra primo backup verificato",
      latestRestoreTest.rows[0] ? "Restore test registrato" : "Esegui e registra test restore",
      latestUptime.rows[0] ? "Uptime monitor attivo" : "Esegui primo controllo uptime"
    ]
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
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

const executionOperations = [
  "MINING_START",
  "MINING_STOP",
  "MINING_PAUSE",
  "MINING_SET_PROFILE",
  "MINING_SET_COIN",
  "MINING_ENABLE_AUTO_SWITCH",
  "NODE_START",
  "NODE_STOP",
  "NAS_SYNC",
  "CLOUD_UPLOAD",
  "CLOUD_COPY",
  "CLOUD_DELETE",
  "PUBLISH_BUILD",
  "PUBLISH_VALIDATE",
  "PUBLISH_DEPLOY",
  "SEARCH_REINDEX",
  "TOOL_EXECUTE"
];

const executionTargetTypes = ["DESKTOP", "WINDOWS_PC", "LINUX_PC", "NAS", "VELORA_NODE", "BOOST_BOX", "SERVER"];

async function executionTargets(userId: string) {
  const pool = requirePool();
  const [devices, nodes, miningDevices, operations] = await Promise.all([
    pool.query("SELECT id, device_name, peer_id, status, updated_at FROM devices WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50", [userId]).catch(() => ({ rows: [] })),
    pool.query("SELECT id, module, status, device_peer_id, resource_profile, last_heartbeat_at, updated_at FROM contributor_nodes WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50", [userId]).catch(() => ({ rows: [] })),
    pool.query("SELECT id, device_peer_id, status, updated_at FROM mining_devices WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50", [userId]).catch(() => ({ rows: [] })),
    pool.query("SELECT id, operation, target_type, target_id, status, accepted_at, completed_at, failed_at, error_message FROM remote_execution_operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]).catch(() => ({ rows: [] }))
  ]);
  const mappedDevices = devices.rows.map((row) => ({
    id: String(row.id),
    type: "DESKTOP",
    label: row.device_name ? String(row.device_name) : "Velora Desktop",
    peerId: row.peer_id ? String(row.peer_id) : "",
    status: String(row.status ?? "UNKNOWN"),
    online: String(row.status ?? "").toUpperCase() === "ACTIVE",
    capabilities: ["CLOUD_UPLOAD", "PUBLISH_VALIDATE", "TOOL_EXECUTE"],
    updatedAt: row.updated_at ?? null
  }));
  const mappedNodes = nodes.rows.map((row) => {
    const module = String(row.module ?? "VELORA_NODE").toUpperCase();
    const online = row.last_heartbeat_at ? Date.now() - new Date(row.last_heartbeat_at).getTime() < 10 * 60 * 1000 : false;
    return {
      id: String(row.id),
      type: module.includes("HOSTING") ? "NAS" : "VELORA_NODE",
      label: module.includes("HOSTING") ? "NAS Velora" : "Nodo Velora",
      peerId: String(row.device_peer_id ?? ""),
      status: online ? "ONLINE" : String(row.status ?? "UNKNOWN"),
      online,
      resourceProfile: String(row.resource_profile ?? "MINIMUM"),
      capabilities: module.includes("HOSTING") ? ["NAS_SYNC", "CLOUD_UPLOAD", "PUBLISH_BUILD", "PUBLISH_DEPLOY"] : ["NODE_START", "NODE_STOP", "SEARCH_REINDEX", "TOOL_EXECUTE"],
      lastHeartbeatAt: row.last_heartbeat_at ?? null,
      updatedAt: row.updated_at ?? null
    };
  });
  const mappedMining = miningDevices.rows.map((row) => ({
    id: String(row.id),
    type: "WINDOWS_PC",
    label: "Dispositivo mining",
    peerId: String(row.device_peer_id ?? ""),
    status: String(row.status ?? "UNKNOWN"),
    online: String(row.status ?? "").toUpperCase() === "ACTIVE",
    capabilities: ["MINING_START", "MINING_STOP", "MINING_PAUSE", "MINING_SET_PROFILE", "MINING_SET_COIN", "MINING_ENABLE_AUTO_SWITCH"],
    updatedAt: row.updated_at ?? null
  }));
  return {
    targets: [...mappedDevices, ...mappedNodes, ...mappedMining],
    operations: operations.rows,
    allowedOperations: executionOperations,
    note: "Il portale invia solo operazioni Velora tipizzate a dispositivi associati. Nessuna shell remota."
  };
}

async function createExecutionOperation(userId: string, body: { operation?: string; targetType?: string; targetId?: string; requestedState?: string; payload?: Record<string, unknown>; idempotencyKey?: string }, reply: FastifyReply) {
  const operation = normalizeChoice(body.operation, executionOperations, "");
  const targetType = normalizeChoice(body.targetType, executionTargetTypes, "");
  const idempotencyKey = String(body.idempotencyKey ?? "").trim();
  if (!operation || !targetType || !idempotencyKey) {
    return reply.badRequest("operation, targetType and idempotencyKey are required");
  }
  const targets = await executionTargets(userId);
  const targetId = body.targetId ? String(body.targetId).trim() : "";
  const target = targets.targets.find((item: any) => item.type === targetType && (!targetId || item.id === targetId || item.peerId === targetId));
  const serverAllowed = targetType === "SERVER" && ["PUBLISH_VALIDATE", "SEARCH_REINDEX", "TOOL_EXECUTE"].includes(operation);
  if (!target && !serverAllowed) {
    return reply.notFound("execution target not found or not associated");
  }
  const capabilities = target?.capabilities ?? (serverAllowed ? ["PUBLISH_VALIDATE", "SEARCH_REINDEX", "TOOL_EXECUTE"] : []);
  if (!capabilities.includes(operation)) {
    return reply.badRequest("operation is not supported by selected target");
  }
  const status = target?.online || serverAllowed ? "QUEUED" : "WAITING_FOR_TARGET";
  const payload = sanitizeExecutionPayload(body.payload ?? {});
  const result = await requirePool().query(
    `INSERT INTO remote_execution_operations (id,user_id,idempotency_key,operation,target_type,target_id,requested_state,accepted_state,status,payload_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED',$8,$9)
     ON CONFLICT (user_id,idempotency_key) DO UPDATE SET updated_at=NOW()
     RETURNING id, operation, target_type, target_id, requested_state, accepted_state, status, timeout_at, accepted_at, created_at, updated_at`,
    [randomUUID(), userId, idempotencyKey, operation, targetType, targetId || target?.id || null, String(body.requestedState ?? operation), status, JSON.stringify(payload)]
  );
  await appendUserOperationalEvent(userId, "REMOTE_OPERATION_ACCEPTED", "EXECUTION_OPERATION", result.rows[0].id, `${operation} ${status}`, { operation, targetType, targetId: targetId || target?.id || null });
  return { operation: result.rows[0], message: status === "QUEUED" ? "Operazione accettata e messa in coda." : "Operazione accettata. Partira quando il dispositivo torna online." };
}

function sanitizeExecutionPayload(payload: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 30)) {
    const normalizedKey = key.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 60);
    if (!normalizedKey || /password|secret|seed|private|token/i.test(normalizedKey)) continue;
    if (typeof value === "string") safe[normalizedKey] = value.slice(0, 500);
    else if (typeof value === "number" || typeof value === "boolean") safe[normalizedKey] = value;
    else if (value === null) safe[normalizedKey] = null;
  }
  return safe;
}

async function appendUserOperationalEvent(userId: string, eventType: string, targetType: string, targetId: string, summary: string, payload: Record<string, unknown> = {}) {
  await requirePool().query(
    `INSERT INTO operational_events (id, actor_user_id, event_type, target_type, target_id, summary, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), userId, eventType, targetType, targetId, summary.slice(0, 500), JSON.stringify(payload)]
  ).catch(() => undefined);
}

async function appendOperationalEvent(input: { eventType: string; targetType: string; targetId: string; summary: string; payload?: Record<string, unknown> }) {
  await requirePool().query(
    `INSERT INTO operational_events (id, event_type, target_type, target_id, summary, payload)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      sanitizeSignal(input.eventType),
      sanitizeSignal(input.targetType),
      String(input.targetId || "unknown").slice(0, 160),
      String(input.summary || "Evento Velora").slice(0, 500),
      JSON.stringify(sanitizeAnalyticsPayload(input.payload ?? {}))
    ]
  ).catch(() => undefined);
}

function sanitizeAnalyticsPayload(payload: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 20)) {
    const cleanKey = key.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 60);
    if (!cleanKey || /password|secret|seed|private|token|wallet/i.test(cleanKey)) continue;
    if (typeof value === "string") safe[cleanKey] = value.replace(/[A-Za-z0-9]{32,}/g, "[dato protetto]").slice(0, 240);
    else if (typeof value === "number" || typeof value === "boolean") safe[cleanKey] = value;
    else if (value === null) safe[cleanKey] = null;
  }
  return safe;
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
  const accountingStatus = accountingAvailable ? "READY" : "IN_RACCOLTA";
  const accountingError = accountingAvailable ? null : "Statistiche pool in raccolta. Il payout resta manuale finche l'importo non viene confermato.";
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
    lastError: shares.valid ? "Statistiche mining in raccolta. I payout vengono confermati dal pannello admin." : shares.error
  };
}

function veloraToolGroups() {
  return ["Velora Core", "Vita Quotidiana", "Sicurezza", "Creator Studio"];
}

function veloraToolCatalog() {
  const core = [
    ["tools.wallet", "Wallet Check", "Valida indirizzi pubblici XMR e ZEPH"],
    ["tools.mining", "Mining Monitor", "Mostra worker, hashrate, share, soglia payout e ultimo contatto"],
    ["tools.publisher-validator", "Publisher Validator", "Controlla manifest e struttura sito"],
    ["tools.zone-explorer", "Zone Explorer", "Apre e verifica zone pubblicate"],
    ["tools.login-test", "Velora Login Tester", "Verifica presenza login Velora"],
    ["tools.mail-test", "Mail Tester", "Prepara test VeloMail tra account"],
    ["tools.node-health", "Node Health", "Mostra stato nodo e rete"],
    ["tools.hash", "Hash Verifier", "Calcola SHA-256"],
    ["tools.recovery", "Recovery Key Check", "Controlla stato key token"],
    ["tools.report-abuse", "Report Abuse", "Prepara segnalazioni"]
  ];
  const daily = [
    ["tools.tts", "TTS Reader", "Legge testi ad alta voce"],
    ["tools.translate", "Traduttore Velora", "Traduce testo"],
    ["tools.summary", "Riassunto Rapido", "Sintetizza testi lunghi"],
    ["tools.rewrite", "Riscrivi Meglio", "Rende testi piu chiari"],
    ["tools.spell", "Correttore Umano", "Corregge testo"],
    ["tools.voice-notes", "Note Vocali", "Ordina note dettate"],
    ["tools.focus", "Timer Focus", "Crea sessioni focus"],
    ["tools.checklist", "Checklist Rapida", "Trasforma appunti in checklist"],
    ["tools.percent", "Calcolatrice Percentuali", "Calcola sconti e quote"],
    ["tools.unit", "Convertitore Unita", "Converte unita comuni"]
  ];
  const security = [
    ["tools.link-check", "Link Check", "Analizza link sospetti"],
    ["tools.difesa-totale", "Difesa Totale Check", "Controllo locale indicatori rischio"],
    ["tools.password", "Password Strength", "Misura forza password"],
    ["tools.privacy", "Privacy Cleaner", "Rimuove dati personali evidenti"],
    ["tools.qr-safe", "QR Safe Scanner", "Valuta contenuto QR"],
    ["tools.phishing", "Phishing Detector", "Evidenzia segnali truffa"],
    ["tools.permissions", "Permission Viewer", "Spiega permessi app/siti"],
    ["tools.file-signature", "File Signature Check", "Riconosce tipo file"],
    ["tools.breach-note", "Breach Note", "Piano azione post rischio account"],
    ["tools.safe-message", "Safe Message", "Riscrive messaggi senza dati privati"]
  ];
  const creator = [
    ["tools.manifest", "Manifest Generator", "Genera velora-site.json"],
    ["tools.landing", "Landing Builder", "Crea HTML landing"],
    ["tools.seo", "SEO Velora", "Genera titolo, descrizione e tag"],
    ["tools.accessibility", "Accessibility Check", "Controlla leggibilita base"],
    ["tools.changelog", "Changelog Writer", "Crea changelog"],
    ["tools.logo", "Mini Logo Maker", "Genera concept logo"],
    ["tools.cover", "Cover Builder", "Genera brief copertina"],
    ["tools.content-pack", "Content Packager", "Suggerisce alleggerimento contenuti"],
    ["tools.prompt-site", "Prompt Sito Velora", "Crea prompt conversione sito"],
    ["tools.publish-plan", "Publish Plan", "Crea piano pubblicazione"]
  ];
  return [
    ...mapToolCatalog("Velora Core", core),
    ...mapToolCatalog("Vita Quotidiana", daily),
    ...mapToolCatalog("Sicurezza", security),
    ...mapToolCatalog("Creator Studio", creator)
  ];
}

function mapToolCatalog(group: string, rows: string[][]) {
  const executable = new Set([
    "tools.wallet",
    "tools.mining",
    "tools.publisher-validator",
    "tools.zone-explorer",
    "tools.login-test",
    "tools.mail-test",
    "tools.node-health",
    "tools.hash",
    "tools.report-abuse",
    "tools.tts",
    "tools.link-check",
    "tools.privacy"
  ]);
  return rows.map(([address, title, description]) => ({
    address,
    zone: address,
    title,
    name: title,
    action: address,
    description,
    group,
    category: "Velora Tools",
    status: executable.has(address) ? "READY" : "INDEXED",
    indexed: true,
    executable: executable.has(address)
  }));
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
    rpcReachable: Boolean(rpcUrl) ? "configured" : false,
    accountingAvailable: false,
    status: wallet && parsed ? "IN_RACCOLTA" : "DA_CONFIGURARE"
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

function buildMinerConfigResponse(row: any) {
  const coin = String(row.coin);
  const workerId = String(row.worker_id ?? "");
  return {
    workerId,
    coin,
    poolUrl: String(row.pool_url ?? ""),
    poolUsername: coin === "ZEPH" ? `${row.pool_username}.${workerId}` : String(row.pool_username ?? ""),
    poolPassword: coin === "XMR" ? workerId : "x",
    payoutWallet: maskWallet(String(row.payout_wallet ?? "")),
    custodial: true,
    warning: config.miningPayoutsEnabled ? undefined : "PAYOUT NON ANCORA ATTIVO"
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
  const poolStats = await fetchMoneroOceanStats(config.veloraMoneroWallet);
  return {
    source: "pool_wallet_plus_server_side_worker_records",
    payoutStatus: config.miningPayoutsEnabled ? "ENABLED" : "PAYOUT_NON_ANCORA_ATTIVO",
    network: metrics.rows[0],
    pool: poolStats,
    rewards: ledger.rows[0],
    contributionModel: "Tutti i PC Velora minano verso il wallet operativo Velora; ogni dispositivo usa un worker pseudonimo separato per attribuzione e controllo.",
    warning: "Le statistiche mostrano la potenza collettiva Velora. Gli importi vengono confermati prima del payout."
  };
}

async function fetchMoneroOceanStats(wallet: string) {
  const trimmed = wallet.trim();
  if (!isLikelyCoinAddress("XMR", trimmed)) {
    return { configured: false, error: "XMR operational wallet missing or invalid" };
  }
  try {
    const response = await fetch(`https://api.moneroocean.stream/miner/${encodeURIComponent(trimmed)}/stats`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      return { configured: true, wallet: maskWallet(trimmed), reachable: false, error: `MoneroOcean HTTP ${response.status}` };
    }
    const data = await response.json() as Record<string, unknown>;
    return {
      configured: true,
      reachable: true,
      wallet: maskWallet(trimmed),
      source: "MoneroOcean",
      hash: Number(data.hash || 0),
      hash2: Number(data.hash2 || 0),
      lastHash: data.lastHash || null,
      lastShareAlgo: data.lastShareAlgo || null,
      totalHashes: Number(data.totalHashes || 0),
      validShares: Number(data.validShares || 0),
      invalidShares: Number(data.invalidShares || 0),
      amtDueAtomic: String(data.amtDue || 0),
      amtPaidAtomic: String(data.amtPaid || 0),
      txnCount: Number(data.txnCount || 0)
    };
  } catch (error) {
    return {
      configured: true,
      wallet: maskWallet(trimmed),
      reachable: false,
      error: error instanceof Error ? error.message : "MoneroOcean stats unavailable"
    };
  }
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
    warning: "Auto-Switch sceglie il profilo migliore disponibile quando i dati pool sono sufficienti."
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

function miningThresholdPayload() {
  return {
    xmrAtomic: miningPayoutThresholdAtomicByCoin.XMR.toString(),
    xmrLabel: formatAtomicAmount(miningPayoutThresholdAtomicByCoin.XMR.toString(), "XMR"),
    note: "Soglia beta payout manuale: equivalente iniziale 0.05 XMR."
  };
}

function mapMiningProgressRow(row: any) {
  const coin = String(row.coin ?? "XMR");
  const pending = BigInt(String(row.user_atomic_pending ?? "0"));
  const total = BigInt(String(row.user_atomic_total ?? "0"));
  const threshold = miningPayoutThresholdAtomicByCoin[coin] ?? miningPayoutThresholdAtomicByCoin.XMR;
  const progressBps = threshold > 0n ? Number((pending * 10000n) / threshold) : 0;
  return {
    ...row,
    payout_wallet: maskWallet(String(row.payout_wallet ?? "")),
    user_atomic_total: total.toString(),
    user_atomic_pending: pending.toString(),
    user_atomic_paid: String(row.user_atomic_paid ?? "0"),
    mined_label: formatAtomicAmount(total.toString(), coin),
    pending_label: formatAtomicAmount(pending.toString(), coin),
    paid_label: formatAtomicAmount(String(row.user_atomic_paid ?? "0"), coin),
    payout_threshold_atomic: threshold.toString(),
    payout_threshold_label: formatAtomicAmount(threshold.toString(), coin),
    payout_progress_bps: Math.max(0, Math.min(10000, progressBps)),
    payout_progress_percent: Math.max(0, Math.min(100, progressBps / 100)),
    payout_ready: pending >= threshold,
    accounting_note: Number(row.accepted_pool_shares ?? 0) > 0
      ? "Share pool presenti. Ricompensa visibile dopo riconciliazione pagamento pool."
      : "Nessuna share pool verificata ancora."
  };
}

function formatAtomicAmount(value: string, coin: string) {
  const atomic = BigInt(value || "0");
  const decimals = 12n;
  const unit = 10n ** decimals;
  const whole = atomic / unit;
  const fraction = atomic % unit;
  const fractionText = fraction.toString().padStart(Number(decimals), "0").replace(/0+$/, "").slice(0, 6);
  return `${whole.toString()}${fractionText ? `.${fractionText}` : ""} ${coin}`;
}

function sanitizeError(value: string) {
  return value.replace(/[A-Za-z0-9]{24,}/g, (match) => `${match.slice(0, 6)}...${match.slice(-4)}`).slice(0, 240);
}

const cloudQuotaBytes = 25 * 1024 * 1024;

async function cloudQuotaForUser(userId: string) {
  const result = await requirePool().query(
    `SELECT COALESCE(SUM(size_bytes),0)::int AS used_bytes
     FROM velora_cloud_files
     WHERE user_id=$1 AND deleted_at IS NULL`,
    [userId]
  );
  const usedBytes = Number(result.rows[0]?.used_bytes ?? 0);
  return {
    quotaBytes: cloudQuotaBytes,
    usedBytes,
    remainingBytes: Math.max(0, cloudQuotaBytes - usedBytes),
    quotaLabel: "25 MB",
    storage: "Velora Cloud beta",
    nasFallback: "predisposto"
  };
}

function sanitizeCloudFileName(value: string) {
  return basename(value.replaceAll("\\", "/")).trim().replace(/[^\w .-]/g, "_").slice(0, 120);
}

async function publicGuardianStatus() {
  const state = await guardianState();
  return {
    name: "Velora Guardian",
    status: state.emergencyMode ? "PROTEZIONE_DATI_ATTIVA" : "PROTETTO",
    breachedLevels: state.breachedLevels,
    totalLevels: 10,
    cloud: { chainedEncryption: true, layers: 10, multisigAvailable: true }
  };
}

async function adminGuardianStatus() {
  const pool = requirePool();
  const state = await guardianState();
  const [events, policies] = await Promise.all([
    pool.query("SELECT level, signal, source, target_type, target_id, severity, sanitized_detail, created_at FROM guardian_security_events ORDER BY created_at DESC LIMIT 100").catch(() => ({ rows: [] })),
    pool.query(
      `SELECT p.id, u.username AS owner, p.cosigner_username, p.status, p.requested_at, p.approved_at
       FROM cloud_multisig_policies p
       JOIN users u ON u.id = p.owner_user_id
       ORDER BY p.requested_at DESC LIMIT 100`
    ).catch(() => ({ rows: [] }))
  ]);
  return { status: state, levels: guardianLevels(), events: events.rows, cloudMultisig: policies.rows };
}

async function guardianState() {
  if (!config.guardianEnabled) {
    return { enabled: false, breachedLevels: 0, emergencyMode: false, lastSignal: null, lastSignalAt: null };
  }
  try {
    const result = await requirePool().query("SELECT breached_levels, emergency_mode, last_signal, last_signal_at FROM guardian_security_state WHERE id = 'global'");
    const row = result.rows[0];
    return {
      enabled: true,
      breachedLevels: Number(row?.breached_levels ?? 0),
      emergencyMode: Boolean(row?.emergency_mode),
      lastSignal: row?.last_signal ?? null,
      lastSignalAt: row?.last_signal_at ?? null
    };
  } catch {
    return { enabled: true, breachedLevels: 0, emergencyMode: false, lastSignal: "MIGRATION_PENDING", lastSignalAt: null };
  }
}

async function guardianBlocksSensitiveData() {
  const state = await guardianState();
  return Boolean(state.enabled && (state.emergencyMode || state.breachedLevels >= config.guardianEmergencyLevel));
}

function guardianEmergencyReply(reply: FastifyReply) {
  return reply.code(423).send({ code: "VELORA_GUARDIAN_EMERGENCY", message: "Protezione dati attiva. Scambio dati sensibili sospeso fino a verifica admin." });
}

async function registerGuardianSignal(input: { level: number; signal: string; source: string; actorUserId?: string; actorAdminId?: string; targetType: string; targetId?: string; detail?: string }) {
  const level = Math.max(1, Math.min(10, Math.trunc(input.level || 1)));
  await appendGuardianEvent({ ...input, level });
  const nextBreached = Math.max(level, (await guardianState()).breachedLevels);
  const emergency = nextBreached >= config.guardianEmergencyLevel;
  await requirePool().query(
    `INSERT INTO guardian_security_state (id, breached_levels, emergency_mode, last_signal, last_signal_at, updated_at)
     VALUES ('global', $1, $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       breached_levels = GREATEST(guardian_security_state.breached_levels, EXCLUDED.breached_levels),
       emergency_mode = guardian_security_state.emergency_mode OR EXCLUDED.emergency_mode,
       last_signal = EXCLUDED.last_signal,
       last_signal_at = EXCLUDED.last_signal_at,
       updated_at = NOW()`,
    [nextBreached, emergency, sanitizeSignal(input.signal)]
  );
  return adminGuardianStatus();
}

async function appendGuardianEvent(input: { level: number; signal: string; source: string; actorUserId?: string; actorAdminId?: string; targetType: string; targetId?: string; detail?: string }) {
  try {
    await requirePool().query(
      `INSERT INTO guardian_security_events (id, level, signal, source, actor_user_id, actor_admin_id, target_type, target_id, severity, sanitized_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        Math.max(1, Math.min(10, Math.trunc(input.level))),
        sanitizeSignal(input.signal),
        sanitizeSignal(input.source),
        input.actorUserId ?? null,
        input.actorAdminId ?? null,
        sanitizeSignal(input.targetType),
        input.targetId ? String(input.targetId).slice(0, 120) : null,
        input.level >= config.guardianEmergencyLevel ? "CRITICAL" : input.level >= 5 ? "WARNING" : "NOTICE",
        sanitizeError(String(input.detail ?? ""))
      ]
    );
  } catch {
    return;
  }
}

function guardianLevels() {
  return ["Sessione", "Input", "Permessi", "Device", "Cifratura", "Integrita", "Multifirma", "Audit", "Blocco dati", "Emergenza"];
}

async function cloudProtectionState(userId: string) {
  const [guardian, policy, pending] = await Promise.all([publicGuardianStatus(), activeOrPendingCloudMultisigPolicy(userId), pendingCloudMultisigActions(userId)]);
  return { guardian, cloud: { encryption: "VELORA_CHAINED_REDUNDANT_V1", layers: 10, multisig: policy, pendingActions: pending } };
}

async function requestCloudMultisig(userId: string, cosignerUsername: string) {
  const cosigner = await repository.findUserByUsername(cosignerUsername);
  if (!cosigner || cosigner.id === userId) {
    throw new Error("CLOUD_MULTISIG_COSIGNER_INVALID");
  }
  const result = await requirePool().query(
    `INSERT INTO cloud_multisig_policies (id, owner_user_id, cosigner_user_id, cosigner_username, status)
     VALUES ($1,$2,$3,$4,'PENDING')
     ON CONFLICT (owner_user_id) WHERE status IN ('PENDING','ACTIVE')
     DO UPDATE SET cosigner_user_id = EXCLUDED.cosigner_user_id, cosigner_username = EXCLUDED.cosigner_username, status = 'PENDING', updated_at = NOW()
     RETURNING id, cosigner_username, status, requested_at`,
    [randomUUID(), userId, cosigner.id, cosigner.username]
  );
  await notifyUser(cosigner.id, "CLOUD_MULTISIG_REQUEST", "Richiesta protezione Cloud", "Un account Velora ti ha scelto come seconda firma.");
  return { policy: result.rows[0], message: "Richiesta inviata al secondo account Velora." };
}

async function approveCloudMultisig(userId: string, policyId: string, actionId: string) {
  if (actionId) {
    const result = await requirePool().query(
      `UPDATE cloud_multisig_approvals a
       SET status='APPROVED', approved_by_user_id=$1, approved_at=NOW()
       FROM cloud_multisig_policies p
       WHERE a.policy_id=p.id AND a.id=$2 AND p.cosigner_user_id=$1 AND a.status='PENDING' AND a.expires_at > NOW()
       RETURNING a.id, a.action, a.status, a.target_file_id`,
      [userId, actionId]
    );
    if (!result.rows[0]) throw new Error("CLOUD_MULTISIG_ACTION_NOT_FOUND");
    return { action: result.rows[0], message: "Azione approvata." };
  }
  const result = await requirePool().query(
    `UPDATE cloud_multisig_policies SET status='ACTIVE', approved_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND cosigner_user_id=$2 AND status='PENDING'
     RETURNING id, cosigner_username, status, approved_at`,
    [policyId, userId]
  );
  if (!result.rows[0]) throw new Error("CLOUD_MULTISIG_POLICY_NOT_FOUND");
  return { policy: result.rows[0], message: "Multifirma Cloud attiva." };
}

async function revokeCloudMultisig(userId: string) {
  const result = await requirePool().query(
    "UPDATE cloud_multisig_policies SET status='REVOKED', revoked_at=NOW(), updated_at=NOW() WHERE owner_user_id=$1 AND status IN ('PENDING','ACTIVE') RETURNING id",
    [userId]
  );
  return { revoked: Boolean(result.rows[0]) };
}

async function activeCloudMultisigPolicy(userId: string) {
  const result = await requirePool().query("SELECT id, cosigner_username, status FROM cloud_multisig_policies WHERE owner_user_id=$1 AND status='ACTIVE' LIMIT 1", [userId]);
  return result.rows[0];
}

async function activeOrPendingCloudMultisigPolicy(userId: string) {
  const result = await requirePool().query("SELECT id, cosigner_username, status, requested_at, approved_at FROM cloud_multisig_policies WHERE owner_user_id=$1 AND status IN ('PENDING','ACTIVE') ORDER BY requested_at DESC LIMIT 1", [userId]);
  return result.rows[0] ?? null;
}

async function pendingCloudMultisigActions(userId: string) {
  const result = await requirePool().query(
    `SELECT a.id, a.action, a.target_file_id, a.status, a.requested_at, a.expires_at, p.cosigner_username
     FROM cloud_multisig_approvals a JOIN cloud_multisig_policies p ON p.id = a.policy_id
     WHERE p.owner_user_id=$1 AND a.status='PENDING' AND a.expires_at > NOW()
     ORDER BY a.requested_at DESC LIMIT 50`,
    [userId]
  );
  return result.rows;
}

async function ensureCloudMultisigAction(userId: string, fileId: string, action: string) {
  const policy = await activeCloudMultisigPolicy(userId);
  if (!policy) return { allowed: true };
  const approved = await requirePool().query(
    `SELECT id FROM cloud_multisig_approvals
     WHERE policy_id=$1 AND target_file_id=$2 AND action=$3 AND status='APPROVED' AND approved_at > NOW() - INTERVAL '15 minutes'
     LIMIT 1`,
    [policy.id, fileId, action]
  );
  if (approved.rows[0]) return { allowed: true, approvedByMultisig: true };
  const pendingId = randomUUID();
  await requirePool().query(
    `INSERT INTO cloud_multisig_approvals (id, policy_id, action, target_file_id, requested_by_user_id)
     SELECT $1,$2,$3,$4,$5
     WHERE NOT EXISTS (
       SELECT 1 FROM cloud_multisig_approvals WHERE policy_id=$2 AND target_file_id=$4 AND action=$3 AND status='PENDING' AND expires_at > NOW()
     )`,
    [pendingId, policy.id, action, fileId, userId]
  );
  const existing = await requirePool().query(
    `SELECT id, action, status, expires_at FROM cloud_multisig_approvals
     WHERE policy_id=$1 AND target_file_id=$2 AND action=$3 AND status='PENDING' AND expires_at > NOW()
     ORDER BY requested_at DESC LIMIT 1`,
    [policy.id, fileId, action]
  );
  return { allowed: false, code: "CLOUD_MULTISIG_APPROVAL_REQUIRED", message: "Serve conferma del secondo account Velora.", action: existing.rows[0], cosignerUsername: policy.cosigner_username };
}

function openCloudFileBytes(userId: string, row: any) {
  if (row.protection_scheme === "VELORA_CHAINED_REDUNDANT_V1" && row.content_envelope) {
    return openChainedPayload(typeof row.content_envelope === "string" ? JSON.parse(row.content_envelope) : row.content_envelope, config.cloudEncryptionSecret, `cloud:${userId}:${row.id}`);
  }
  return Buffer.from(String(row.content_base64), "base64");
}

function sanitizeSignal(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 80);
}

function veloraGuideCatalog() {
  return [
    guide("start", "Primi passi Velora", "Installa Velora, crea account, verifica lo stato connessione e apri la prima zona.", ["download", "account", "home", "esplora"]),
    guide("account", "Account e identita", "Registrazione, login, key token di recupero, profilo, device e limiti account.", ["registrazione", "login", "identita", "recupero"]),
    guide("search", "Cercare e aprire siti", "Usa Esplora per trovare zone, contenuti Oceano, guide e strumenti. Apri i risultati con il pulsante Apri.", ["motore", "ricerca", "zone", "oceano"]),
    guide("publisher", "Pubblicare un sito", "Seleziona cartella, controlla manifest, prepara pacchetto, pubblica e verifica indicizzazione.", ["pubblica", "manifest", "zona", "sito"]),
    guide("login", "Login Velora nei siti", "I siti pubblicati possono usare la sessione Velora per evitare account paralleli.", ["sdk", "login", "sessione"]),
    guide("mail", "VeloMail", "Invia e ricevi messaggi tra account Velora con archivio persistente.", ["mail", "messaggi"]),
    guide("forum", "Forum e chat", "Scrivi nel forum globale, aggiorna i messaggi e segnala abusi se necessario.", ["chat", "forum", "segnalazioni"]),
    guide("mining", "Mining collettivo", "Attiva mining solo con consenso, controlla worker, hashrate, share e soglia payout manuale.", ["mining", "worker", "payout", "hashrate"]),
    guide("cloud", "Velora Cloud beta", "Ogni account registrato ha 25 MB di spazio test per file personali sincronizzabili con rete e NAS fallback.", ["cloud", "nas", "file", "storage"]),
    guide("nodes", "Nodi e NAS fallback", "Il nodo desktop e il NAS aiutano disponibilita contenuti, replica e resilienza della rete.", ["nodi", "nas", "replica"]),
    guide("tools", "Velora Tools", "Usa strumenti per wallet, mining monitor, validator, traduzione, TTS, sicurezza e creator studio.", ["tool", "tts", "traduttore", "validator"]),
    guide("safety", "Sicurezza e privacy", "Velora non chiede seed, chiavi private o password wallet. Controlla sempre hash e download ufficiali.", ["sicurezza", "privacy", "wallet", "hash"])
  ];
}

function guide(slug: string, title: string, body: string, tags: string[]) {
  const address = `guide.${slug}`;
  return {
    slug,
    address,
    category: "GUIDA",
    title,
    description: body,
    body,
    tags,
    publisher: "Velora",
    family_safe: true,
    trust_level: 100,
    availability: 1,
    updated_at: new Date("2026-07-17T00:00:00.000Z").toISOString()
  };
}

function searchVeloraGuide(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return veloraGuideCatalog()
    .filter((item) => {
      const haystack = `${item.address} ${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .map((item) => ({
      address: item.address,
      category: item.category,
      slug: item.slug,
      title: item.title,
      description: item.description,
      publisher: item.publisher,
      age_rating: "family",
      family_safe: true,
      trust_level: item.trust_level,
      content_cid: null,
      release_version: "guide",
      availability: 1,
      updated_at: item.updated_at
    }));
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
