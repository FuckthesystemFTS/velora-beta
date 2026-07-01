# Velora Publisher Specification

Versione: 0.1.0-beta
Data: 2026-07-01

Legenda normativa: `MUST` = obbligatorio, `MUST NOT` = vietato, `SHOULD` = raccomandato, `MAY` = opzionale.

## 1. Input

Un publisher `MUST` fornire una cartella `dist` o equivalente con:

- `index.html`
- `velora.json`
- asset statici necessari

Un publisher `MUST NOT` includere segreti, `.env`, chiavi private, database locali, `node_modules`, `.git`, cache, log o file temporanei.

## 2. Manifest

`velora.json` `MUST` rispettare `schemas/velora-manifest.schema.json`.

Campi minimi:

- `formatVersion`
- `address`
- `title`
- `description`
- `version`
- `category`
- `entrypoint`
- `requiredIdentityLevel`
- `usesVeloraSdk`
- `permissions`
- `allowedExternalOrigins`
- `visibility`
- `familySafe`

## 3. Livelli identita

- Livello 0 `MUST` essere statico e `MUST NOT` usare login paralleli o dati personali.
- Livello 1 `MUST` usare account Velora e SDK Velora per sessione e profilo base.
- Livello 2 e 3 `MUST NOT` essere pubblicizzati come disponibili finche verifica forte, MFA e review umana non sono operative.

## 4. SDK

I siti Livello 1+ `MUST` usare Velora SDK per sessione utente. Login/password paralleli `MUST NOT` essere presenti.

Funzioni non disponibili `MUST` restituire:

```json
{ "available": false, "status": "NOT_YET_AVAILABLE" }
```

## 5. Packaging

Il packaging `.vsite` `MUST`:

- normalizzare percorsi
- ordinare file in modo deterministico
- escludere file vietati
- calcolare hash per ogni file
- calcolare manifest hash e package hash
- proteggere da path traversal
- proteggere da zip bomb
- produrre output riproducibile a parita di input

## 6. Review

Il validatore `MUST` produrre errori bloccanti, warning, informazioni e suggerimenti.

Ogni finding `MUST` avere:

- codice stabile
- severita
- file
- posizione quando disponibile
- spiegazione
- correzione suggerita

Codici minimi:

- `VELORA_MANIFEST_MISSING`
- `VELORA_ENTRYPOINT_MISSING`
- `VELORA_SECRET_DETECTED`
- `VELORA_EXTERNAL_ORIGIN_UNDECLARED`
- `VELORA_IDENTITY_LEVEL_MISMATCH`
- `VELORA_PARALLEL_LOGIN_FORBIDDEN`
- `VELORA_PRIVATE_KEY_DETECTED`
- `VELORA_PACKAGE_TOO_LARGE`

## 7. Release lifecycle

Stati normativi:

`DRAFT`, `VALIDATING`, `PACKAGING`, `SUBMITTED`, `AUTOMATED_REVIEW`, `MANUAL_REVIEW`, `CHANGES_REQUIRED`, `APPROVED`, `PUBLISHING`, `PUBLISHED`, `SUSPENDED`, `REVOKED`, `ROLLED_BACK`.

Una release `MUST NOT` essere considerata completa se e solo registrata in PostgreSQL. Deve essere pacchettizzata, firmata, approvata, replicata e indicizzata.

## 8. API beta

Durante la beta il desktop e il Core espongono un flusso ridotto. Le integrazioni esterne `SHOULD` usare Velora Desktop per packaging e pubblicazione finche il formato `.vsite` e la firma non sono stabilizzati.

## 9. Errori

Gli errori `MUST` essere stabili e documentati. Il validatore `MUST NOT` restituire soltanto testo libero.

## 10. Output

Una pubblicazione riuscita `MUST` produrre:

- release id
- address
- versione
- stato
- package hash
- manifest hash
- firma publisher
- metadata indicizzabili
