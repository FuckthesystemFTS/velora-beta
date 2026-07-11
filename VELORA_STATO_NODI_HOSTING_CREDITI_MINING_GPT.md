# Stato Velora - nodi, hosting, crediti, NAS e mining

Questo file e pensato per essere letto da un altro modello o agente.

## Implementato ora

- Migrazione `apps/api/migrations/008_nodes_hosting_credits_mining.sql`.
- Tabelle persistenti per profili contributore, consensi, nodi, heartbeat, credit ledger, richieste crediti, mining device, mining worker e mining ledger.
- API utente per attivare modalita contributore, registrare consenso, iscrivere nodo, inviare heartbeat, richiedere crediti, registrare worker mining opt-in.
- API admin per overview, sospensione/revoca nodi, approvazione/hold/rifiuto crediti e sospensione/revoca/hold worker mining.
- Mining separato da Velora node e hosting node.
- Split mining registrato 50% utente e 50% Velora.
- Wallet Velora configurabili solo via ambiente: `VELORA_MINING_MONERO_WALLET`, `VELORA_MINING_ZEPHYR_WALLET`.

## Basi presenti ma da completare per distribuzione globale

- UI desktop Node Manager completa.
- Agent locali separati `velora-node-agent`, `velora-hosting-agent`, `velora-mining-agent`.
- Sidecar miner firmato con checksum, stop immediato, limiti CPU/RAM/batteria/temperatura.
- Pool e accounting self-hosted reali.
- NAS Synology fallback agent con enrollment, health e revoca.
- Verifica crittografica completa heartbeat con challenge-response e anti-replay forte.
- Payout on-chain automatici e riconciliazione tx hash.

## Sicurezza richiesta prima di globale

- Nessun mining predefinito.
- Nessun processo nascosto.
- Nessuna shell remota o comando arbitrario.
- Segreti solo in config var/server secret.
- Admin action sempre motivata e auditable.
- Rate limit e antifrode su richieste credito, heartbeat e mining worker.
