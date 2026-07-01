# Beta Logical Node Limits

This is not a physically decentralized network.

The beta nodes are logical software actors hosted by the same Heroku app and backed by the same PostgreSQL database. They do not provide geographic replication, multi-provider failover or protection against total Heroku/PostgreSQL outage.

The system is useful for beta because it verifies identities, heartbeat, logical inventory, quorum, failover paths and recovery behavior without adding infrastructure costs.

If the Heroku plan is Eco or otherwise sleeps, the cluster reports `SLEEP_RISK`. Velora must not use auto-ping loops to bypass platform sleep behavior.

No private node key material is committed to Git. The configured master key must be stored as a Heroku config var.
