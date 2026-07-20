import { createReadStream } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
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
  app.get("/mobile", async (_request, reply) => reply.redirect("/portal", 302));
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
  app.get("/legal/terms", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicPage("terms")));
  app.get("/z/:address", async (request, reply) => {
    const address = routeParam(request.params, "address");
    const fallback = await findPublicZone(address);
    return reply.type("text/html; charset=utf-8").send(publicZonePage(address, fallback));
  });
  app.get("/zone/:address", async (request, reply) => {
    const address = routeParam(request.params, "address");
    const fallback = await findPublicZone(address);
    return reply.type("text/html; charset=utf-8").send(publicZonePage(address, fallback));
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
    if (!body?.username || !body?.password) {
      return reply.badRequest("username and password are required");
    }

    if (await repository.findUserByUsername(body.username)) {
      return reply.conflict("username already exists");
    }

    const user = await repository.createUser(body.username, hashPassword(body.password));
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
    const user = body?.username ? await repository.findUserByUsername(body.username) : undefined;
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
    .searchbox,input,textarea,select{width:100%;border:1px solid var(--line);border-radius:16px;background:rgba(0,0,0,.18);color:var(--ink);padding:12px 14px}.light .searchbox,.light input,.light textarea,.light select{background:#fff}textarea{min-height:110px;resize:vertical}
    .content{padding:18px;max-width:1500px;margin:auto}.hero,.panel{border:1px solid var(--line);border-radius:28px;background:linear-gradient(150deg,rgba(16,39,59,.92),rgba(7,26,42,.88));box-shadow:0 18px 70px rgba(0,0,0,.22)}.light .hero,.light .panel{background:linear-gradient(150deg,#fff,#f6fbff);box-shadow:0 18px 50px rgba(44,78,104,.12)}
    .hero{padding:26px;margin-bottom:16px}.kicker{color:var(--gold);font-size:12px;font-weight:1000;letter-spacing:.15em;text-transform:uppercase}h1{font-size:clamp(36px,6vw,72px);line-height:.92;margin:10px 0 14px}h2{margin:0 0 12px;font-size:23px}h3{margin:16px 0 8px}p{margin:0 0 10px;color:var(--muted);line-height:1.45}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-6{grid-column:span 6}.span-8{grid-column:span 8}.span-12{grid-column:1/-1}.panel{padding:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card,.item{border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.045);padding:13px}.light .card,.light .item{background:#fff}.card b{display:block;color:var(--gold);font-size:12px;letter-spacing:.08em;text-transform:uppercase}.card span{font-size:22px;font-weight:1000}.list{display:grid;gap:10px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.muted{color:var(--muted)}.ok{color:var(--green)}.bad{color:var(--red)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
    .module{display:none}.module.active{display:block}.mail-layout{display:grid;grid-template-columns:180px minmax(220px,320px) minmax(0,1fr);gap:12px}.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.drop{border:1px dashed var(--line);border-radius:18px;padding:18px;text-align:center}.hidden{display:none!important}
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
    function renderNav(){const html=modules.map(([id,label])=>'<button class="'+(id===currentSection?'active':'')+'" onclick="showModule(\\''+id+'\\')">'+label+'</button>').join('');sideNav.innerHTML=html;mobileNav.innerHTML=modules.filter(x=>['home','search','cloud','mining','tools'].includes(x[0])).map(([id,label])=>'<button class="'+(id===currentSection?'active':'')+'" onclick="showModule(\\''+id+'\\')">'+label+'</button>').join('')}
    function portalBase(){return location.pathname.startsWith('/apple')?'/apple':'/portal'}
    function showModule(id){currentSection=id;document.querySelectorAll('.module').forEach(el=>el.classList.toggle('active',el.id==='m-'+id));history.replaceState(null,'',portalBase()+'/'+id);renderNav();loadModule(id)}
    function saveSession(data){localStorage.setItem(tokenKey,data.accessToken||data.token||'');if(data.refreshToken)localStorage.setItem(refreshKey,data.refreshToken);localStorage.setItem(userKey,JSON.stringify(data.user||{}))}
    function sessionUser(){try{return JSON.parse(localStorage.getItem(userKey)||'{}')}catch{return {}}}
    function setSessionState(){const u=sessionUser();const logged=Boolean(token());sessionState.textContent=logged?'Connesso come '+(u.username||'utente Velora'):'Accesso non effettuato';profileButton.textContent=logged?(u.username||'Profilo'):'Profilo';if(document.getElementById('authForm'))authForm.classList.toggle('hidden',logged);if(document.getElementById('accountBox'))accountBox.classList.toggle('hidden',!logged);if(document.getElementById('accountName'))accountName.textContent=u.username||'utente Velora';if(document.getElementById('accountMail'))accountMail.textContent=(u.mail||u.username||'account')+'';}
    function clearAuthFields(){if(document.getElementById('authPass'))authPass.value='';if(document.getElementById('authUser'))authUser.value='';}
    async function register(){try{const data=await api('/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:authUser.value,password:authPass.value})});saveSession(data);localStorage.setItem(userKey,JSON.stringify({...data.user,mail:data.mail?.address}));clearAuthFields();authMsg.textContent='Account creato';setSessionState();loadModule(currentSection)}catch(e){authMsg.textContent=e.message}}
    async function login(){try{const data=await api('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:authUser.value,password:authPass.value})});saveSession(data);localStorage.setItem(userKey,JSON.stringify({...data.user,mail:data.mail?.address}));clearAuthFields();authMsg.textContent='Accesso effettuato';setSessionState();loadModule(currentSection)}catch(e){authMsg.textContent=e.message}}
    async function refreshSession(){const refreshToken=localStorage.getItem(refreshKey);if(!refreshToken)return;try{const data=await api('/api/v1/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refreshToken})});saveSession({...data,user:sessionUser()});setSessionState()}catch{}}
    function logout(){localStorage.removeItem(tokenKey);localStorage.removeItem(refreshKey);localStorage.removeItem(userKey);setSessionState();showModule('home')}
    function toggleTheme(){document.documentElement.classList.toggle('light');document.body.classList.toggle('light');localStorage.setItem('velora.apple.theme',document.documentElement.classList.contains('light')?'light':'dark')}
    function installHelp(){const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;const isApple=/Mac|iPhone|iPad|iPod/.test(navigator.platform)||navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent);const isSafari=/Safari/.test(navigator.userAgent)&&!/Chrome|CriOS|Edg|Firefox|FxiOS/.test(navigator.userAgent);if(standalone)alert('Velora e gia aperta come app.');else if(isApple&&isSafari&&/iPhone|iPad|iPod/.test(navigator.userAgent))alert('Tocca Condividi e poi Aggiungi alla schermata Home.');else if(isApple&&isSafari)alert('Da Safari su Mac apri File e scegli Aggiungi al Dock.');else alert('Apri questa pagina in Safari per installare Velora nel Dock o nella schermata Home.');}
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e});
    if('serviceWorker'in navigator)navigator.serviceWorker.register('/apple-sw.js').catch(()=>undefined);
    window.addEventListener('message',async event=>{if(event.data?.type!=='VELORA_AUTH_REQUEST')return;if(!token()){showModule('home');authMsg.textContent='Accedi o registrati per collegare il sito al tuo account Velora';event.source?.postMessage({type:'VELORA_AUTH_STATE',loggedIn:false,reason:'LOGIN_REQUIRED'},'*');return}try{const state=await api('/api/v1/auth/portal-session',{headers:headers()});event.source?.postMessage({type:'VELORA_AUTH_STATE',loggedIn:true,username:state.user.username,mail:state.mail.address,identityLevel:state.user.identityLevel,scopes:state.scopes},'*')}catch(e){event.source?.postMessage({type:'VELORA_AUTH_STATE',loggedIn:false,reason:e.message},'*')}})
    async function runGlobalSearch(){showModule('search');searchQuery.value=globalSearch.value;await loadSearch()}
    async function loadHome(){try{const [health,guardian,manifest]=await Promise.all([api('/health'),api('/api/v1/guardian/status'),api('/release-manifest.json')]);homeCards.innerHTML=card('Rete',health.ok?'Online':'Verifica')+card('Guardian',guardian.status||'Protetto')+card('Versione',manifest.version||'Beta')+card('PWA','Installabile');}catch(e){homeCards.innerHTML=item('Stato',e.message)}}
    async function loadSearch(){try{const q=(currentSection==='oceano'?oceanoQuery.value:searchQuery.value)||globalSearch.value||'velora';const data=await api('/api/v1/search?q='+encodeURIComponent(q));const html=(data.results||[]).map(r=>'<div class="item"><b>'+esc(r.title||r.address)+'</b><p>'+esc(r.description||r.summary||'')+'</p><button onclick="openZone(\\''+esc(r.address||r.zone||'')+'\\')">Apri</button></div>').join('')||item('Search','Nessun risultato');searchResults.innerHTML=html;if(document.getElementById('oceanoResults'))oceanoResults.innerHTML=html;}catch(e){const html=item('Search',e.message);searchResults.innerHTML=html;if(document.getElementById('oceanoResults'))oceanoResults.innerHTML=html;}}
    function openZone(address){browserAddress.value=address;showModule('browser');browserFrame.src='/zone/'+encodeURIComponent(address)}
    async function loadMail(){if(!token())return mailList.innerHTML=item('VeloMail','Accedi per leggere la posta');try{const [account,inbox]=await Promise.all([api('/api/v1/mail/account',{headers:headers()}),api('/api/v1/mail/inbox',{headers:headers()})]);mailAccount.textContent=account.address||'';mailList.innerHTML=(inbox.messages||[]).map(m=>'<button onclick="openMail(\\''+m.id+'\\')">'+esc(m.subject||'Messaggio')+'</button>').join('')||'<p>Nessun messaggio</p>'}catch(e){mailList.innerHTML=item('VeloMail',e.message)}}
    async function openMail(id){try{selectedMessageId=id;const m=await api('/api/v1/mail/messages/'+id,{headers:headers()});mailOpen.innerHTML='<h3>'+esc(m.subject||'Messaggio')+'</h3><p class="mono">'+esc(m.from_address||m.from||'')+'</p><p>'+esc(m.body||m.body_ciphertext||'Messaggio cifrato')+'</p>'}catch(e){mailOpen.innerHTML=item('Errore',e.message)}}
    async function sendMail(){try{await api('/api/v1/mail/send',{method:'POST',headers:headers(true),body:JSON.stringify({to:mailTo.value.split(',').map(x=>x.trim()).filter(Boolean),subject:mailSubject.value,body:mailBody.value,subjectCiphertext:mailSubject.value,bodyCiphertext:mailBody.value,encryptedByClient:true})});mailComposerMsg.textContent='Invio completato';loadMail()}catch(e){mailComposerMsg.textContent=e.message}}
    async function loadCloud(){if(!token())return cloudFiles.innerHTML=item('Cloud','Accedi per usare Cloud');try{const data=await api('/api/v1/cloud/files',{headers:headers()});cloudQuota.textContent=(data.quota?.quotaLabel||'25 MB')+' - usati '+(data.quota?.usedBytes||0)+' byte';cloudFiles.innerHTML=(data.files||[]).map(f=>'<div class="item"><b>'+esc(f.name)+'</b><p>'+esc(f.guardian_status||'PROTECTED')+' - '+f.size_bytes+' byte</p><button onclick="downloadCloud(\\''+f.id+'\\',\\''+esc(f.name)+'\\')">Download</button></div>').join('')||item('Cloud','Nessun file')}catch(e){cloudFiles.innerHTML=item('Cloud',e.message)}}
    async function uploadCloud(){const files=[...cloudInput.files];for(const file of files){const b64=await fileToBase64(file);await api('/api/v1/cloud/files',{method:'POST',headers:headers(true),body:JSON.stringify({name:file.name,mimeType:file.type||'application/octet-stream',contentBase64:b64})})}loadCloud()}
    function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(file)})}
    async function downloadCloud(id,name){const data=await fetch('/api/v1/cloud/files/'+id+'/download',{headers:headers()}).then(r=>r.text());const blob=new Blob([data]);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
    async function loadTools(){try{const data=await api('/api/v1/tools');toolList.innerHTML=(data.tools||[]).map(t=>'<div class="item"><b>'+esc(t.name)+'</b><p>'+esc(t.description)+'</p><button onclick="runTool(\\''+esc(t.action||t.zone||t.name)+'\\')">Esegui</button></div>').join('')}catch(e){toolList.innerHTML=item('Tools',e.message)}}
    async function runTool(action){const text=toolInput.value;let out='';if(action.includes('tts')){speechSynthesis.speak(new SpeechSynthesisUtterance(text));out='Lettura avviata'}else if(action.includes('hash')){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));out=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}else if(action.includes('wallet')){out=/^(4|8)[1-9A-HJ-NP-Za-km-z]{90,110}$|^Z[a-zA-Z0-9]{70,120}$/.test(text.trim())?'Wallet valido':'Wallet non riconosciuto'}else out='Strumento eseguito nel portale quando supportato dal browser';toolOutput.textContent=out}
    async function loadForum(){if(!token())return forumMessages.innerHTML=item('Forum','Accedi per usare il forum');try{const sections=await api('/api/v1/forum/sections',{headers:headers()});currentForumSlug=(sections.sections||[])[0]?.slug||currentForumSlug;const data=await api('/api/v1/forum/sections/'+encodeURIComponent(currentForumSlug)+'/messages',{headers:headers()});forumMessages.innerHTML=(data.messages||[]).map(m=>item(m.username||'Velora',m.body||m.message||'')).join('')||item('Forum','Nessun messaggio')}catch(e){forumMessages.innerHTML=item('Forum',e.message)}}
    async function sendForum(){try{await api('/api/v1/forum/sections/'+encodeURIComponent(currentForumSlug)+'/messages',{method:'POST',headers:headers(true),body:JSON.stringify({body:forumDraft.value})});forumDraft.value='';loadForum()}catch(e){alert(e.message)}}
    async function loadMining(){if(!token())return miningBox.innerHTML=item('Mining','Accedi per vedere mining');try{const [progress,targets,history]=await Promise.all([api('/api/v1/mining/progress',{headers:headers()}),api('/api/v1/execution/targets',{headers:headers()}),api('/api/v1/mining/history',{headers:headers()})]);targetSelect.innerHTML=(targets.targets||[]).filter(t=>(t.capabilities||[]).includes('MINING_START')).map(t=>'<option value="'+esc(t.type+':'+t.id)+'">'+esc(t.label+' - '+t.status)+'</option>').join('');miningBox.innerHTML=(progress.workers||[]).map(w=>item(w.worker_id||'worker','Share ok '+(w.accepted_pool_shares||0)+' - payout '+(w.pending_label||'-')+' - soglia '+(w.payout_threshold_label||'-'))).join('')||item('Mining','Nessun worker');miningHistory.innerHTML=(history.payoutRequests||[]).map(p=>item(p.status,p.coin+' '+(p.payout_tx_hash||''))).join('')}catch(e){miningBox.innerHTML=item('Mining',e.message)}}
    async function execMining(op){const [type,id]=(targetSelect.value||'SERVER:').split(':');try{await api('/api/v1/execution/operations',{method:'POST',headers:headers(true),body:JSON.stringify({operation:op,targetType:type||'SERVER',targetId:id,requestedState:op,payload:{profile:miningProfile.value,coin:miningCoin.value},idempotencyKey:op+'-'+Date.now()})});loadMining()}catch(e){alert(e.message)}}
    async function loadNodes(){if(!token()){const html=item('Nodi','Accedi per vedere i nodi');nodesBox.innerHTML=html;if(document.getElementById('nasBox'))nasBox.innerHTML=html;return}try{const data=await api('/api/v1/execution/targets',{headers:headers()});const targets=data.targets||[];nodesBox.innerHTML=targets.map(t=>item(t.label,t.type+' - '+t.status+' - '+(t.online?'online':'offline'))).join('')||item('Nodi','Nessun nodo');if(document.getElementById('nasBox')){const nas=targets.filter(t=>t.type==='NAS');nasBox.innerHTML=nas.map(t=>item(t.label,(t.online?'online':'offline')+' - '+(t.storageAvailableBytesLabel||'spazio in verifica')+' - ultimo contatto '+(t.lastSeenAt||'-'))).join('')||item('NAS','Nessun NAS associato all account');}opsBox.innerHTML=(data.operations||[]).map(o=>item(o.operation,o.status+' - '+(o.target_type||''))).join('')||item('Operazioni','Nessuna operazione recente')}catch(e){nodesBox.innerHTML=item('Nodi',e.message);if(document.getElementById('nasBox'))nasBox.innerHTML=item('NAS',e.message)}}
    async function preparePublisher(){if(!token())return publisherStatus.textContent='Accedi per preparare una pubblicazione';try{const payload={address:publisherAddress.value.trim(),title:publisherTitle.value.trim(),description:publisherDescription.value.trim(),category:publisherCategory.value,keywords:publisherKeywords.value.split(',').map(x=>x.trim()).filter(Boolean),version:publisherVersion.value.trim()||'1.0.0',entryFile:'index.html',languages:['it'],ageRating:'EVERYONE',familySafe:true,permissions:{externalNetwork:false,clipboardRead:false,clipboardWrite:false,notifications:false,fileDownload:false},allowedExternalOrigins:[]};const data=await api('/api/v1/sites/portal-prepare',{method:'POST',headers:headers(true),body:JSON.stringify(payload)});publisherStatus.innerHTML=(data.ready?'<b class="ok">Pronto per pubblicare</b>':'<b class="bad">Correggi prima di pubblicare</b>')+'<pre>'+esc(JSON.stringify(data,null,2))+'</pre>';publisherManifest.value=JSON.stringify(data.manifest,null,2)}catch(e){publisherStatus.textContent=e.message}}
    async function queuePublish(){if(!token())return publisherStatus.textContent='Accedi per continuare';try{await preparePublisher();await api('/api/v1/execution/operations',{method:'POST',headers:headers(true),body:JSON.stringify({operation:'PUBLISH_VALIDATE',targetType:'SERVER',idempotencyKey:'publish-'+Date.now(),payload:{address:publisherAddress.value.trim(),source:'portal'}})});publisherStatus.innerHTML+='<p class="ok">Validazione registrata. Per caricare file locali usa desktop, NAS agent o nodo autorizzato.</p>'}catch(e){publisherStatus.textContent=e.message}}
    async function loadPublisher(){publisherStatus.textContent='Compila i campi. Il portale genera manifest valido e guida il passaggio successivo senza usare account paralleli.'}
    function loadModule(id){if(id==='home')loadHome();if(id==='search'||id==='oceano')loadSearch();if(id==='mail')loadMail();if(id==='cloud')loadCloud();if(id==='tools')loadTools();if(id==='forum')loadForum();if(id==='mining')loadMining();if(id==='nodes'||id==='nas')loadNodes();if(id==='publisher')loadPublisher();}
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
        <div class="panel span-8"><h2>Accedi a Velora</h2><p>Un solo account per portale, desktop, siti pubblicati, VeloMail, Cloud e forum.</p><div id="authForm"><div class="row"><input id="authUser" autocomplete="username" placeholder="Username"><input id="authPass" autocomplete="current-password" type="password" placeholder="Password"></div><div class="row"><button class="primary" onclick="login()">Accedi</button><button onclick="register()">Crea account</button></div></div><div id="accountBox" class="hidden"><div class="card"><b>Account attivo</b><span id="accountName">utente Velora</span><p id="accountMail"></p></div><button onclick="logout()">Esci</button></div><p id="authMsg"></p></div>
        <div class="panel span-4"><h2>Uso rapido</h2><p>Da telefono non serve installare niente. Salva il portale nella schermata Home se vuoi aprirlo come app.</p><button onclick="installHelp()">Come salvarlo</button></div>
        <div class="panel span-12"><h2>Dashboard</h2><div id="homeCards" class="cards"></div></div>
        <div class="panel span-4"><h2>Esplora</h2><p>Cerca zone, Oceano e guide. I risultati si aprono nel browser Velora.</p><button onclick="showModule('search')">Cerca ora</button></div>
        <div class="panel span-4"><h2>Comunica</h2><p>VeloMail e forum usano la stessa sessione del tuo account.</p><button onclick="showModule('mail')">Apri VeloMail</button></div>
        <div class="panel span-4"><h2>Pubblica</h2><p>Il Publisher guidato genera un manifest valido e riduce gli errori.</p><button onclick="showModule('publisher')">Prepara sito</button></div>
      </div>
    </section>
    <section id="m-search" class="module${active("search")}"><div class="panel"><h2>Search</h2><div class="row"><input id="searchQuery" placeholder="Cerca zone, Oceano, tools, guide"><button class="primary" onclick="loadSearch()">Cerca</button></div><div id="searchResults" class="list"></div></div></section>
    <section id="m-browser" class="module${active("browser")}"><div class="panel"><h2>Browser Velora</h2><div class="row"><input id="browserAddress" placeholder="happy.meter"><button onclick="openZone(browserAddress.value)">Apri zona</button></div><iframe id="browserFrame" title="Velora Browser" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:20px;background:#fff"></iframe></div></section>
    <section id="m-mail" class="module${active("mail")}"><div class="mail-layout"><div class="panel"><h2>Cartelle</h2><p id="mailAccount"></p><button onclick="loadMail()">Inbox</button></div><div class="panel"><h2>Messaggi</h2><div id="mailList" class="list"></div></div><div class="panel"><h2>VeloMail</h2><div id="mailOpen"></div><h3>Componi</h3><input id="mailTo" placeholder="destinatario@velora"><input id="mailSubject" placeholder="Oggetto"><textarea id="mailBody" placeholder="Messaggio"></textarea><button class="primary" onclick="sendMail()">Invia</button><p id="mailComposerMsg"></p></div></div></section>
    <section id="m-cloud" class="module${active("cloud")}"><div class="split"><div class="panel"><h2>Velora Cloud</h2><p id="cloudQuota"></p><div class="drop"><input id="cloudInput" type="file" multiple><button class="primary" onclick="uploadCloud()">Carica</button></div></div><div class="panel"><h2>File</h2><div id="cloudFiles" class="list"></div></div></div></section>
    <section id="m-publisher" class="module${active("publisher")}"><div class="split"><div class="panel"><h2>Publisher Studio</h2><p>Compila i campi e Velora genera un manifest valido. I file locali vengono caricati da desktop, NAS agent o nodo autorizzato.</p><input id="publisherAddress" placeholder="shop.nome-sito"><input id="publisherTitle" placeholder="Titolo sito"><textarea id="publisherDescription" placeholder="Descrizione chiara del sito"></textarea><div class="row"><select id="publisherCategory"><option>shop</option><option>tool</option><option>social</option><option>video</option><option>blog</option><option>business</option><option>community</option><option>education</option><option>health</option><option>science</option><option>service</option><option>tech</option><option>cloud</option><option>portfolio</option><option>news</option></select><input id="publisherVersion" placeholder="1.0.0"></div><input id="publisherKeywords" placeholder="keyword separate da virgola"><div class="row"><button onclick="preparePublisher()">Controlla</button><button class="primary" onclick="queuePublish()">Prepara pubblicazione</button></div><div id="publisherStatus"></div></div><div class="panel"><h2>Manifest generato</h2><textarea id="publisherManifest" readonly placeholder="Il manifest appare qui dopo il controllo"></textarea><h3>Login Velora</h3><p>I siti pubblicati devono usare il bridge VELORA_AUTH_REQUEST. Il portale risponde con VELORA_AUTH_STATE quando l'utente e collegato.</p></div></div></section>
    <section id="m-tools" class="module${active("tools")}"><div class="split"><div class="panel"><h2>Velora Tools</h2><textarea id="toolInput" placeholder="Testo, wallet, link o contenuto"></textarea><pre id="toolOutput"></pre></div><div class="panel"><h2>40 strumenti</h2><div id="toolList" class="list"></div></div></div></section>
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
    input,textarea,button,select{width:100%;border:1px solid var(--line);border-radius:16px;background:#06121d;color:var(--ink);padding:13px 14px;font:inherit}textarea{min-height:110px;resize:vertical}button{font-weight:900;background:linear-gradient(135deg,#264a64,#11263a);cursor:pointer}button.primary{background:linear-gradient(135deg,var(--gold),#f7df91);border:0;color:#07131e}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stack{display:grid;gap:10px}.muted{color:var(--muted)}.ok{color:var(--green)}.bad{color:var(--red)}.list{display:grid;gap:10px}.item{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;background:rgba(0,0,0,.13)}.item small{color:var(--muted)}
    nav.mobile{position:fixed;left:10px;right:10px;bottom:10px;z-index:10;background:rgba(6,19,31,.92);border:1px solid var(--line);border-radius:24px;padding:8px;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;backdrop-filter:blur(18px)}nav.mobile button{padding:10px 4px;border-radius:16px;font-size:12px}nav.mobile button.active{background:linear-gradient(135deg,var(--gold),#f6df95);color:#07131e}
    section[data-page]{display:none}section[data-page].active{display:block}.install{display:none}.install.show{display:block}
    @media(min-width:720px){h1{font-size:52px}.grid{grid-template-columns:repeat(4,1fr)}nav.mobile{max-width:760px;margin:auto}}
  </style>
</head>
<body>
  <header>
    <div class="brand"><div class="logo">V</div><div><b>VELORA</b><span>Mobile beta</span></div></div>
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
      <div class="panel stack">
        <h2>Account Velora</h2>
        <input id="username" placeholder="Username">
        <input id="email" placeholder="Email per nuova registrazione">
        <input id="password" type="password" placeholder="Password">
        <div class="row"><button class="primary" onclick="login()">Entra</button><button onclick="register()">Crea account</button></div>
        <button onclick="logout()">Esci</button>
        <p id="authMsg" class="muted"></p>
      </div>
      <div class="panel">
        <h2>Stato Velora</h2>
        <div class="grid" id="homeCards"></div>
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
    <button class="active" onclick="showPage('home',this)">Home</button>
    <button onclick="showPage('tools',this)">Tools</button>
    <button onclick="showPage('cloud',this)">Cloud</button>
    <button onclick="showPage('mining',this)">Mining</button>
    <button onclick="showPage('nodes',this)">Nodi</button>
  </nav>
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
    function showPage(page,button){ document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page)); document.querySelectorAll('nav.mobile button').forEach(el=>el.classList.remove('active')); if(button) button.classList.add('active'); location.hash=page; if(page==='tools') loadTools(); if(page==='cloud') loadCloud(); if(page==='mining') loadMining(); if(page==='nodes') loadNodes(); if(page==='forum') loadForum(); }
    async function register(){ try{ const body={username:username.value.trim(),email:email.value.trim(),password:password.value}; const data=await api('/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); saveSession(data); setMsg('authMsg','Account creato','ok'); boot(); }catch(e){ setMsg('authMsg',e.message,'bad'); } }
    async function login(){ try{ const body={username:username.value.trim(),password:password.value}; const data=await api('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); saveSession(data); setMsg('authMsg','Accesso effettuato','ok'); boot(); }catch(e){ setMsg('authMsg',e.message,'bad'); } }
    function saveSession(data){ localStorage.setItem(tokenKey,data.accessToken||data.token||''); localStorage.setItem(userKey, JSON.stringify(data.user||{})); }
    function logout(){ localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); boot(); }
    async function boot(){ const user=JSON.parse(localStorage.getItem(userKey)||'{}'); sessionState.textContent=token() ? 'Connesso come ' + (user.username||'utente Velora') : 'Accesso non effettuato'; await loadHome(); }
    async function loadHome(){ try{ const health=await api('/health'); const guardian=await api('/api/v1/guardian/status'); homeCards.innerHTML=card('API',health.ok?'online':'verifica')+card('Guardian',guardian.status||'protetto')+card('Livelli',guardian.totalLevels||10)+card('Mobile','attivo'); }catch(e){ homeCards.innerHTML=item('Stato',e.message); } }
    async function loadTools(){ try{ const data=await api('/api/v1/tools'); toolList.innerHTML=(data.tools||[]).slice(0,40).map(t=>item(t.name,t.description)).join(''); }catch(e){ toolList.innerHTML=item('Errore',e.message); } }
    function speakTool(){ const text=toolText.value.trim(); if(!text) return setMsg('toolOutput','Inserisci testo','bad'); speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); setMsg('toolOutput','Lettura avviata','ok'); }
    function translateTool(){ const text=toolText.value.trim(); if(!text) return setMsg('toolOutput','Inserisci testo','bad'); setMsg('toolOutput','Traduzione rapida: usa testo breve. Motore locale pronto per frasi semplici; per traduzioni avanzate verra usato il servizio cloud quando configurato.','ok'); }
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
    terms: "Termini"
  }[page] ?? "VELORA";
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
      <h1>Entra in Velora</h1>
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
    <section class="hero">
      <span>VELORA - L'UPPER WEB</span>
      <h1>Sopra Internet, il futuro e ora</h1>
      <p>Sicuro<br>Veloce<br>Semplice<br>Per tutti</p>
      <div><a class="cta" href="/portal">Apri Velora</a><a class="ghost" href="/download">Download avanzati</a></div>
      <strong>Velora non sostituisce Internet<br>Lo eleva</strong>
    </section>
    <section class="cards">
      <article><b>Upper Web</b><p>Zone verificate, ricerca interna e identita Velora.</p></article>
      <article><b>Publisher</b><p>Pubblica siti nativi Velora con SDK e review.</p></article>
      <article><b>Guardian</b><p>Cloud cifrato, multifirma e protezione dati automatica.</p></article>
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
  <header><nav><a href="/">VELORA</a><a href="/portal">Portale</a><a href="/download">Download</a><a href="/what-is-velora">Upper Web</a><a href="/security">Sicurezza</a><a href="/publishers">Publisher</a><a href="/publishers/guide">Guida</a><a href="/developers">Developers</a><a href="/pricing">Pricing</a><a href="/status">Status</a></nav></header>
  <main>${body}</main>
  <footer>Sei pronto per Velora? Non vedo l'ora.</footer>
</body>
</html>`;
}

function routeParam(params: unknown, key: string) {
  return String((params as Record<string, string>)[key]);
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

function publicZonePage(address: string, row: any) {
  const manifest = row?.manifest_json ?? {};
  const title = String(manifest.title ?? row?.address ?? address);
  const description = String(manifest.description ?? "Zona Velora pubblicata");
  const status = row?.release_status ?? row?.zone_status ?? "NON_TROVATA";
  const body = String(row?.body ?? "").trim();
  const found = Boolean(row);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Velora</title>
  <style>body{margin:0;background:linear-gradient(160deg,#071524,#0b2236 62%,#09131d);color:#f6fbff;font-family:ui-serif,Georgia,serif}main{max-width:980px;margin:auto;padding:clamp(22px,5vw,60px)}.card{border:1px solid #35506a;border-radius:28px;background:rgba(13,34,54,.94);padding:clamp(22px,4vw,38px);box-shadow:0 24px 80px rgba(0,0,0,.28)}h1{font-size:clamp(32px,8vw,68px);line-height:.95;margin:8px 0 16px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.pill{border:1px solid #4d6b86;border-radius:999px;padding:8px 11px;color:#dce8f2;background:#07131f}.body{white-space:pre-wrap;line-height:1.62;font-size:18px;color:#eaf3fb;margin-top:22px}button,a{color:#f1d68b}button{border:1px solid #5b7794;border-radius:14px;background:#10283d;padding:12px 16px;font:inherit;cursor:pointer}.auth{margin-top:18px;padding:14px 16px;border-radius:18px;background:#07131f;color:#dce8f2}.notfound{border-color:#8b5b5b;background:#2d1720}</style></head>
  <body><main><div class="card ${found ? "" : "notfound"}"><p>Zona Velora</p><h1>${escapeHtml(found ? title : "Zona non trovata")}</h1><p>${escapeHtml(found ? description : "Questa zona non e ancora pubblicata o indicizzata. Torna al portale e cerca un risultato disponibile.")}</p><div class="meta"><span class="pill">Indirizzo: ${escapeHtml(address)}</span><span class="pill">Stato: ${escapeHtml(String(status))}</span><span class="pill">Release: ${escapeHtml(String(row?.version ?? "non disponibile"))}</span></div>${body ? `<div class="body">${escapeHtml(body.slice(0, 12000))}</div>` : ""}<button data-velora-auth>Accedi con Velora</button><div class="auth" data-velora-auth-state>Accesso Velora non ancora collegato</div><p><a href="/portal">Apri portale Velora</a></p></div></main><script>
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
  return rows.map(([address, title, description]) => ({
    address,
    title,
    description,
    group,
    category: "Velora Tools",
    status: "READY",
    indexed: true
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
