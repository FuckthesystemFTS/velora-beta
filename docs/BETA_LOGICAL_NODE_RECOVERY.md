# Beta Logical Node Recovery

The coordinator renews a PostgreSQL lease. If the process stops, another process can take the lease after expiry.

On startup, the cluster:

- Verifies schema availability.
- Creates or updates the three node identities.
- Acquires the coordinator lease.
- Reconciles logical inventories from PostgreSQL payload records.
- Starts heartbeat, supervision and repair timers.

If a node misses heartbeat, it becomes `DEGRADED`, then `OFFLINE`, then `RECOVERING` unless suspended by admin.

If object verification fails, the replica is marked `CORRUPTED` and repair can be invoked without serving the corrupt payload as valid.
