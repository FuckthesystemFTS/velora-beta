# Architettura

## Moduli

- `app/`: pagine App Router, route handlers JSON, layout e legal pages
- `components/`: componenti UI accessibili, shell e card operative
- `lib/`: env, auth, prisma, headers, permissions, utils
- `server/services/`: domain services per auth, feed, upload, moderation, dashboard
- `server/moderation/`: regole pure e algoritmo di selezione giurati
- `prisma/`: schema e seed
- `tests/`, `e2e/`: test automatici

## Pattern

- auth proprietaria con sessione persistita in tabella `Session`
- servizi server-centrici richiamati da route handlers e server components
- Prisma come layer dati unico
- RBAC centralizzato tramite `Role` e guard server-side

## Deployment-ready

- DB esterno via `DATABASE_URL`
- app stateless lato filesystem salvo fallback upload locale disattivabile in produzione
- health route
- Procfile pronto
