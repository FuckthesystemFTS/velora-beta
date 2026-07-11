# Velora Nodes, Hosting Credits and Mining Partner

Stato implementato in questa beta:

- Solo Velora, Nodo Velora, Nodo Hosting e Nodo Completo sono registrati nel backend con profilo risorse e consenso separato.
- I nodi contributori hanno enrollment, certificato beta, heartbeat e stato amministrabile.
- I crediti hosting hanno ledger separato e richieste manuali beta approvabili dall'admin.
- Il Mining Partner e separato da nodi e crediti, disattivato di default e richiede consenso per XMR o ZEPH.
- La ripartizione mining e registrata 50% utente e 50% Velora in `mining_workers` e `mining_ledger`.
- Le azioni admin su nodi, crediti e worker mining sono auditate in `audit_logs`.

Non implementato come esecuzione automatica:

- Nessun miner viene scaricato o avviato dal backend.
- Nessun processo locale parte senza UI, consenso esplicito e sidecar firmato.
- Il pool/accounting self-hosted resta predisposto dai campi `pool_url` e ledger, ma richiede deployment separato del pool e del worker agent.

## Configurare wallet Velora 50%

Usare wallet pubblici di ricezione. Non mettere seed phrase, private key o mnemonic.

```powershell
heroku config:set VELORA_MINING_MONERO_WALLET="INSERISCI_WALLET_PUBBLICO_XMR" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPHYR_WALLET="INSERISCI_WALLET_PUBBLICO_ZEPH" --app velora-beta-20260629
```

Pool autorizzate, opzionali:

```powershell
heroku config:set VELORA_MINING_XMR_POOL_URL="stratum+tcp://POOL_XMR_AUTORIZZATA:PORTA" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPH_POOL_URL="stratum+tcp://POOL_ZEPH_AUTORIZZATA:PORTA" --app velora-beta-20260629
```

Verifica config:

```powershell
heroku config:get VELORA_MINING_MONERO_WALLET --app velora-beta-20260629
heroku config:get VELORA_MINING_ZEPHYR_WALLET --app velora-beta-20260629
```

## API principali

- `GET /api/v1/contribution/profile`
- `POST /api/v1/contribution/profile`
- `POST /api/v1/contribution/consents`
- `POST /api/v1/contribution/nodes/enroll`
- `POST /api/v1/contribution/nodes/:id/heartbeat`
- `GET /api/v1/credits`
- `POST /api/v1/credits/requests`
- `GET /api/v1/mining/status`
- `POST /api/v1/mining/workers`
- `GET /api/admin/contribution/overview`
- `GET /api/admin/contribution/nodes`
- `POST /api/admin/contribution/nodes/:id/status`
- `GET /api/admin/credits/requests`
- `POST /api/admin/credits/requests/:id/decision`
- `POST /api/admin/mining/workers/:id/status`

## Migrazione e deploy

```powershell
corepack pnpm --filter @velora/api build
heroku run node scripts/run-migrations.mjs --app velora-beta-20260629
```
