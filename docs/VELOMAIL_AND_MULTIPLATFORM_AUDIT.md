# VeloMail and Multiplatform Audit

Date: 2026-06-30

| Component | Status | Notes |
| --- | --- | --- |
| Velora registration | PARTIAL | Creates a Velora user; beta flow does not yet validate external recovery email. |
| Login | PARTIAL | Password hash flow exists; session is beta token based. |
| Licenses | PARTIAL | Schema exists; production validation remains limited. |
| Device enrollment | PARTIAL | Device certificate is generated; private-key secure storage is still desktop-local. |
| Device identity | PARTIAL | Node identity exists in Tauri local store. |
| Device certificates | PARTIAL | Membership certificate stored and signed server-side. |
| Device key protection | PARTIAL | Requires SecureStorageProvider hardening for Windows/macOS. |
| Max three accounts per device | PARTIAL | Backend schema is present; UI enforcement still needs persisted local account chooser. |
| Account recovery | MISSING | Recovery codes and device approval flow are documented but not shipped. |
| Revocations | PARTIAL | Revocation tables exist; VeloMail device revocation policy needs enforcement. |
| PostgreSQL | COMPLETE | Heroku Postgres is configured and migrations are part of release command. |
| SQLite local | PARTIAL | Desktop local store exists; per-account encrypted mail cache is not complete. |
| P2P/bootstrap/discovery | PARTIAL | Node identity/bootstrap exists; VeloMail replication layer is not complete. |
| Content store/chunking | PARTIAL | Publisher content chunks exist; mail attachment chunking remains planned. |
| Notifications | PLACEHOLDER | UI exists; native notification delivery is not wired. |
| Identity levels | PARTIAL | SDK and UI expose levels; full verification service is not active. |
| SDK | PARTIAL | SDK includes auth/identity/site plus VeloMail methods. |
| Publisher Studio | PARTIAL | Desktop uses shared publisher API and release flow. |
| Zone approval/review | PARTIAL | Control Center APIs exist with signed audit records. |
| Control Center | PARTIAL | Hidden UI exists; VeloMail-specific moderation stats are not complete. |
| Public portal | COMPLETE | Heroku portal serves download and beta pages. |
| Windows download | COMPLETE | MSI exists with SHA-256. |
| Tauri Windows config | COMPLETE | MSI build completed. |
| macOS support | PARTIAL | Workflow exists; DMG is not produced locally. |
| GitHub Actions | PARTIAL | Manual workflow is present; execution depends on GitHub auth/remote. |
| Installer storage | PARTIAL | Windows artifact is served by Heroku bundle; durable GitHub Releases is recommended next. |

