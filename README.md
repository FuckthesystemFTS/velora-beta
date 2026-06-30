# Velora

Velora is a monorepo for a private navigation ecosystem composed of:

- `apps/api`: backend REST API for auth, zone requests, control endpoints and bootstrap services.
- `apps/portal`: public Velora Access Portal.
- `apps/desktop`: desktop UI shell for the browser, zone request flow and Control Center.
- `packages/shared`: branding, validation rules and signed-command schemas.
- `scripts/`: key generation, admin bootstrap and operational helpers.

## Quick start

```bash
npm install
npm run build --workspace @velora/shared
npm run dev:api
npm run dev:portal
npm run dev:desktop
```

## Notes

- Rust and Tauri CLI are required to compile the native desktop bundle. They are not installed in this environment.
- The current backend uses an in-memory repository for the running MVP and ships SQL migrations for PostgreSQL.
- Administrative control commands are verified using Ed25519 signatures.
