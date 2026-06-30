# Velora Distribution UX Audit

Data audit: 2026-06-30

## Stato precedente osservato

| Funzione | Stato | Nota |
| --- | --- | --- |
| Home utente | WRONG_LOCATION | La home era una console tecnica con browser, nodo, publisher e admin insieme. |
| Barra Upper Web | PARTIAL | `shop.demo` era apribile, ma con controlli provvisori e bottone `Apri`. |
| Ricerca | PARTIAL | Collegata al backend, ma mostrava JSON tecnico e stati vuoti non leggibili. |
| Viewer zona | PARTIAL | WebView locale funzionante, ma non isolato in una modalita navigazione dedicata. |
| Inizializzazione nodo | TECHNICAL_ONLY | Richiedeva pulsante manuale e mostrava SQLite, peer id e percorsi. |
| Device enrollment | TECHNICAL_ONLY | Esposto come comando con `User ID beta`. |
| Publisher Studio | WRONG_LOCATION | Funzionante ma mischiato alla home normale e basato su path Windows. |
| Release flow activate/revoke/rollback | COMPLETE | API e UI tecnica presenti, da spostare in Velora Dev. |
| Control Center | WRONG_LOCATION | Visibile nel menu normale e non separato da sessione admin. |
| Diagnostica | WRONG_LOCATION | Dettagli tecnici in home invece che in Impostazioni avanzate. |
| Portale Heroku `/` | PARTIAL | Backend vivo e download funzionante, mancava homepage pubblica narrativa. |
| Download MSI | COMPLETE | MSI pubblico e checksum SHA-256 disponibili. |
| Identity Levels | MISSING | Regole non rappresentate in UI/SDK. |
| Publisher plans | MISSING | Piani non rappresentati in UI. |
| Review workflow | PARTIAL | Stati release presenti; mancava workflow editoriale completo. |
| SDK Velora | MISSING | Nessun pacchetto `packages/velora-sdk`. |
| Zone riservate/sistema | PARTIAL | Logica di base presente nel backend, mancava presentazione prodotto. |

## Nuova architettura informativa

| Ambiente | Stato | Scopo |
| --- | --- | --- |
| VELORA | COMPLETE | Home, ricerca, esplora, preferiti, attivita, identita, notifiche, impostazioni. |
| VELORA DEV | PARTIAL | Workspace publisher separato con Studio guidato, piani, review e release. |
| VELORA CONTROL CENTER | PARTIAL | Non visibile agli utenti normali; predisposto per sessione admin reale. |
| Diagnostica avanzata | COMPLETE | Dettagli tecnici spostati in Impostazioni avanzate. |

## Placeholder dichiarati

- Identity Level 2 e 3: UI, tipi e feature flag; nessuna KYC o custodia reale.
- Pagamenti e wallet: capability API con `NOT_YET_AVAILABLE`.
- Control Center completo: struttura predisposta; visibilita desktop disattivata per utenti normali.
- Achievement Folletto: slot UI neutro; nessun asset definitivo inventato.
