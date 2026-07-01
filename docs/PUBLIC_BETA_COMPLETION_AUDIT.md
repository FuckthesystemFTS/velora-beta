# Velora Public Beta Completion Audit

Data: 2026-07-01

Legenda stati ammessi: `COMPLETE`, `PARTIAL`, `MISSING`, `BROKEN`, `CENTRALIZED`, `NOT_CONNECTED`, `PLACEHOLDER`, `WINDOWS_ONLY`, `BLOCKED_BY_EXTERNAL_CONFIGURATION`.

| Area | Stato | Evidenza reale | Prossimo passo obbligatorio |
| --- | --- | --- | --- |
| Registrazione | PARTIAL | `/api/v1/auth/register` crea utente e mailbox. | Sostituire autorizzazione `x-user-id` con sessioni firmate. |
| Login | PARTIAL | `/api/v1/auth/login` restituisce sessione applicativa e mailbox. | Access token breve, refresh token, revoca e audit login. |
| Sessioni | MISSING | Nessuna sessione server-side production-grade verificata. | Implementare access/refresh token, rotazione e logout dispositivo/globale. |
| Refresh token | MISSING | Non collegato. | Aggiungere tabella sessioni e token hashati. |
| Device enrollment | PARTIAL | Desktop registra il dispositivo dopo login. | Limite tre account server-side e revoca dispositivo. |
| Account chooser | PARTIAL | UI conserva una sessione locale. | Gestire fino a tre account separati con isolamento dati. |
| Limite tre account | MISSING | Non applicato end-to-end. | Applicare su SQLite, device certificate e backend. |
| Recupero account | MISSING | Non presente. | Recovery code, approvazione da device esistente, revoca device smarrito. |
| Chiavi account/device | PARTIAL | Identita nodo locale presente. | Separare chiavi account, device, mail e publisher in secure storage. |
| Certificati device | MISSING | Non presente come trust model finale. | Creare certificato dispositivo firmato dal Core. |
| Revoche | PARTIAL | Release status e revoche concettuali presenti. | Propagazione revoche su client, indice e content store. |
| VeloMail | CENTRALIZED | Invio/lettura funzionano via PostgreSQL. | Cifratura client-side, chunking, store-and-forward e replica. |
| PostgreSQL | COMPLETE | Heroku Postgres collegato e usato dal Core. | Backup/restore e piano migrazione fuori Heroku. |
| SQLite desktop | PARTIAL | Store locale Tauri presente. | Isolamento account e cache manifest firmati. |
| P2P | PARTIAL | Basi content/chunking locali esistono, non rete reale completa. | Nodo headless, peer discovery, replica e test tre nodi. |
| Bootstrap/relay | MISSING | Non disponibili come servizio reale. | Manifest bootstrap firmato e nodi headless configurabili. |
| Content store | PARTIAL | Packaging locale calcola hash e file manifest. | Pinning, TTL, quota, provider discovery, replica e GC. |
| Chunking | PARTIAL | Basi locali. | Formato `.vsite`, chunks deterministici e recovery parallelo. |
| Ricerca | PARTIAL | Ricerca locale/remota base. | Indexer headless, segmenti firmati, ranking e revoche. |
| Indicizzazione | PARTIAL | Metadata release indicizzati in Core. | Index provider distribuito e aggiornamenti incrementali. |
| Pubblicazione | PARTIAL | Desktop valida/prepara/registra release online. | Review completa, attivazione, rollback, revoca e apertura da secondo nodo. |
| Review publisher | MISSING | Non esiste scoring deterministico completo. | Scanner manifest/file/permessi/segreti/CSP. |
| Attivazione release | PARTIAL | Release beta puo risultare `ACTIVE`. | Stato normativo completo e audit. |
| Rollback | MISSING | Non esposto end-to-end. | API e UI publisher/admin. |
| Control Center | PLACEHOLDER | UI protetta solo lato frontend/beta. | RBAC server-side, MFA, audit, sessioni brevi. |
| MFA admin | MISSING | Non presente. | TOTP/WebAuthn obbligatorio per admin. |
| Ruoli | MISSING | Non derivati da sessione server-side. | RBAC server-side. |
| Portale | PARTIAL | Heroku distribuisce manifest/download. | Portale publisher, guida, stato, changelog e supporto. |
| Download Windows | COMPLETE | MSI pubblico verificato con SHA-256. | Firma codice e updater manuale/firmato. |
| macOS | BLOCKED_BY_EXTERNAL_CONFIGURATION | Workflow pronto ma runner GitHub macOS non assegnato. | Abilitare runner/minuti oppure CI macOS alternativo. |
| Documentazione publisher | PARTIAL | README e report creati; specifica in completamento. | Collegare guida al portale e validare esempi contro schema. |

## Conclusione

Velora e distribuibile come beta Windows centralizzata con funzioni core iniziali reali. Non e ancora una beta decentralizzata completa: VeloMail E2E, P2P data plane, admin security production-grade, macOS artifact e release lifecycle completo restano requisiti non chiusi.
