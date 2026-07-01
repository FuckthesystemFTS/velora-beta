# Beta Logical Node Architecture

Velora Beta uses `BetaLogicalNodeCluster` as a temporary bridge toward real nodes.

Components:

- `BetaNodeSupervisor`: periodic supervision in `BetaLogicalNodeCluster.supervise`.
- `BetaNodeCoordinator`: one active process selected by PostgreSQL lease.
- `BetaLogicalNodeActor`: three logical records named `velora-beta-node-1`, `velora-beta-node-2`, `velora-beta-node-3`.
- `BetaNodeStorage`: `NodeStorageProvider`.
- `BetaReplicationEngine`: logical object assignment in `PostgresLogicalNodeStorage`.
- `BetaNodeHealthMonitor`: heartbeat/offline threshold logic.
- `BetaNodeRouter`: exposed through status and quorum checks, with future routing seam.
- `BetaNodeRecoveryManager`: reconcile and repair methods.

The cluster runs inside the existing API process. It does not open extra ports and does not run three web servers.

Persistence is PostgreSQL only. Payloads are stored once per CID in `beta_node_payloads`; each logical node has separate ownership/verification rows in `beta_node_objects`.

Leader election uses the `beta_cluster_leases` table. Only the process holding the lease sends heartbeat and reconciliation work.

Quorum rules:

- Desired replicas: 3.
- Minimum quorum: 2.
- Reads may proceed with at least one valid replica.
- Final publication requires quorum when `VELORA_BETA_NODE_CLUSTER_ENABLED=true`.
