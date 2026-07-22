# Velora NEXT audit

## Stato rilevato
- Framework frontend: React/Vite per desktop e portal package, HTML/CSS/JS server-rendered in `apps/api/src/routes.ts` per sito pubblico, portale web e PWA mobile.
- Route pubbliche: `/`, `/download`, `/what-is-velora`, `/security`, `/publishers`, `/publishers/guide`, `/developers`, `/pricing`, `/status`, `/legal/privacy`, `/legal/cookie`, `/legal/terms`.
- Route portale: `/portal`, `/portal/:section`, `/mobile`, `/zone/:address`, API `/api/v1/*`.
- Autenticazione: token bearer salvato localmente nel portale, API esistenti `/api/v1/auth/register`, `/api/v1/auth/login`, refresh sessione già collegato.
- Funzioni reali preservate: Search, Browser Zone, Tools, VeloMail, Cloud, Publisher, Forum, Mining, Nodi, NAS, Guardian, Download.
- CSS/theme attuale: dark navy/gold con stili inline lato API e CSS dedicati per app React.
- Responsive attuale: presente ma con navigazione pubblica mobile orizzontale e card/hero troppo alti.
- Build/deploy: pnpm workspace, Docker Heroku per API/pubblico, build Vite per portal/desktop.
- PWA/service worker: presenti per mobile e apple portal.
- Desktop-native: Tauri/Rust presente, non modificato in questa fase per non alterare build native e miner.

## Intervento eseguito
- Applicata identità visiva Velora NEXT senza rinominare package, API o database.
- Migliorati sito pubblico, portale web e mobile PWA con layout più compatto, superfici stratificate, focus states, safe-area e menu mobile.
- Aggiornata app React portal con lo stesso linguaggio visivo.

## Stato
- IMPLEMENTATO E VERIFICATO: patch frontend/template, funzioni preservate a livello di codice.
- IMPLEMENTATO MA NON TESTATO SU DISPOSITIVO REALE: resa iPhone/Android fisica e Safari reale.
- NON IMPLEMENTATO: rebuild Tauri pesante Windows/macOS in questa fase, come richiesto dal pacchetto fino al completamento frontend.
