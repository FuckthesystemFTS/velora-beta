# Velora Beta Logical Node Audit

Date: 2026-07-01

## Implemented

- Persistent PostgreSQL backend with users, sessions, devices, VeloMail metadata, zones, releases and content records.
- Public portal and release manifest on the existing Heroku app.
- Windows beta installer published with SHA-256 manifest.
- macOS unsigned beta build passing in GitHub Actions.
- Additive migration `006_beta_logical_node_cluster.sql` for logical beta nodes, heartbeats, payloads, object inventories, replication jobs, events and coordinator lease.
- Backend component `BetaLogicalNodeCluster` with three logical node identities, heartbeat, lease, quorum, repair hooks and public/admin API.

## Partially Implemented

- VeloMail stores new messages as client-encrypted ciphertext, but recipient-side key exchange and full readable E2EE UX still need completion.
- Search exists as centralized index plumbing; distributed search is only prepared through future node object inventory.
- Publishing can now register logical replicas for release CIDs when the feature flag is enabled.

## Documented Only

- Real independent community/provider nodes.
- Geographic replication.
- Production-grade multi-provider failover.

## Simulated Or Logical

- The three beta nodes are `LOGICAL_BETA_NODE` actors in one Heroku app and one PostgreSQL database.
- They do not protect against full Heroku/database outage.

## Distributed

- Existing Heroku API and portal.
- Windows beta installer.
- macOS unsigned beta artifact through GitHub Actions.

## Verified Really

- Local TypeScript builds passed before this cluster patch.
- GitHub Actions macOS run `28515532483` completed successfully.
- Live secure auth/mail/download smoke test passed before this cluster patch.

## Still To Verify After Deploy

- Migration `006` on Heroku.
- Feature flag activation.
- Three node identities and heartbeat online.
- Sentinel object quorum 2/3 and 3/3.
- Suspend/resume failover.
- Heroku restart recovery.
