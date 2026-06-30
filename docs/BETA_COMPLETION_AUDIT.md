# Velora Beta Completion Audit

| Componente | Stato | File reali | Codice collegato | Persistenza | Test eseguito | Problemi | Intervento | Risultato finale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Build Node workspace | COMPLETE | `package.json`, `pnpm-workspace.yaml` | Si | N/A | `corepack pnpm build` | Nessuno | Nessuno | Build Node completata |
| Typecheck Node | COMPLETE | `package.json` | Si | N/A | `corepack pnpm typecheck` | Nessuno | Nessuno | Typecheck completato |
| Test Node | COMPLETE | `packages/shared/src/*.test.ts`, `apps/api/src/repository.test.ts` | Si | N/A | `corepack pnpm test` | Copertura limitata | Nessuno | Test verdi ma copertura parziale |
| Cargo toolchain | COMPLETE | `apps/desktop/src-tauri/Cargo.toml` | Si | N/A | `cargo` installato | Prima build lenta | Toolchain ripristinato | Toolchain disponibile |
| Cargo check desktop | PARTIAL | `apps/desktop/src-tauri/src/lib.rs` | Parziale | SQLite locale | In corso / retried | Prima compilazione Tauri lunga e dipendenze rete instabili | Retry e cache avviata | Compilazione iniziale avviata ma non ancora conclusa in questa sessione |
| PostgreSQL backend | PARTIAL | `apps/api/src/db.ts`, `apps/api/src/repository.ts` | Si | PostgreSQL reale | Typecheck/build | Mancano release/content/search | Nessuno ancora | Auth/zones/admin collegati, publishing no |
| SQLite locale | PARTIAL | `apps/desktop/src-tauri/schema/local.sql` | Si | SQLite locale | Typecheck/build web | Mancano cache contenuti, indice FTS, release locali | Nessuno ancora | Identita nodo presente, browser/cache no |
| Auth utente | PARTIAL | `apps/api/src/routes.ts` | Si | PostgreSQL | Build/test | Token fittizi, recovery/logout non reali | Da completare | Flusso base presente ma non production-grade |
| Enrollment dispositivo | PARTIAL | `apps/api/src/routes.ts`, `apps/api/src/repository.ts`, `apps/desktop/src-tauri/src/lib.rs` | Si | PostgreSQL + SQLite | Build/typecheck | Non c'e persistenza sessione desktop completa | Da completare | Enrollment API e Tauri collegati |
| Control Center grafico | NOT_CONNECTED | `apps/desktop/src/main.tsx` | No | N/A | Build web | Solo placeholder UI | Da completare | Non utilizzabile realmente |
| Richieste zone | PARTIAL | `packages/shared/src/zones.ts`, `apps/api/src/routes.ts`, `apps/api/src/repository.ts` | Si | PostgreSQL | Test/build | Mancano UI reali e flusso account completo | Da completare | API base presenti |
| Approvazione zona admin | PARTIAL | `apps/api/src/routes.ts`, `apps/api/src/repository.ts` | Si | PostgreSQL | Build/typecheck | UI admin mancante, verify challenge minimale | Da completare | Backend firma e approvazione presenti |
| Record zona firmato | PARTIAL | `apps/api/src/repository.ts` | Si | PostgreSQL | Build/typecheck | Manca update release/currentContentCid | Da completare | Firma iniziale presente |
| Publisher Studio | BROKEN | `apps/desktop/src/main.tsx` | No | N/A | Build web | Solo etichetta UI | Da costruire | Nessun publishing reale dal desktop |
| Manifest `velora.json` | COMPLETE | `packages/shared/src/velora-site.ts` | Si | File system | Test/typecheck | Nessuno rilevato | Implementato | Schema condiviso disponibile |
| `.veloraignore` | COMPLETE | `packages/shared/src/velora-site.ts` | Si | File system | Typecheck | UI esclusioni mancante | Implementato | Regole e parser presenti |
| Validatore sito | PARTIAL | `packages/shared/src/velora-site.ts` | Si | File system | Test/typecheck | Mancano symlink, HTML extraction, CSP profonda | Da estendere | Validatore base reale presente |
| Packager `.vsite` | PARTIAL | `packages/shared/src/velora-site.ts` | Si | File system | Typecheck | Firma publisher vuota, archivio non ancora registrato backend | Da completare | Packaging reale base presente |
| CLI Velora | PARTIAL | `apps/cli/src/index.ts` | Si | File system | Typecheck da eseguire dopo integrazione script | Login/zones/status non connessi backend | Da completare | Init/validate/package/inspect/publish base disponibili |
| Sample site | COMPLETE | `examples/velora-demo-site/*` | Si | File system | Da usare nei test E2E | Nessuno | Creato | Sample pronto |
| Site releases | MISSING | Nessun file release-specifico | No | No | No | Nessuna migrazione/API dedicate | Da implementare | Mancante |
| Content store e chunking | MISSING | Nessun modulo reale | No | No | No | Nessun chunk store/provider | Da implementare | Mancante |
| Libp2p | MISSING | Nessun crate/modulo reale | No | No | No | Nessun networking P2P reale | Da implementare | Mancante |
| Search FTS5 reale | MISSING | Nessun modulo reale | No | No | No | SQLite locale non indicizza siti | Da implementare | Mancante |
| Resolver `categoria.nome` | PARTIAL | `packages/shared/src/zones.ts`, desktop UI | No | No | No | Nessun resolver record/content | Da implementare | Solo validazione sintassi |
| WebView isolata contenuti | PARTIAL | `apps/desktop/src-tauri/tauri.conf.json` | Parziale | N/A | Cargo check pending | Mancano viewer dedicato e policy runtime | Da completare | CSP iniziale soltanto |
| Heroku deploy | BLOCKED_BY_EXTERNAL_CONFIGURATION | `Procfile`, `heroku.yml`, `Dockerfile`, `scripts/run-migrations.mjs` | Parziale | PostgreSQL/S3 esterni | Static check | Mancano credenziali reali e deploy run | Da completare | Preparazione presente, deploy non verificato |
