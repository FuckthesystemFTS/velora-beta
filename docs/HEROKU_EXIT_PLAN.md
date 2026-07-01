# Heroku Exit Plan

Data: 2026-07-01

## Cosa gira ora su Heroku

- Portale beta pubblico.
- Velora Core API.
- PostgreSQL gestito da Heroku.
- Download MSI e manifest release.
- Registrazione, login, VeloMail centralizzata beta, identita base e metadata publishing.

## Cosa deve essere spostato

- Core API in container self-hostable.
- PostgreSQL su database controllato dal team.
- Portale statico/dinamico separato dal Core.
- Download release su object storage/CDN.
- Bootstrap manifest firmato su endpoint ridondanti.
- Metriche e log su stack indipendente.

## Variabili da introdurre

- `VELORA_PORTAL_URL`
- `VELORA_CORE_ENDPOINTS`
- `VELORA_BOOTSTRAP_ENDPOINTS`
- `VELORA_RELEASE_MANIFEST_URL`
- `VELORA_STATUS_URL`
- `VELORA_OBJECT_STORAGE_URL`

## Export PostgreSQL

1. Mettere Core in maintenance soft se serve consistenza forte.
2. Eseguire backup Heroku Postgres.
3. Esportare dump logico con `pg_dump`.
4. Conservare hash del dump.
5. Verificare che il dump non contenga segreti non necessari.

## Import PostgreSQL

1. Creare database target.
2. Applicare schema/migrazioni.
3. Importare dump.
4. Eseguire smoke test su copia privata.
5. Confrontare conteggi principali: utenti, mailbox, zone, release, indice.

## Cambio endpoint

1. Pubblicare Core nuovo in parallelo.
2. Pubblicare bootstrap manifest firmato con entrambi gli endpoint.
3. Dare priorita al nuovo endpoint.
4. Mantenere Heroku come fallback per una finestra definita.
5. Aggiornare portale e release manifest.

## Rollback

1. Ripubblicare bootstrap manifest con Heroku come endpoint primario.
2. Bloccare scritture sul Core nuovo se necessario.
3. Rieseguire export differenziale se sono state accettate scritture.
4. Documentare motivo e impatto.

## Migrazione senza interrompere client

- Il client deve leggere un bootstrap manifest firmato.
- Il manifest deve contenere endpoint multipli, `issuedAt`, `expiresAt`, `keyId` e `signature`.
- Il client deve cacheare l'ultimo manifest valido e rifiutare manifest scaduti o non firmati.
- Ogni endpoint deve esporre readiness e health.
