# Codex Template - Publish To Velora

Usa questo prompt in un progetto Web esterno.

```text
Prepara PROJECT_PATH per la pubblicazione su Velora beta.

Parametri:
- PROJECT_PATH: PROJECT_PATH
- ZONE_NAME: ZONE_NAME
- CATEGORY: CATEGORY
- IDENTITY_LEVEL: IDENTITY_LEVEL
- PUBLISHER_ID: PUBLISHER_ID
- VERSION: VERSION
- VISIBILITY: VISIBILITY
- PERMISSIONS: PERMISSIONS

Regole:
- Non pubblicare senza autorizzazione esplicita.
- Non eseguire codice non fidato fuori sandbox.
- Non includere segreti, .env, chiavi private, database locali, node_modules, .git, cache o log.
- Non aggiungere login/password paralleli se IDENTITY_LEVEL e 1 o superiore.
- Se il sito richiede account, integra Velora SDK e usa la sessione Velora.
- Se una funzione Velora non e disponibile, mostra stato NOT_YET_AVAILABLE senza fingere disponibilita.

Azioni richieste:
1. Analizza framework, build command e output statico.
2. Determina il livello identita corretto.
3. Genera o aggiorna la build dist.
4. Crea velora.json conforme allo schema Velora.
5. Controlla index.html, asset, link relativi e origini esterne.
6. Rimuovi segreti e file vietati dalla cartella pubblicabile.
7. Verifica che non ci siano chiamate hardcoded a localhost.
8. Produci un report con errori bloccanti, warning e path finale da selezionare in Velora Desktop.

Output finale richiesto:
- Cartella esatta da pubblicare.
- Contenuto finale di velora.json.
- Livello identita scelto e motivazione.
- Lista file esclusi.
- Lista problemi ancora da correggere.
```
