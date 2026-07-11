# Velora Nodes, Hosting Credits and Mining Partner

Stato implementato in questa beta:

- Solo Velora, Nodo Velora, Nodo Hosting e Nodo Completo sono registrati nel backend con profilo risorse e consenso separato.
- I nodi contributori hanno enrollment, certificato beta, heartbeat e stato amministrabile.
- I crediti hosting hanno ledger separato e richieste manuali beta approvabili dall'admin.
- Il Mining Partner e separato da nodi e crediti, disattivato di default e richiede consenso per XMR o ZEPH.
- Il modello Mining Partner e custodial con payout differito.
- La pool usa esclusivamente il wallet operativo Velora configurato in `VELORA_MINING_MONERO_WALLET` o `VELORA_MINING_ZEPHYR_WALLET`.
- Il wallet pubblico utente viene salvato solo come indirizzo di payout finale, non come wallet pool.
- La ripartizione mining e registrata in basis points con default 5000/5000 in `mining_workers` e `mining_ledger`.
- Le azioni admin su nodi, crediti e worker mining sono auditate in `audit_logs`.

Non implementato come esecuzione automatica:

- Nessun miner viene scaricato o avviato dal backend.
- Nessun processo locale parte senza UI, consenso esplicito e sidecar firmato.
- Accounting pool, riconciliazione pagamenti e payout worker restano predisposti ma non dichiarati operativi.
- Con `VELORA_MINING_PAYOUTS_ENABLED=false` non vengono trasmesse transazioni e non esiste stato `paid`.

## Configurare wallet Velora 50%

Usare wallet pubblici di ricezione. Non mettere seed phrase, private key o mnemonic.

```powershell
heroku config:set VELORA_MINING_MONERO_WALLET="INSERISCI_WALLET_PUBBLICO_XMR" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPHYR_WALLET="INSERISCI_WALLET_PUBBLICO_ZEPH" --app velora-beta-20260629
heroku config:set VELORA_MINING_USER_SHARE_BPS=5000 --app velora-beta-20260629
heroku config:set VELORA_MINING_VELORA_SHARE_BPS=5000 --app velora-beta-20260629
heroku config:set VELORA_MINING_PAYOUTS_ENABLED=false --app velora-beta-20260629
```

Pool autorizzate, opzionali:

```powershell
heroku config:set VELORA_MINING_XMR_POOL_URL="stratum+ssl://gulf.moneroocean.stream:20128" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPH_POOL_URL="stratum+tcp://zeph.2miners.com:2222" --app velora-beta-20260629
```

Wallet RPC futuri, da tenere su infrastruttura protetta separata e mai nel client:

```powershell
heroku config:set VELORA_MINING_XMR_WALLET_RPC_URL="" --app velora-beta-20260629
heroku config:set VELORA_MINING_XMR_WALLET_RPC_USER="" --app velora-beta-20260629
heroku config:set VELORA_MINING_XMR_WALLET_RPC_PASSWORD="" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPH_WALLET_RPC_URL="" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPH_WALLET_RPC_USER="" --app velora-beta-20260629
heroku config:set VELORA_MINING_ZEPH_WALLET_RPC_PASSWORD="" --app velora-beta-20260629
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
- `GET /api/admin/mining/diagnostics`
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

## Worker e contabilita

- XMR MoneroOcean: pool URL da `VELORA_MINING_XMR_POOL_URL`, username pool uguale al wallet operativo Velora, worker ID nel campo password/pass.
- ZEPH 2Miners: pool URL da `VELORA_MINING_ZEPH_POOL_URL`, username nel formato `WALLET_OPERATIVO_VELORA.WORKER_ID`, password `x`.
- Worker ID stabile: `velora_<userPublicId>_<devicePublicId>`.
- Il worker ID e pseudonimo e non contiene email, nome, cognome o ID sequenziali.
- Accounting reale: non dichiarato operativo finche non esiste import verificabile share/pagamenti dalla pool.

Formula ledger obbligatoria con interi atomici:

```text
DISTRIBUTABLE_AMOUNT = CONFIRMED_MINED_AMOUNT - UNAVOIDABLE_ONCHAIN_NETWORK_FEE
USER_AMOUNT = floor(DISTRIBUTABLE_AMOUNT * USER_SHARE_BPS / 10000)
VELORA_AMOUNT = DISTRIBUTABLE_AMOUNT - USER_AMOUNT
```

Costi server, sviluppo, gestione o amministrazione non sono sottratti al lordo. Devono restare dentro la quota Velora.

Wallet ufficiali per utenti:

- Monero: https://www.getmonero.org/downloads/
- Zephyr: https://zephyrprotocol.com/
