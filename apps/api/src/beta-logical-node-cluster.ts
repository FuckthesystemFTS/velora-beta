import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { config } from "./config.js";
import { requirePool } from "./db.js";

export type BetaNodeStatus = "STARTING" | "ONLINE" | "DEGRADED" | "RECOVERING" | "DRAINING" | "OFFLINE" | "SUSPENDED" | "FAILED";
export type BetaClusterStatus = "FULLY_OPERATIONAL" | "OPERATIONAL_DEGRADED" | "CRITICAL" | "UNAVAILABLE" | "SLEEP_RISK";
export type BetaReplicaStatus = "PENDING" | "REPLICATING" | "FULLY_REPLICATED" | "DEGRADED" | "REPAIRING" | "CORRUPTED" | "REVOKED" | "EXPIRED";

const nodeNames = ["velora-beta-node-1", "velora-beta-node-2", "velora-beta-node-3"] as const;

export interface NodeStorageProvider {
  storeObject(input: { cid?: string; objectType: string; objectReference: string; payload: Record<string, unknown> }): Promise<{ cid: string; objectHash: string; quorum: number; status: BetaReplicaStatus }>;
  repairObject(cid: string): Promise<{ repaired: number; quorum: number; status: BetaReplicaStatus }>;
}

class PostgresLogicalNodeStorage implements NodeStorageProvider {
  constructor(private readonly pool: Pool) {}

  async storeObject(input: { cid?: string; objectType: string; objectReference: string; payload: Record<string, unknown> }) {
    const payloadText = stableJson(input.payload);
    const objectHash = sha256(payloadText);
    const cid = input.cid ?? `sha256:v1:${objectHash}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO beta_node_payloads (cid, object_type, object_reference, object_hash, object_size, payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (cid) DO UPDATE SET object_hash = EXCLUDED.object_hash, updated_at = NOW()`,
        [cid, input.objectType, input.objectReference, objectHash, Buffer.byteLength(payloadText), input.payload]
      );

      const nodes = await client.query("SELECT id, status FROM beta_logical_nodes ORDER BY name");
      let confirmations = 0;
      for (const node of nodes.rows) {
        const status: BetaReplicaStatus = ["ONLINE", "DEGRADED", "RECOVERING"].includes(node.status) ? "FULLY_REPLICATED" : "DEGRADED";
        if (status === "FULLY_REPLICATED") {
          confirmations += 1;
        }
        await client.query(
          `INSERT INTO beta_node_objects (
            node_id, cid, object_type, object_reference, object_hash, replica_status, acknowledged_at, last_verified_at
          ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
          ON CONFLICT (node_id, cid) DO UPDATE SET
            replica_status = EXCLUDED.replica_status,
            object_hash = EXCLUDED.object_hash,
            acknowledged_at = EXCLUDED.acknowledged_at,
            last_verified_at = EXCLUDED.last_verified_at,
            updated_at = NOW()`,
          [node.id, cid, input.objectType, input.objectReference, objectHash, status]
        );
      }
      await client.query("COMMIT");
      const status: BetaReplicaStatus = confirmations >= config.betaNodeQuorum ? "FULLY_REPLICATED" : "DEGRADED";
      return { cid, objectHash, quorum: confirmations, status };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async repairObject(cid: string) {
    const payload = await this.pool.query("SELECT object_type, object_reference, object_hash, payload FROM beta_node_payloads WHERE cid = $1 AND revoked_at IS NULL", [cid]);
    const row = payload.rows[0];
    if (!row) {
      return { repaired: 0, quorum: 0, status: "CORRUPTED" as BetaReplicaStatus };
    }
    const actualHash = sha256(stableJson(row.payload));
    if (actualHash !== row.object_hash) {
      await this.pool.query("UPDATE beta_node_objects SET replica_status = 'CORRUPTED', updated_at = NOW() WHERE cid = $1", [cid]);
      return { repaired: 0, quorum: 0, status: "CORRUPTED" as BetaReplicaStatus };
    }
    const nodes = await this.pool.query("SELECT id, status FROM beta_logical_nodes ORDER BY name");
    let repaired = 0;
    let quorum = 0;
    for (const node of nodes.rows) {
      const status: BetaReplicaStatus = ["ONLINE", "DEGRADED", "RECOVERING"].includes(node.status) ? "FULLY_REPLICATED" : "DEGRADED";
      if (status === "FULLY_REPLICATED") {
        quorum += 1;
      }
      const result = await this.pool.query(
        `INSERT INTO beta_node_objects (
          node_id, cid, object_type, object_reference, object_hash, replica_status, acknowledged_at, last_verified_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
        ON CONFLICT (node_id, cid) DO UPDATE SET replica_status = EXCLUDED.replica_status, last_verified_at = NOW(), updated_at = NOW()
        RETURNING node_id`,
        [node.id, cid, row.object_type, row.object_reference, row.object_hash, status]
      );
      repaired += Number(result.rowCount ?? 0);
    }
    const status: BetaReplicaStatus = quorum >= config.betaNodeQuorum ? "FULLY_REPLICATED" : "DEGRADED";
    return { repaired, quorum, status };
  }
}

class MemoryNodeStorage implements NodeStorageProvider {
  private readonly objects = new Map<string, Record<string, unknown>>();

  async storeObject(input: { cid?: string; objectType: string; objectReference: string; payload: Record<string, unknown> }) {
    const payloadText = stableJson(input.payload);
    const objectHash = sha256(payloadText);
    const cid = input.cid ?? `sha256:v1:${objectHash}`;
    this.objects.set(cid, input.payload);
    return { cid, objectHash, quorum: 3, status: "FULLY_REPLICATED" as BetaReplicaStatus };
  }

  async repairObject(cid: string) {
    return { repaired: this.objects.has(cid) ? 3 : 0, quorum: this.objects.has(cid) ? 3 : 0, status: this.objects.has(cid) ? "FULLY_REPLICATED" as BetaReplicaStatus : "CORRUPTED" as BetaReplicaStatus };
  }
}

export class BetaLogicalNodeCluster {
  private readonly pool = requirePool();
  private readonly ownerId = `api-${process.pid}-${randomUUID()}`;
  private readonly storage = new PostgresLogicalNodeStorage(this.pool);
  private supervisorTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private repairTimer?: NodeJS.Timeout;
  private leaseRetryTimer?: NodeJS.Timeout;
  private active = false;

  constructor(private readonly logger?: FastifyBaseLogger) {}

  async start() {
    if (!config.betaNodeClusterEnabled || this.active) {
      return;
    }
    await this.ensureSchemaReady();
    await this.ensureNodeIdentities();
    const ownsLease = await this.acquireLease();
    if (!ownsLease) {
      await this.recordEvent(null, "COORDINATOR_PASSIVE", "INFO", {});
      this.leaseRetryTimer = setInterval(() => void this.safeRun("lease-retry", () => this.promoteIfLeaseAvailable()), Math.max(5000, config.betaNodeHeartbeatSeconds * 1000));
      return;
    }
    await this.startCoordinatorTasks();
  }

  async stop() {
    this.active = false;
    for (const timer of [this.heartbeatTimer, this.supervisorTimer, this.repairTimer, this.leaseRetryTimer]) {
      if (timer) {
        clearInterval(timer);
      }
    }
    await this.pool.query("UPDATE beta_cluster_leases SET expires_at = NOW() WHERE lease_key = 'beta-logical-node-cluster' AND owner_id = $1", [this.ownerId]);
  }

  async status() {
    await this.ensureSchemaReady();
    const nodes = await this.pool.query(
      `SELECT id, name, role, public_key, status, protocol_version, capabilities, inventory_digest,
              monotonic_counter, started_at, last_heartbeat_at, last_error_code, restart_count, created_at, updated_at
       FROM beta_logical_nodes ORDER BY name`
    );
    const now = Date.now();
    const onlineCount = nodes.rows.filter((node) => isNodeFresh(node.status, node.last_heartbeat_at, now)).length;
    const queue = await this.pool.query("SELECT COUNT(*)::int AS count FROM beta_replication_jobs WHERE status IN ('PENDING','RETRYING','REPAIRING')");
    const leader = await this.pool.query("SELECT owner_id, expires_at FROM beta_cluster_leases WHERE lease_key = 'beta-logical-node-cluster' AND expires_at > NOW()");
    const clusterStatus = deriveClusterStatus(onlineCount);
    return {
      enabled: config.betaNodeClusterEnabled,
      role: "LOGICAL_BETA_NODE_CLUSTER",
      status: config.betaNodeHerokuPlan.toLowerCase().includes("eco") ? "SLEEP_RISK" : clusterStatus,
      operationalStatus: clusterStatus,
      sleepRisk: config.betaNodeHerokuPlan.toLowerCase().includes("eco"),
      herokuPlan: config.betaNodeHerokuPlan,
      quorum: { required: config.betaNodeQuorum, online: onlineCount, desiredReplicas: config.betaNodeCount, satisfied: onlineCount >= config.betaNodeQuorum },
      leader: { active: Boolean(leader.rows[0]), isCurrentProcess: leader.rows[0]?.owner_id === this.ownerId, leaseExpiresAt: leader.rows[0]?.expires_at ?? null },
      replicationQueue: Number(queue.rows[0]?.count ?? 0),
      nodes: nodes.rows.map((node) => ({
        id: node.id,
        name: node.name,
        role: node.role,
        publicKey: node.public_key,
        status: node.status,
        effectiveOnline: isNodeFresh(node.status, node.last_heartbeat_at, now),
        protocolVersion: node.protocol_version,
        capabilities: node.capabilities,
        inventoryDigest: node.inventory_digest,
        monotonicCounter: Number(node.monotonic_counter ?? 0),
        startedAt: node.started_at,
        lastHeartbeatAt: node.last_heartbeat_at,
        lastErrorCode: node.last_error_code,
        restartCount: Number(node.restart_count ?? 0),
        createdAt: node.created_at,
        updatedAt: node.updated_at
      }))
    };
  }

  async publicStatus() {
    const state = await this.status();
    const publicState =
      state.operationalStatus === "FULLY_OPERATIONAL" ? "rete operativa" :
      state.operationalStatus === "OPERATIONAL_DEGRADED" ? "capacita ridotta" :
      state.operationalStatus === "CRITICAL" ? "rete critica" :
      "temporaneamente non disponibile";
    return { ok: state.quorum.satisfied, service: "velora-api", network: publicState, quorum: state.quorum, sleepRisk: state.sleepRisk };
  }

  async storePublishedObject(input: { cid: string; address: string; releaseId: string; version: string; manifestHash: string; packageHash: string }) {
    await this.ensureSchemaReady();
    await this.ensureNodeIdentities();
    return this.storage.storeObject({
      cid: input.cid,
      objectType: "SITE_RELEASE",
      objectReference: `${input.address}:${input.releaseId}`,
      payload: input
    });
  }

  async restartNode(id: string) {
    return this.changeNodeStatus(id, "RECOVERING", "ADMIN_RESTART");
  }

  async suspendNode(id: string) {
    return this.changeNodeStatus(id, "SUSPENDED", "ADMIN_SUSPEND");
  }

  async resumeNode(id: string) {
    return this.changeNodeStatus(id, "RECOVERING", "ADMIN_RESUME");
  }

  async reconcileNode(id?: string) {
    await this.reconcile(id);
    return this.status();
  }

  async repairAll() {
    const payloads = await this.pool.query("SELECT cid FROM beta_node_payloads WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 100");
    let repaired = 0;
    for (const row of payloads.rows) {
      repaired += (await this.storage.repairObject(row.cid)).repaired;
    }
    await this.recordEvent(null, "REPAIR_ALL", "INFO", { repaired });
    return { repaired, status: await this.status() };
  }

  async testFailover() {
    const first = await this.pool.query("SELECT id FROM beta_logical_nodes WHERE status <> 'SUSPENDED' ORDER BY name LIMIT 1");
    const nodeId = first.rows[0]?.id as string | undefined;
    if (!nodeId) {
      return { ok: false, reason: "NO_NODE_AVAILABLE", status: await this.status() };
    }
    await this.suspendNode(nodeId);
    const degraded = await this.status();
    await this.resumeNode(nodeId);
    await this.reconcile(nodeId);
    return { ok: degraded.quorum.satisfied, suspendedNodeId: nodeId, degraded, recovered: await this.status() };
  }

  private async ensureSchemaReady() {
    await this.pool.query("SELECT 1 FROM beta_logical_nodes LIMIT 1");
  }

  private async ensureNodeIdentities() {
    for (const name of nodeNames.slice(0, config.betaNodeCount)) {
      const keySeed = hmac(`${name}:private`);
      const publicKey = `ed25519-beta:${hmac(`${name}:public`).slice(0, 64)}`;
      const id = `sha256:v1:${sha256(publicKey).slice(0, 32)}`;
      await this.pool.query(
        `INSERT INTO beta_logical_nodes (
          id, name, role, public_key, encrypted_private_key_reference, status, capabilities
        ) VALUES ($1,$2,'LOGICAL_BETA_NODE',$3,$4,'STARTING',$5)
        ON CONFLICT (name) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = NOW()`,
        [id, name, publicKey, `heroku-config-var:${sha256(keySeed).slice(0, 16)}`, { storage: "postgres-logical", quorum: config.betaNodeQuorum }]
      );
    }
  }

  private async acquireLease() {
    const result = await this.pool.query(
      `INSERT INTO beta_cluster_leases (lease_key, owner_id, expires_at)
       VALUES ('beta-logical-node-cluster', $1, NOW() + ($2 || ' seconds')::interval)
       ON CONFLICT (lease_key) DO UPDATE SET owner_id = EXCLUDED.owner_id, expires_at = EXCLUDED.expires_at, updated_at = NOW()
       WHERE beta_cluster_leases.expires_at < NOW() OR beta_cluster_leases.owner_id = $1
       RETURNING owner_id`,
      [this.ownerId, config.betaNodeLeaseSeconds]
    );
    return result.rows[0]?.owner_id === this.ownerId;
  }

  private async promoteIfLeaseAvailable() {
    if (this.active || !(await this.acquireLease())) {
      return;
    }
    if (this.leaseRetryTimer) {
      clearInterval(this.leaseRetryTimer);
      this.leaseRetryTimer = undefined;
    }
    await this.startCoordinatorTasks();
  }

  private async startCoordinatorTasks() {
    this.active = true;
    await this.reconcile();
    await this.tickHeartbeat();
    this.heartbeatTimer = setInterval(() => void this.safeRun("heartbeat", () => this.tickHeartbeat()), config.betaNodeHeartbeatSeconds * 1000);
    this.supervisorTimer = setInterval(() => void this.safeRun("supervisor", () => this.supervise()), Math.max(5000, Math.floor(config.betaNodeHeartbeatSeconds * 1000)));
    this.repairTimer = setInterval(() => void this.safeRun("repair", () => this.repairPending()), config.betaNodeRepairIntervalSeconds * 1000);
  }

  private async renewLease() {
    const result = await this.pool.query(
      `UPDATE beta_cluster_leases SET expires_at = NOW() + ($2 || ' seconds')::interval, updated_at = NOW()
       WHERE lease_key = 'beta-logical-node-cluster' AND owner_id = $1 RETURNING owner_id`,
      [this.ownerId, config.betaNodeLeaseSeconds]
    );
    if (!result.rowCount) {
      await this.stop();
      return false;
    }
    return true;
  }

  private async tickHeartbeat() {
    if (!(await this.renewLease())) {
      return;
    }
    const nodes = await this.pool.query("SELECT id, name, status, monotonic_counter FROM beta_logical_nodes WHERE status <> 'SUSPENDED' ORDER BY name");
    for (const node of nodes.rows) {
      const nextCounter = Number(node.monotonic_counter ?? 0) + 1;
      const inventoryDigest = await this.inventoryDigest(node.id);
      const status: BetaNodeStatus = node.status === "FAILED" || node.status === "OFFLINE" ? "RECOVERING" : "ONLINE";
      const heartbeat = { nodeId: node.id, timestamp: new Date().toISOString(), sequence: nextCounter, status, version: "beta-logical-node-v1", capabilities: { storage: "postgres-logical" }, inventoryDigest };
      const signature = hmac(stableJson(heartbeat));
      await this.pool.query(
        `UPDATE beta_logical_nodes
         SET status = $2, monotonic_counter = $3, inventory_digest = $4, last_heartbeat_at = NOW(), started_at = COALESCE(started_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [node.id, status, nextCounter, inventoryDigest]
      );
      await this.pool.query(
        `INSERT INTO beta_node_heartbeats (node_id, sequence, status, inventory_digest, signature)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (node_id, sequence) DO NOTHING`,
        [node.id, nextCounter, status, inventoryDigest, signature]
      );
    }
  }

  private async supervise() {
    if (!(await this.renewLease())) {
      return;
    }
    await this.pool.query(
      `UPDATE beta_logical_nodes
       SET status = 'DEGRADED', last_error_code = 'HEARTBEAT_MISSED', updated_at = NOW()
       WHERE status = 'ONLINE' AND last_heartbeat_at < NOW() - ($1 || ' seconds')::interval`,
      [config.betaNodeHeartbeatSeconds * 3]
    );
    await this.pool.query(
      `UPDATE beta_logical_nodes
       SET status = 'OFFLINE', last_error_code = 'HEARTBEAT_OFFLINE_THRESHOLD', restart_count = restart_count + 1, updated_at = NOW()
       WHERE status IN ('ONLINE','DEGRADED','RECOVERING') AND last_heartbeat_at < NOW() - ($1 || ' seconds')::interval`,
      [config.betaNodeOfflineThresholdSeconds]
    );
    await this.pool.query(
      `UPDATE beta_logical_nodes
       SET status = 'RECOVERING', updated_at = NOW()
       WHERE status = 'OFFLINE' AND restart_count < 20`
    );
  }

  private async reconcile(nodeId?: string) {
    const filter = nodeId ? "WHERE id = $1" : "";
    const params = nodeId ? [nodeId] : [];
    const nodes = await this.pool.query(`SELECT id FROM beta_logical_nodes ${filter} ORDER BY name`, params);
    for (const node of nodes.rows) {
      await this.pool.query(
        `INSERT INTO beta_node_objects (node_id, cid, object_type, object_reference, object_hash, replica_status, acknowledged_at, last_verified_at)
         SELECT $1, p.cid, p.object_type, p.object_reference, p.object_hash, 'FULLY_REPLICATED', NOW(), NOW()
         FROM beta_node_payloads p
         WHERE p.revoked_at IS NULL
         ON CONFLICT (node_id, cid) DO UPDATE SET replica_status = 'FULLY_REPLICATED', last_verified_at = NOW(), updated_at = NOW()`,
        [node.id]
      );
      await this.pool.query("UPDATE beta_logical_nodes SET status = CASE WHEN status = 'SUSPENDED' THEN status ELSE 'ONLINE' END, updated_at = NOW() WHERE id = $1", [node.id]);
    }
    await this.recordEvent(nodeId ?? null, "RECONCILE", "INFO", { nodeId: nodeId ?? "all" });
  }

  private async repairPending() {
    const rows = await this.pool.query("SELECT DISTINCT cid FROM beta_node_objects WHERE replica_status IN ('DEGRADED','REPAIRING','CORRUPTED') LIMIT 25");
    for (const row of rows.rows) {
      await this.storage.repairObject(row.cid);
    }
  }

  private async changeNodeStatus(id: string, status: BetaNodeStatus, eventType: string) {
    const result = await this.pool.query("UPDATE beta_logical_nodes SET status = $2, updated_at = NOW() WHERE id = $1 OR name = $1 RETURNING id", [id, status]);
    if (!result.rowCount) {
      throw new Error("BETA_NODE_NOT_FOUND");
    }
    await this.recordEvent(result.rows[0].id, eventType, "INFO", {});
    return this.status();
  }

  private async inventoryDigest(nodeId: string) {
    const objects = await this.pool.query("SELECT cid, object_hash, replica_status FROM beta_node_objects WHERE node_id = $1 ORDER BY cid", [nodeId]);
    return `sha256:v1:${sha256(stableJson(objects.rows))}`;
  }

  private async recordEvent(nodeId: string | null, eventType: string, severity: "INFO" | "WARN" | "ERROR", metadata: Record<string, unknown>) {
    await this.pool.query("INSERT INTO beta_node_events (id, node_id, event_type, severity, safe_metadata_json) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), nodeId, eventType, severity, metadata]);
  }

  private async safeRun(label: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      this.logger?.warn({ label, error: error instanceof Error ? error.message : "unknown" }, "beta logical node task failed");
    }
  }
}

export const betaLogicalNodeCluster = new BetaLogicalNodeCluster();
export const memoryNodeStorageForTests = () => new MemoryNodeStorage();

function deriveClusterStatus(onlineCount: number): Exclude<BetaClusterStatus, "SLEEP_RISK"> {
  if (onlineCount >= 3) return "FULLY_OPERATIONAL";
  if (onlineCount === 2) return "OPERATIONAL_DEGRADED";
  if (onlineCount === 1) return "CRITICAL";
  return "UNAVAILABLE";
}

function isNodeFresh(status: string, lastHeartbeatAt: string | Date | null | undefined, now: number) {
  if (!["ONLINE", "DEGRADED", "RECOVERING"].includes(status) || !lastHeartbeatAt) {
    return false;
  }
  const heartbeatTime = new Date(lastHeartbeatAt).getTime();
  return Number.isFinite(heartbeatTime) && now - heartbeatTime <= config.betaNodeOfflineThresholdSeconds * 1000;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(value: string) {
  const key = config.betaNodeMasterKey || "development-beta-node-master-key";
  return createHmac("sha256", key).update(value).digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sortJson(val)]));
  }
  return value;
}

export function generateBetaNodeMasterKey() {
  return randomBytes(32).toString("base64url");
}
