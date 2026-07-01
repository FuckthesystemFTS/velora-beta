import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { SignedAdminCommand, ZoneAvailabilityStatus, ZoneCheckInput, ZoneRequestInput } from "@velora/shared";
import { config } from "./config.js";
import { hashValue, signJsonRecord } from "./crypto.js";
import { requirePool } from "./db.js";

export interface UserRecord {
  id: string;
  username: string;
  password: string;
  licenseKeyLast4?: string;
}

export interface ZoneRequestRecord {
  id: string;
  address: string;
  category: string;
  slug: string;
  requesterUserId: string;
  requestData: ZoneRequestInput;
  status: string;
  reservationExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  peerId: string;
  publicKey: string;
  certificate: Record<string, unknown>;
}

export interface VeloMailAccountRecord {
  id: string;
  userId: string;
  alias: string;
  address: string;
  status: string;
  identityLevel: number;
  createdAt: string;
}

export interface VeloMailMessageRecord {
  id: string;
  messageId: string;
  direction: string;
  folder: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  bodyCiphertext: string;
  bodyPreview: string;
  contentHash: string;
  envelopeSignature: string;
  deliveryStatus: string;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VeloMailSendInput {
  userId: string;
  to: string[];
  subject: string;
  body: string;
  subjectCiphertext?: string;
  bodyCiphertext?: string;
  encryptedByClient?: boolean;
  draft?: boolean;
}

export interface AuthSessionRecord {
  token: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

export interface AdminSessionRecord {
  adminSessionToken: string;
  expiresAt: string;
}

export interface ReleaseRegistrationInput {
  address: string;
  userId: string;
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
}

export interface VeloraRepository {
  createUser(username: string, password: string): Promise<UserRecord>;
  findUserByUsername(username: string): Promise<UserRecord | undefined>;
  findUserById(id: string): Promise<UserRecord | undefined>;
  createAuthSession(userId: string, devicePeerId?: string): Promise<AuthSessionRecord>;
  refreshAuthSession(refreshToken: string): Promise<AuthSessionRecord & { userId: string }>;
  resolveAuthSession(accessToken: string): Promise<UserRecord | undefined>;
  revokeAuthSession(accessToken: string): Promise<{ revoked: boolean }>;
  enrollDevice(input: { userId: string; peerId: string; publicKey: string; deviceName?: string }): Promise<DeviceRecord>;
  setIdentityLevel(userId: string, level: number): Promise<Record<string, unknown>>;
  getOrCreateVeloMailAccount(userId: string, preferredAlias?: string): Promise<VeloMailAccountRecord>;
  getVeloMailAccount(userId: string): Promise<VeloMailAccountRecord | undefined>;
  listVeloMailMessages(userId: string, folder: string): Promise<VeloMailMessageRecord[]>;
  getVeloMailMessage(userId: string, id: string): Promise<VeloMailMessageRecord | undefined>;
  sendVeloMail(input: VeloMailSendInput): Promise<VeloMailMessageRecord>;
  updateVeloMailMessage(userId: string, id: string, action: "read" | "unread" | "archive" | "delete" | "star" | "unstar"): Promise<VeloMailMessageRecord>;
  blockVeloMailSender(userId: string, senderAddress: string): Promise<{ blocked: true; senderAddress: string }>;
  reportVeloMailSpam(userId: string, id: string, reason: string): Promise<{ reported: true }>;
  searchVeloMail(userId: string, query: string): Promise<VeloMailMessageRecord[]>;
  checkZone(input: ZoneCheckInput): Promise<ZoneAvailabilityStatus>;
  createZoneRequest(input: ZoneRequestInput, requesterUserId: string, reservationHours: number): Promise<ZoneRequestRecord>;
  listZoneRequests(): Promise<ZoneRequestRecord[]>;
  assertUserCanPublishToZone(input: { address: string; userId: string; publisherPublicKey: string }): Promise<{ zoneId: string; address: string }>;
  ensureBetaPublisherZone(input: { address: string; userId: string; publisherPublicKey: string }): Promise<{ zoneId: string; address: string }>;
  registerSiteRelease(input: ReleaseRegistrationInput): Promise<Record<string, unknown>>;
  listSiteReleases(address: string): Promise<Array<Record<string, unknown>>>;
  getSiteRelease(address: string, releaseId: string): Promise<Record<string, unknown> | undefined>;
  completeSiteRelease(address: string, releaseId: string): Promise<Record<string, unknown>>;
  failSiteRelease(address: string, releaseId: string, reason: string): Promise<Record<string, unknown>>;
  activateSiteRelease(address: string, releaseId: string, reason: string): Promise<Record<string, unknown>>;
  rollbackSiteRelease(address: string, version: string, reason: string): Promise<Record<string, unknown>>;
  revokeSiteRelease(address: string, releaseId: string, reason: string): Promise<Record<string, unknown>>;
  getContentObject(contentCid: string): Promise<Record<string, unknown> | undefined>;
  getContentChunks(contentCid: string): Promise<Array<Record<string, unknown>>>;
  getContentProviders(contentCid: string): Promise<Array<Record<string, unknown>>>;
  searchDocuments(query: string): Promise<Array<Record<string, unknown>>>;
  approveZoneRequest(id: string, command: SignedAdminCommand): Promise<Record<string, unknown> | null>;
  rejectZoneRequest(id: string, command: SignedAdminCommand, reason: string): Promise<ZoneRequestRecord | null>;
  createAdminChallenge(adminId: string, deviceId: string): Promise<{ challengeId: string; challenge: string; expiresAt: string }>;
  verifyAndConsumeAdminChallenge(challengeId: string): Promise<boolean>;
  createAdminSession(challengeId: string): Promise<AdminSessionRecord>;
  resolveAdminSession(token: string): Promise<{ adminId: string } | undefined>;
  rememberAdminNonce(command: SignedAdminCommand): Promise<boolean>;
  dashboard(): Promise<Record<string, number>>;
}

export class PostgresRepository implements VeloraRepository {
  constructor(private readonly pool: Pool = requirePool()) {}

  async createUser(username: string, password: string) {
    const id = randomUUID();
    await this.pool.query("INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)", [id, username, password]);
    return { id, username, password };
  }

  async findUserByUsername(username: string) {
    const result = await this.pool.query("SELECT id, username, password_hash FROM users WHERE username = $1", [username]);
    return mapUser(result.rows[0]);
  }

  async findUserById(id: string) {
    const result = await this.pool.query("SELECT id, username, password_hash FROM users WHERE id = $1", [id]);
    return mapUser(result.rows[0]);
  }

  async createAuthSession(userId: string, devicePeerId?: string) {
    const token = `vla_${randomUUID()}_${randomUUID()}`;
    const refreshToken = `vlr_${randomUUID()}_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await this.pool.query(
      `INSERT INTO auth_sessions (
        id, user_id, access_token_hash, refresh_token_hash, device_peer_id, expires_at, refresh_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), userId, hashValue(token), hashValue(refreshToken), devicePeerId ?? null, expiresAt, refreshExpiresAt]
    );
    return { token, refreshToken, expiresAt, refreshExpiresAt };
  }

  async refreshAuthSession(refreshToken: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM auth_sessions
         WHERE refresh_token_hash = $1 AND status = 'ACTIVE' AND refresh_expires_at > NOW()
         FOR UPDATE`,
        [hashValue(refreshToken)]
      );
      const row = existing.rows[0];
      if (!row) {
        throw new Error("INVALID_REFRESH_TOKEN");
      }
      await client.query("UPDATE auth_sessions SET status = 'ROTATED' WHERE id = $1", [row.id]);
      const next = await this.createAuthSession(row.user_id, row.device_peer_id ?? undefined);
      await client.query("COMMIT");
      return { ...next, userId: row.user_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveAuthSession(accessToken: string) {
    const result = await this.pool.query(
      `SELECT u.id, u.username, u.password_hash
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.access_token_hash = $1 AND s.status = 'ACTIVE' AND s.expires_at > NOW()`,
      [hashValue(accessToken)]
    );
    if (result.rows[0]) {
      await this.pool.query("UPDATE auth_sessions SET last_seen_at = NOW() WHERE access_token_hash = $1", [hashValue(accessToken)]);
    }
    return mapUser(result.rows[0]);
  }

  async revokeAuthSession(accessToken: string) {
    const result = await this.pool.query("UPDATE auth_sessions SET status = 'REVOKED' WHERE access_token_hash = $1 AND status = 'ACTIVE'", [hashValue(accessToken)]);
    return { revoked: Boolean(result.rowCount) };
  }

  async enrollDevice(input: { userId: string; peerId: string; publicKey: string; deviceName?: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingDevice = await client.query("SELECT id, public_key, status FROM devices WHERE peer_id = $1 FOR UPDATE", [input.peerId]);
      let deviceId = existingDevice.rows[0]?.id as string | undefined;
      if (!deviceId) {
        deviceId = randomUUID();
        await client.query(
          "INSERT INTO devices (id, user_id, device_name, peer_id, public_key, status) VALUES ($1, $2, $3, $4, $5, 'ACTIVE')",
          [deviceId, input.userId, input.deviceName ?? "Velora beta device", input.peerId, input.publicKey]
        );
      } else {
        await client.query("UPDATE devices SET public_key = $1, status = 'ACTIVE', updated_at = NOW() WHERE id = $2", [input.publicKey, deviceId]);
      }

      const linkCount = await client.query(
        "SELECT COUNT(*)::int AS count FROM device_account_links WHERE device_id = $1 AND status = 'ACTIVE' AND user_id <> $2",
        [deviceId, input.userId]
      );
      if (Number(linkCount.rows[0]?.count ?? 0) >= 3) {
        throw new Error("DEVICE_ACCOUNT_LIMIT_REACHED");
      }
      await client.query(
        `INSERT INTO device_account_links (id, device_id, user_id, status)
         VALUES ($1,$2,$3,'ACTIVE')
         ON CONFLICT (device_id, user_id) DO UPDATE SET status = 'ACTIVE', revoked_at = NULL, linked_at = NOW()`,
        [randomUUID(), deviceId, input.userId]
      );

      const certificate = {
        certificate_id: randomUUID(),
        public_key_hash: hashValue(input.publicKey),
        peer_id: input.peerId,
        license_plan: "BETA",
        permissions: ["browse", "request_zone", "publish_owned_zone"],
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        max_devices: 3,
        protocol_version: "1.0.0"
      };
      const signature = signJsonRecord(certificate, config.membershipSigningPrivateKeyBase64);
      const signedCertificate = { ...certificate, signature };

      await client.query(
        "INSERT INTO membership_certificates (id, user_id, device_id, certificate_payload, signature, status, expires_at) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)",
        [certificate.certificate_id, input.userId, deviceId, signedCertificate, signature, certificate.expires_at]
      );
      await client.query("COMMIT");
      return { id: deviceId, userId: input.userId, peerId: input.peerId, publicKey: input.publicKey, certificate: signedCertificate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setIdentityLevel(userId: string, level: number) {
    const normalized = Math.max(0, Math.min(2, Math.trunc(level)));
    const account = await this.getOrCreateVeloMailAccount(userId);
    const result = await this.pool.query(
      "UPDATE velomail_accounts SET identity_level = $1, updated_at = NOW() WHERE id = $2 RETURNING identity_level, address",
      [normalized, account.id]
    );
    return { userId, identityLevel: result.rows[0]?.identity_level ?? normalized, address: result.rows[0]?.address ?? account.address };
  }

  async getOrCreateVeloMailAccount(userId: string, preferredAlias?: string) {
    const existing = await this.getVeloMailAccount(userId);
    if (existing) {
      return existing;
    }

    const user = await this.findUserById(userId);
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const alias = normalizeVeloMailAlias(preferredAlias ?? user.username);
    await this.assertVeloMailAliasAllowed(alias);
    const accountId = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO velomail_accounts (id, user_id, alias, alias_normalized, address, status)
       VALUES ($1,$2,$3,$3,$4,'ACTIVE')
       RETURNING *`,
      [accountId, userId, alias, `${alias}@velora`]
    );
    await this.seedVeloMailWelcome(result.rows[0]);
    return mapVeloMailAccount(result.rows[0]);
  }

  async getVeloMailAccount(userId: string) {
    const result = await this.pool.query("SELECT * FROM velomail_accounts WHERE user_id = $1", [userId]);
    return maybeVeloMailAccount(result.rows[0]);
  }

  async listVeloMailMessages(userId: string, folder: string) {
    const account = await this.getOrCreateVeloMailAccount(userId);
    const result = await this.pool.query(
      `SELECT * FROM velomail_messages
       WHERE account_id = $1 AND folder = $2 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 100`,
      [account.id, normalizeMailFolder(folder)]
    );
    return result.rows.map(mapVeloMailMessage);
  }

  async getVeloMailMessage(userId: string, id: string) {
    const account = await this.getOrCreateVeloMailAccount(userId);
    const result = await this.pool.query("SELECT * FROM velomail_messages WHERE account_id = $1 AND id = $2", [account.id, id]);
    return maybeVeloMailMessage(result.rows[0]);
  }

  async sendVeloMail(input: VeloMailSendInput) {
    const account = await this.getOrCreateVeloMailAccount(input.userId);
    const recipients = input.to.map(normalizeVeloMailAddress);
    if (!recipients.length) {
      throw new Error("RECIPIENT_REQUIRED");
    }
    if (!input.encryptedByClient || !input.bodyCiphertext) {
      throw new Error("VELOMAIL_CLIENT_ENCRYPTION_REQUIRED");
    }
    const contentHash = hashValue(`${account.address}:${recipients.join(",")}:${input.subject}:${input.bodyCiphertext}`);
    const messageId = `velomail:${randomUUID()}`;
    const folder = input.draft ? "DRAFTS" : "SENT";
    const status = input.draft ? "DRAFT" : "DELIVERED_TO_MAILBOX";
    const bodyCiphertext = input.bodyCiphertext;
    const subjectCiphertext = input.subjectCiphertext ?? "";
    const encryptedByClient = true;
    const preview = "Messaggio cifrato";
    const storedSubject = "Messaggio cifrato";
    const encryptionScheme = "CLIENT_SEALED_V1";
    const replicationStatus = input.draft ? "LOCAL_DRAFT" : "STORE_AND_FORWARD_PENDING";

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sent = await client.query(
        `INSERT INTO velomail_messages (
          id, message_id, account_id, direction, folder, sender_address, recipient_addresses,
          subject, subject_ciphertext, body_ciphertext, body_preview, content_hash, envelope_signature,
          delivery_status, is_read, encryption_scheme, replication_status, replica_count, encrypted_by_client
        ) VALUES ($1,$2,$3,'OUTBOUND',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,$17)
        RETURNING *`,
        [randomUUID(), messageId, account.id, folder, account.address, recipients, storedSubject, subjectCiphertext, bodyCiphertext, preview, contentHash, hashValue(`${messageId}:sender:${contentHash}`), status, encryptionScheme, replicationStatus, encryptedByClient ? 1 : 0, encryptedByClient]
      );

      if (!input.draft) {
        for (const recipient of recipients) {
          const target = await client.query("SELECT * FROM velomail_accounts WHERE address = $1 AND status = 'ACTIVE'", [recipient]);
          const targetAccount = target.rows[0];
          if (!targetAccount) {
            continue;
          }
          const blocked = await client.query("SELECT 1 FROM velomail_blocked_senders WHERE account_id = $1 AND sender_address = $2", [targetAccount.id, account.address]);
          if (blocked.rowCount) {
            continue;
          }
          await client.query(
            `INSERT INTO velomail_messages (
              id, message_id, account_id, direction, folder, sender_address, recipient_addresses,
              subject, subject_ciphertext, body_ciphertext, body_preview, content_hash, envelope_signature,
              delivery_status, is_read, encryption_scheme, replication_status, replica_count, encrypted_by_client
            ) VALUES ($1,$2,$3,'INBOUND','INBOX',$4,$5,$6,$7,$8,$9,$10,$11,'DELIVERED_TO_MAILBOX',false,$12,$13,$14,$15)`,
            [randomUUID(), `${messageId}:copy:${targetAccount.id}`, targetAccount.id, account.address, recipients, storedSubject, subjectCiphertext, bodyCiphertext, preview, contentHash, hashValue(`${messageId}:recipient:${targetAccount.id}:${contentHash}`), encryptionScheme, "MAILBOX_DELIVERED", encryptedByClient ? 1 : 0, encryptedByClient]
          );
        }
      }

      await client.query("COMMIT");
      return mapVeloMailMessage(sent.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateVeloMailMessage(userId: string, id: string, action: "read" | "unread" | "archive" | "delete" | "star" | "unstar") {
    const account = await this.getOrCreateVeloMailAccount(userId);
    const updates: Record<typeof action, string> = {
      read: "is_read = true, read_at = NOW()",
      unread: "is_read = false, read_at = NULL",
      archive: "folder = 'ARCHIVE'",
      delete: "folder = 'TRASH', is_deleted = true",
      star: "is_starred = true",
      unstar: "is_starred = false"
    };
    const result = await this.pool.query(
      `UPDATE velomail_messages SET ${updates[action]}, updated_at = NOW() WHERE account_id = $1 AND id = $2 RETURNING *`,
      [account.id, id]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("MESSAGE_NOT_FOUND");
    }
    return mapVeloMailMessage(row);
  }

  async blockVeloMailSender(userId: string, senderAddress: string) {
    const account = await this.getOrCreateVeloMailAccount(userId);
    const normalized = normalizeVeloMailAddress(senderAddress);
    await this.pool.query(
      "INSERT INTO velomail_blocked_senders (id, account_id, sender_address) VALUES ($1,$2,$3) ON CONFLICT (account_id, sender_address) DO NOTHING",
      [randomUUID(), account.id, normalized]
    );
    return { blocked: true as const, senderAddress: normalized };
  }

  async reportVeloMailSpam(userId: string, id: string, reason: string) {
    const account = await this.getOrCreateVeloMailAccount(userId);
    const message = await this.getVeloMailMessage(userId, id);
    if (!message) {
      throw new Error("MESSAGE_NOT_FOUND");
    }
    await this.pool.query(
      "INSERT INTO velomail_abuse_reports (id, account_id, message_id, sender_address, reason) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), account.id, id, message.senderAddress, reason]
    );
    return { reported: true as const };
  }

  async searchVeloMail(userId: string, query: string) {
    const account = await this.getOrCreateVeloMailAccount(userId);
    const normalized = `%${query.toLowerCase()}%`;
    const result = await this.pool.query(
      `SELECT * FROM velomail_messages
       WHERE account_id = $1
         AND is_deleted = false
         AND (lower(sender_address) LIKE $2 OR lower(subject) LIKE $2 OR lower(body_preview) LIKE $2)
       ORDER BY created_at DESC
       LIMIT 50`,
      [account.id, normalized]
    );
    return result.rows.map(mapVeloMailMessage);
  }

  private async assertVeloMailAliasAllowed(alias: string) {
    const reserved = await this.pool.query("SELECT 1 FROM velomail_reserved_aliases WHERE alias = $1", [alias]);
    if (reserved.rowCount) {
      throw new Error("VELOMAIL_ALIAS_RESERVED");
    }
  }

  private async seedVeloMailWelcome(account: any) {
    const body = "Benvenuto in VeloMail. La posta dell'Upper Web usa il tuo account Velora e non richiede una registrazione separata.";
    await this.pool.query(
      `INSERT INTO velomail_messages (
        id, message_id, account_id, direction, folder, sender_address, recipient_addresses,
        subject, subject_ciphertext, body_ciphertext, body_preview, content_hash, envelope_signature,
        delivery_status, is_read, encryption_scheme, replication_status, replica_count, encrypted_by_client
      ) VALUES ($1,$2,$3,'INBOUND','INBOX','updates@velora',$4,$5,$6,$7,$8,$9,$10,'DELIVERED_TO_MAILBOX',false,'LEGACY_CENTRALIZED','CENTRALIZED',0,false)`,
      [
        randomUUID(),
        `system:${randomUUID()}`,
        account.id,
        [account.address],
        "Benvenuto in VeloMail",
        "",
        Buffer.from(body, "utf8").toString("base64"),
        body.slice(0, 140),
        hashValue(body),
        hashValue(`updates@velora:${account.address}:${body}`)
      ]
    );
  }

  async checkZone({ category, slug }: ZoneCheckInput): Promise<ZoneAvailabilityStatus> {
    const reserved = await this.pool.query("SELECT 1 FROM reserved_names WHERE name = $1 AND active = true", [slug]);
    if (reserved.rowCount) {
      return "RESERVED_NAME";
    }

    const address = `${category}.${slug}`;
    const zone = await this.pool.query("SELECT 1 FROM navigation_zones WHERE address = $1 AND status IN ('ACTIVE', 'SUSPENDED')", [address]);
    if (zone.rowCount) {
      return "ASSIGNED";
    }

    const pending = await this.pool.query(
      "SELECT 1 FROM zone_requests WHERE requested_address = $1 AND status IN ('SUBMITTED', 'PENDING_REVIEW', 'MORE_INFO_REQUIRED') AND reservation_expires_at > NOW()",
      [address]
    );
    if (pending.rowCount) {
      return "PENDING_REVIEW";
    }

    return "AVAILABLE";
  }

  async createZoneRequest(input: ZoneRequestInput, requesterUserId: string, reservationHours: number) {
    const id = randomUUID();
    const address = `${input.category}.${input.requestedSlug}`;
    const reservationExpiresAt = new Date(Date.now() + reservationHours * 60 * 60 * 1000).toISOString();
    const result = await this.pool.query(
      `INSERT INTO zone_requests (
        id, requested_address, category, slug, requester_user_id, requester_data_encrypted,
        project_description, business_description, ownership_declaration, content_type,
        age_rating, family_safe, status, automatic_checks_json, reservation_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING_REVIEW',$13,$14)
      RETURNING *`,
      [
        id,
        address,
        input.category,
        input.requestedSlug,
        requesterUserId,
        JSON.stringify(input),
        input.projectDescription,
        input.businessDescription,
        input.ownershipDeclaration,
        input.contentType,
        input.ageRating,
        input.familySafe,
        JSON.stringify({ syntax: "PASS", reservedName: "PASS", availability: "PASS" }),
        reservationExpiresAt
      ]
    );
    return mapZoneRequest(result.rows[0]);
  }

  async listZoneRequests() {
    const result = await this.pool.query("SELECT * FROM zone_requests ORDER BY created_at DESC LIMIT 100");
    return result.rows.map(mapZoneRequest);
  }

  async assertUserCanPublishToZone(input: { address: string; userId: string; publisherPublicKey: string }) {
    const result = await this.pool.query(
      "SELECT id, address, status, owner_user_id, owner_public_key FROM navigation_zones WHERE address = $1",
      [input.address]
    );
    const zone = result.rows[0];
    if (!zone) {
      throw new Error("ZONE_NOT_FOUND");
    }
    if (zone.owner_user_id !== input.userId) {
      throw new Error("ZONE_NOT_OWNED");
    }
    if (zone.status !== "ACTIVE") {
      throw new Error(zone.status === "SUSPENDED" ? "ZONE_SUSPENDED" : "ZONE_NOT_ACTIVE");
    }
    if (zone.owner_public_key !== "PENDING_PUBLISHER_KEY" && zone.owner_public_key !== input.publisherPublicKey) {
      throw new Error("PUBLISHER_KEY_NOT_AUTHORIZED");
    }
    return { zoneId: zone.id, address: zone.address };
  }

  async ensureBetaPublisherZone(input: { address: string; userId: string; publisherPublicKey: string }) {
    const normalizedAddress = input.address.trim().toLowerCase();
    const existing = await this.pool.query("SELECT id, owner_user_id, owner_public_key, status, address FROM navigation_zones WHERE address = $1", [normalizedAddress]);
    const zone = existing.rows[0];
    if (zone) {
      if (zone.owner_user_id !== input.userId) {
        throw new Error("ZONE_NOT_OWNED");
      }
      if (zone.status !== "ACTIVE") {
        throw new Error("ZONE_NOT_ACTIVE");
      }
      if (zone.owner_public_key !== input.publisherPublicKey) {
        await this.pool.query("UPDATE navigation_zones SET owner_public_key = $1, updated_at = NOW() WHERE id = $2", [input.publisherPublicKey, zone.id]);
      }
      return { zoneId: zone.id, address: zone.address };
    }

    const [category, ...slugParts] = normalizedAddress.split(".");
    const slug = slugParts.join(".");
    if (!category || !slug || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(category) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      throw new Error("INVALID_ZONE_ADDRESS");
    }

    const zoneId = randomUUID();
    const payload = {
      version: 1,
      address: normalizedAddress,
      category,
      slug,
      owner_user_id: input.userId,
      beta_auto_created: true,
      approved_at: new Date().toISOString()
    };
    const signature = signJsonRecordForBeta(payload, config.zoneRegistrySigningPrivateKeyBase64);
    await this.pool.query(
      `INSERT INTO navigation_zones (
        id, address, category, slug, owner_user_id, owner_public_key, status, record_payload, platform_signature
      ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8)`,
      [zoneId, normalizedAddress, category, slug, input.userId, input.publisherPublicKey, payload, signature]
    );
    return { zoneId, address: normalizedAddress };
  }

  async registerSiteRelease(input: ReleaseRegistrationInput) {
    const zone = await this.assertUserCanPublishToZone({
      address: input.address,
      userId: input.userId,
      publisherPublicKey: input.publisherPublicKey
    });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const duplicate = await client.query("SELECT 1 FROM site_releases WHERE zone_id = $1 AND version = $2", [zone.zoneId, input.version]);
      if (duplicate.rowCount) {
        throw new Error("RELEASE_VERSION_CONFLICT");
      }

      const releaseId = randomUUID();
      await client.query(
        `INSERT INTO site_releases (
          id, zone_id, version, content_cid, manifest_json, manifest_hash, package_hash,
          publisher_public_key, publisher_signature, total_size, file_count, status, published_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',NOW())`,
        [
          releaseId,
          zone.zoneId,
          input.version,
          input.contentCid,
          input.manifestJson,
          input.manifestHash,
          input.packageHash,
          input.publisherPublicKey,
          input.publisherSignature,
          input.totalSize,
          input.fileCount
        ]
      );

      for (const file of input.files) {
        await client.query(
          "INSERT INTO site_release_files (id, release_id, relative_path, size_bytes, file_hash) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), releaseId, file.path, file.size, file.hash]
        );
      }

      await client.query(
        "UPDATE navigation_zones SET owner_public_key = $1, current_release_id = $2, updated_at = NOW(), record_payload = jsonb_set(record_payload, '{releaseVersion}', to_jsonb($3::text), true) WHERE id = $4",
        [input.publisherPublicKey, releaseId, input.version, zone.zoneId]
      );

      if (input.packagePath) {
        await client.query(
          "INSERT INTO content_objects (id, content_cid, package_hash, local_path, total_size, file_count, pinned) VALUES ($1,$2,$3,$4,$5,$6,true)",
          [randomUUID(), input.contentCid, input.packageHash, input.packagePath, input.totalSize, input.fileCount]
        );
      }

      for (const chunk of input.chunks ?? []) {
        await client.query(
          "INSERT INTO content_chunks (id, content_cid, chunk_index, chunk_hash, chunk_size, local_path, verified) VALUES ($1,$2,$3,$4,$5,$6,true)",
          [randomUUID(), input.contentCid, chunk.chunkIndex, chunk.chunkHash, chunk.chunkSize, chunk.localPath]
        );
      }

      await client.query(
        "INSERT INTO content_providers (id, content_cid, peer_id, status) VALUES ($1,$2,$3,'ACTIVE') ON CONFLICT (content_cid, peer_id) DO NOTHING",
        [randomUUID(), input.contentCid, `local-publisher:${input.userId}`]
      );

      await client.query(
        `INSERT INTO search_documents (
          id, zone_id, release_id, address, category, slug, title, description, keywords,
          languages, headings, searchable_text, publisher, age_rating, family_safe,
          content_cid, release_version, trust_level, availability
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,50,1)`,
        [
          randomUUID(),
          zone.zoneId,
          releaseId,
          input.address,
          String(input.manifestJson.category ?? ""),
          String(input.address.split(".")[1] ?? ""),
          String(input.manifestJson.title ?? ""),
          String(input.manifestJson.description ?? ""),
          JSON.stringify(input.manifestJson.keywords ?? []),
          JSON.stringify(input.manifestJson.languages ?? []),
          JSON.stringify([input.manifestJson.title ?? ""]),
          [input.manifestJson.title, input.manifestJson.description, ...(Array.isArray(input.manifestJson.keywords) ? input.manifestJson.keywords : [])].join(" "),
          input.publisherPublicKey,
          String(input.manifestJson.ageRating ?? "EVERYONE"),
          Boolean(input.manifestJson.familySafe ?? true),
          input.contentCid,
          input.version
        ]
      );

      await client.query(
        "INSERT INTO release_events (id, release_id, event_type, payload, signature) VALUES ($1,$2,'RELEASE_ACTIVATED',$3,$4)",
        [randomUUID(), releaseId, { address: input.address, version: input.version, contentCid: input.contentCid }, input.publisherSignature]
      );
      await client.query("COMMIT");
      return { releaseId, address: input.address, version: input.version, contentCid: input.contentCid, status: "ACTIVE" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSiteReleases(address: string) {
    const result = await this.pool.query(
      `SELECT sr.id, sr.version, sr.content_cid, sr.status, sr.total_size, sr.file_count, sr.created_at, sr.published_at
       FROM site_releases sr
       JOIN navigation_zones nz ON nz.id = sr.zone_id
       WHERE nz.address = $1
       ORDER BY sr.created_at DESC`,
      [address]
    );
    return result.rows;
  }

  async getSiteRelease(address: string, releaseId: string) {
    const result = await this.pool.query(
      `SELECT sr.id, sr.version, sr.content_cid, sr.status, sr.total_size, sr.file_count, sr.created_at, sr.published_at, sr.revoked_at, sr.failed_at
       FROM site_releases sr
       JOIN navigation_zones nz ON nz.id = sr.zone_id
       WHERE nz.address = $1 AND sr.id = $2`,
      [address, releaseId]
    );
    return result.rows[0];
  }

  async completeSiteRelease(address: string, releaseId: string) {
    const result = await this.pool.query(
      `UPDATE site_releases sr
       SET status = 'ACTIVE', published_at = COALESCE(published_at, NOW())
       FROM navigation_zones nz
       WHERE sr.zone_id = nz.id AND nz.address = $1 AND sr.id = $2
       RETURNING sr.id, sr.version, sr.content_cid, sr.status`,
      [address, releaseId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("RELEASE_NOT_FOUND");
    }
    await this.pool.query(
      "INSERT INTO release_events (id, release_id, event_type, payload, signature) VALUES ($1,$2,'RELEASE_COMPLETED',$3,$4)",
      [randomUUID(), releaseId, { address, version: row.version }, hashValue(`${address}:${releaseId}:complete`)]
    );
    return { releaseId: row.id, address, version: row.version, contentCid: row.content_cid, status: row.status };
  }

  async failSiteRelease(address: string, releaseId: string, reason: string) {
    const result = await this.pool.query(
      `UPDATE site_releases sr
       SET status = 'FAILED', failed_at = NOW()
       FROM navigation_zones nz
       WHERE sr.zone_id = nz.id AND nz.address = $1 AND sr.id = $2
       RETURNING sr.id, sr.version, sr.content_cid, sr.status`,
      [address, releaseId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("RELEASE_NOT_FOUND");
    }
    await this.pool.query(
      "INSERT INTO release_events (id, release_id, event_type, payload, signature) VALUES ($1,$2,'RELEASE_FAILED',$3,$4)",
      [randomUUID(), releaseId, { address, version: row.version, reason }, hashValue(`${address}:${releaseId}:${reason}:fail`)]
    );
    return { releaseId: row.id, address, version: row.version, contentCid: row.content_cid, status: row.status, reason };
  }

  async activateSiteRelease(address: string, releaseId: string, reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const release = await client.query(
        `SELECT sr.id, sr.zone_id, sr.version, sr.content_cid
         FROM site_releases sr
         JOIN navigation_zones nz ON nz.id = sr.zone_id
         WHERE nz.address = $1 AND sr.id = $2`,
        [address, releaseId]
      );
      const row = release.rows[0];
      if (!row) {
        throw new Error("RELEASE_NOT_FOUND");
      }
      await client.query("UPDATE site_releases SET status = 'INACTIVE' WHERE zone_id = $1 AND id <> $2 AND status = 'ACTIVE'", [row.zone_id, row.id]);
      await client.query("UPDATE site_releases SET status = 'ACTIVE', published_at = COALESCE(published_at, NOW()) WHERE id = $1", [row.id]);
      await client.query("UPDATE navigation_zones SET current_release_id = $1, updated_at = NOW() WHERE id = $2", [row.id, row.zone_id]);
      await client.query(
        "INSERT INTO release_events (id, release_id, event_type, payload, signature) VALUES ($1,$2,'RELEASE_ACTIVATED',$3,$4)",
        [randomUUID(), row.id, { address, version: row.version, reason }, hashValue(`${address}:${releaseId}:${reason}:activate`)]
      );
      await client.query("COMMIT");
      return { releaseId: row.id, address, version: row.version, contentCid: row.content_cid, status: "ACTIVE" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackSiteRelease(address: string, version: string, reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const release = await client.query(
        `SELECT sr.id, sr.zone_id, sr.content_cid FROM site_releases sr
         JOIN navigation_zones nz ON nz.id = sr.zone_id
         WHERE nz.address = $1 AND sr.version = $2`,
        [address, version]
      );
      const row = release.rows[0];
      if (!row) {
        throw new Error("RELEASE_NOT_FOUND");
      }
      const current = await client.query("SELECT current_release_id FROM navigation_zones WHERE id = $1", [row.zone_id]);
      const currentReleaseId = current.rows[0]?.current_release_id as string | undefined;
      if (currentReleaseId && currentReleaseId !== row.id) {
        await client.query("UPDATE site_releases SET rolled_back_at = NOW(), status = 'ROLLED_BACK' WHERE id = $1", [currentReleaseId]);
      }
      await client.query("UPDATE site_releases SET status = 'ACTIVE', rolled_back_at = NULL, published_at = COALESCE(published_at, NOW()) WHERE id = $1", [row.id]);
      await client.query("UPDATE navigation_zones SET current_release_id = $1, updated_at = NOW() WHERE id = $2", [row.id, row.zone_id]);
      await client.query(
        "INSERT INTO release_events (id, release_id, event_type, payload, signature) VALUES ($1,$2,'ROLLBACK',$3,$4)",
        [randomUUID(), row.id, { address, version, reason }, hashValue(`${address}:${version}:${reason}`)]
      );
      await client.query("COMMIT");
      return { releaseId: row.id, address, version, contentCid: row.content_cid, status: "ACTIVE" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSiteRelease(address: string, releaseId: string, reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE site_releases sr
         SET revoked_at = NOW(), status = 'REVOKED'
         FROM navigation_zones nz
         WHERE sr.zone_id = nz.id AND nz.address = $1 AND sr.id = $2
         RETURNING sr.id, sr.version, sr.zone_id`,
        [address, releaseId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("RELEASE_NOT_FOUND");
      }
      await client.query(
        `UPDATE navigation_zones
         SET current_release_id = CASE WHEN current_release_id = $1 THEN NULL ELSE current_release_id END,
             updated_at = NOW()
         WHERE id = $2`,
        [releaseId, row.zone_id]
      );
      await client.query(
        "INSERT INTO release_events (id, release_id, event_type, payload, signature) VALUES ($1,$2,'REVOKE',$3,$4)",
        [randomUUID(), releaseId, { address, reason }, hashValue(`${address}:${releaseId}:${reason}`)]
      );
      await client.query("COMMIT");
      return { address, releaseId, version: row.version, status: "REVOKED" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getContentObject(contentCid: string) {
    const result = await this.pool.query("SELECT * FROM content_objects WHERE content_cid = $1", [contentCid]);
    return result.rows[0];
  }

  async getContentChunks(contentCid: string) {
    const result = await this.pool.query(
      "SELECT chunk_index, chunk_hash, chunk_size, local_path, verified FROM content_chunks WHERE content_cid = $1 ORDER BY chunk_index ASC",
      [contentCid]
    );
    return result.rows;
  }

  async getContentProviders(contentCid: string) {
    const result = await this.pool.query("SELECT peer_id, status, created_at FROM content_providers WHERE content_cid = $1 ORDER BY created_at ASC", [contentCid]);
    return result.rows;
  }

  async searchDocuments(query: string) {
    const normalized = `%${query.toLowerCase()}%`;
    const result = await this.pool.query(
      `SELECT address, category, slug, title, description, content_cid, release_version, availability
       FROM search_documents
       WHERE lower(address) LIKE $1
          OR lower(title) LIKE $1
          OR lower(description) LIKE $1
          OR lower(searchable_text) LIKE $1
       ORDER BY
         CASE WHEN lower(address) = $2 THEN 0 ELSE 1 END,
         CASE WHEN lower(category) = ANY($3::text[]) THEN 0 ELSE 1 END,
         availability DESC,
         updated_at DESC
       LIMIT 25`,
      [normalized, query.toLowerCase(), query.toLowerCase().split(/\s+/)]
    );
    return result.rows;
  }

  async approveZoneRequest(id: string, command: SignedAdminCommand) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query("SELECT * FROM zone_requests WHERE id = $1 FOR UPDATE", [id]);
      const request = requestResult.rows[0];
      if (!request) {
        await client.query("ROLLBACK");
        return null;
      }

      const recordPayload = {
        version: 1,
        address: request.requested_address,
        category: request.category,
        slug: request.slug,
        owner_user_id: request.requester_user_id,
        request_id: id,
        approved_by: command.adminId,
        approved_at: new Date().toISOString()
      };
      const platformSignature = signJsonRecord(recordPayload, config.zoneRegistrySigningPrivateKeyBase64);
      const zoneId = randomUUID();

      await client.query(
        `INSERT INTO navigation_zones (
          id, address, category, slug, owner_user_id, owner_public_key, status,
          record_payload, platform_signature
        ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8)`,
        [zoneId, request.requested_address, request.category, request.slug, request.requester_user_id, "PENDING_PUBLISHER_KEY", recordPayload, platformSignature]
      );
      await client.query("UPDATE zone_requests SET status = 'APPROVED', reviewed_at = NOW(), reviewed_by = $1, updated_at = NOW() WHERE id = $2", [
        command.adminId,
        id
      ]);
      await appendAudit(client, command.adminId, "APPROVE_ZONE_REQUEST", "ZONE_REQUEST", id, "SIGNED_APPROVAL");
      await client.query("COMMIT");
      return { id: zoneId, ...recordPayload, platform_signature: platformSignature };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectZoneRequest(id: string, command: SignedAdminCommand, reason: string) {
    const result = await this.pool.query(
      "UPDATE zone_requests SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = $1, decision_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
      [command.adminId, reason, id]
    );
    if (!result.rows[0]) {
      return null;
    }
    await appendAudit(this.pool, command.adminId, "REJECT_ZONE_REQUEST", "ZONE_REQUEST", id, reason);
    return mapZoneRequest(result.rows[0]);
  }

  async createAdminChallenge(adminId: string, deviceId: string) {
    const challengeId = randomUUID();
    const challenge = randomUUID() + "." + randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await this.pool.query(
      "INSERT INTO admin_challenges (id, admin_id, device_id, challenge, expires_at) VALUES ($1,$2,$3,$4,$5)",
      [challengeId, adminId, deviceId, challenge, expiresAt]
    );
    return { challengeId, challenge, expiresAt };
  }

  async verifyAndConsumeAdminChallenge(challengeId: string) {
    const result = await this.pool.query(
      "UPDATE admin_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING id",
      [challengeId]
    );
    return Boolean(result.rowCount);
  }

  async createAdminSession(challengeId: string) {
    const challenge = await this.pool.query("SELECT admin_id FROM admin_challenges WHERE id = $1 AND consumed_at IS NOT NULL", [challengeId]);
    const adminId = challenge.rows[0]?.admin_id;
    if (!adminId) {
      throw new Error("ADMIN_CHALLENGE_NOT_CONSUMED");
    }
    const admin = await this.pool.query("SELECT id FROM admin_accounts WHERE id = $1 AND status = 'ACTIVE'", [adminId]);
    if (!admin.rows[0]) {
      throw new Error("ADMIN_NOT_ACTIVE");
    }
    const adminSessionToken = `vla_admin_${randomUUID()}_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + config.adminSessionMinutes * 60 * 1000).toISOString();
    await this.pool.query(
      "INSERT INTO admin_sessions (id, admin_id, session_token_hash, challenge_id, expires_at) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), adminId, hashValue(adminSessionToken), challengeId, expiresAt]
    );
    return { adminSessionToken, expiresAt };
  }

  async resolveAdminSession(token: string) {
    const result = await this.pool.query(
      "SELECT admin_id FROM admin_sessions WHERE session_token_hash = $1 AND status = 'ACTIVE' AND expires_at > NOW()",
      [hashValue(token)]
    );
    if (result.rows[0]) {
      await this.pool.query("UPDATE admin_sessions SET last_seen_at = NOW() WHERE session_token_hash = $1", [hashValue(token)]);
    }
    return result.rows[0] ? { adminId: String(result.rows[0].admin_id) } : undefined;
  }

  async rememberAdminNonce(command: SignedAdminCommand) {
    try {
      await this.pool.query(
        "INSERT INTO admin_command_nonces (nonce, command_id, admin_id, expires_at) VALUES ($1,$2,$3,$4)",
        [command.nonce, command.commandId, command.adminId, command.expiresAt]
      );
      return true;
    } catch {
      return false;
    }
  }

  async dashboard() {
    const [users, pending, zones, audits] = await Promise.all([
      this.pool.query("SELECT COUNT(*)::int AS count FROM users"),
      this.pool.query("SELECT COUNT(*)::int AS count FROM zone_requests WHERE status = 'PENDING_REVIEW'"),
      this.pool.query("SELECT COUNT(*)::int AS count FROM navigation_zones WHERE status = 'ACTIVE'"),
      this.pool.query("SELECT COUNT(*)::int AS count FROM audit_logs")
    ]);
    return {
      users: users.rows[0].count,
      pendingZoneRequests: pending.rows[0].count,
      activeZones: zones.rows[0].count,
      auditEntries: audits.rows[0].count
    };
  }
}

async function appendAudit(client: Pick<Pool | PoolClient, "query">, adminId: string, action: string, targetType: string, targetId: string, reason: string) {
  const previous = await client.query("SELECT entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1");
  const previousHash = previous.rows[0]?.entry_hash ?? "GENESIS";
  const payload = { adminId, action, targetType, targetId, reason, previousHash, createdAt: new Date().toISOString() };
  const entryHash = hashValue(JSON.stringify(payload));
  await client.query(
    "INSERT INTO audit_logs (id, admin_id, action, target_type, target_id, reason, previous_hash, entry_hash, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [randomUUID(), adminId, action, targetType, targetId, reason, previousHash, entryHash, payload]
  );
}

function mapUser(row: any): UserRecord | undefined {
  if (!row) {
    return undefined;
  }
  return { id: row.id, username: row.username, password: row.password_hash };
}

function mapZoneRequest(row: any): ZoneRequestRecord {
  return {
    id: row.id,
    address: row.requested_address,
    category: row.category,
    slug: row.slug,
    requesterUserId: row.requester_user_id,
    requestData: typeof row.requester_data_encrypted === "string" ? JSON.parse(row.requester_data_encrypted) : row.requester_data_encrypted,
    status: row.status,
    reservationExpiresAt: new Date(row.reservation_expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function mapVeloMailAccount(row: any): VeloMailAccountRecord {
  if (!row) {
    throw new Error("VELOMAIL_ACCOUNT_NOT_FOUND");
  }
  return {
    id: row.id,
    userId: row.user_id,
    alias: row.alias,
    address: row.address,
    status: row.status,
    identityLevel: Number(row.identity_level ?? 0),
    createdAt: new Date(row.created_at).toISOString()
  };
}

function mapVeloMailMessage(row: any): VeloMailMessageRecord {
  if (!row) {
    throw new Error("MESSAGE_NOT_FOUND");
  }
  return {
    id: row.id,
    messageId: row.message_id,
    direction: row.direction,
    folder: row.folder,
    senderAddress: row.sender_address,
    recipientAddresses: row.recipient_addresses ?? [],
    subject: row.subject,
    bodyCiphertext: row.body_ciphertext,
    bodyPreview: row.body_preview,
    contentHash: row.content_hash,
    envelopeSignature: row.envelope_signature,
    deliveryStatus: row.delivery_status,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function maybeVeloMailAccount(row: any): VeloMailAccountRecord | undefined {
  return row ? mapVeloMailAccount(row) : undefined;
}

function maybeVeloMailMessage(row: any): VeloMailMessageRecord | undefined {
  return row ? mapVeloMailMessage(row) : undefined;
}

function normalizeVeloMailAlias(alias: string) {
  const normalized = alias.trim().toLowerCase().normalize("NFKC").replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{2,30}$/.test(normalized)) {
    throw new Error("VELOMAIL_ALIAS_INVALID");
  }
  return normalized;
}

function normalizeVeloMailAddress(address: string) {
  const normalized = address.trim().toLowerCase().normalize("NFKC");
  if (!/^[a-z0-9][a-z0-9._-]{2,30}@velora$/.test(normalized)) {
    throw new Error("VELOMAIL_ADDRESS_INVALID");
  }
  return normalized;
}

function normalizeMailFolder(folder: string) {
  const normalized = folder.trim().toUpperCase().replace(/\s+/g, "_");
  const allowed = new Set(["INBOX", "SENT", "DRAFTS", "STARRED", "ARCHIVE", "SPAM", "TRASH", "OUTBOX"]);
  return allowed.has(normalized) ? normalized : "INBOX";
}

function signJsonRecordForBeta(payload: Record<string, unknown>, privateKeyBase64: string) {
  try {
    return signJsonRecord(payload, privateKeyBase64);
  } catch {
    return `beta-signature:${hashValue(JSON.stringify(payload))}`;
  }
}

export const repository = new PostgresRepository();
