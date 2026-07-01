# Velora - Guida ufficiale alla pubblicazione nell'Upper Web

Sottotitolo: Dalla richiesta della zona alla prima release pubblicata

Versione guida: 0.1.0-beta
Data: 2026-07-01

Badge: `Disponibile`, `Beta`, `In preparazione`, `Richiede revisione`, `Non consentito`.

## Indice

1. Cos'e una zona Velora
2. Chi puo pubblicare
3. Requisiti iniziali
4. Creazione account publisher
5. Differenza fra utente e publisher
6. Come richiedere una zona
7. Zone standard
8. Zone riservate
9. Zone di sistema
10. Livelli identita
11. Quando serve Velora SDK
12. Struttura del progetto
13. Cartella dist
14. Manifest velora.json
15. Permessi
16. API esterne consentite
17. File vietati
18. Controlli di sicurezza
19. Publisher Studio
20. Validazione
21. Packaging .vsite
22. Firma della release
23. Invio alla review
24. Significato degli score
25. Modifiche richieste
26. Approvazione
27. Replica sui nodi
28. Pubblicazione
29. Indicizzazione
30. Aggiornamento sito
31. Nuova release
32. Rollback
33. Revoca
34. Sospensione
35. Statistiche
36. Errori comuni
37. FAQ
38. Esempio Livello 0
39. Esempio Livello 1
40. Contatti e assistenza

## 1. Cos'e una zona Velora

Badge: `Beta`

Una zona Velora e un indirizzo dell'Upper Web, per esempio `shop.nomeutente` o `app.progetto`. Il publisher sceglie una zona, Velora verifica manifest e contenuti, poi rende la release apribile dai client.

## 2. Chi puo pubblicare

Badge: `Disponibile`

Puo pubblicare chi ha un account Velora. Durante la beta sono supportati Livello 0 e Livello 1.

## 3. Requisiti iniziali

Badge: `Disponibile`

- Account Velora.
- Desktop Velora beta.
- Cartella sito con `index.html`.
- Manifest `velora.json`.
- Nessun segreto nella cartella pubblicata.

## 4. Creazione account publisher

Badge: `Disponibile`

Il publisher crea un account in Velora Desktop. Velora crea anche una mailbox `@velora` e associa il dispositivo.

## 5. Differenza fra utente e publisher

Badge: `Beta`

Un utente naviga, cerca e usa VeloMail. Un publisher usa anche l'area "Pubblica sito" e invia release.

## 6. Come richiedere una zona

Badge: `Beta`

Nella beta la zona viene creata automaticamente durante la pubblicazione se disponibile e associata all'utente.

## 7. Zone standard

Badge: `Disponibile`

Esempi: `info.nome`, `shop.nome`, `app.nome`, `zone.nome`.

## 8. Zone riservate

Badge: `In preparazione`

Zone di brand, istituzioni e categorie sensibili richiederanno revisione manuale.

## 9. Zone di sistema

Badge: `Non consentito`

Prefissi riservati a Velora non devono essere usati da publisher terzi.

## 10. Livelli identita

Badge: `Beta`

- Livello 0: sito statico, nessun login.
- Livello 1: account Velora e SDK.
- Livello 2: identita forte, in preparazione.
- Livello 3: MFA e operazioni sensibili, in preparazione.

## 11. Quando serve Velora SDK

Badge: `Beta`

Serve per Livello 1 o superiore. Se un sito chiede identita, profilo o VeloMail, deve usare SDK Velora e non form password paralleli.

## 12. Struttura del progetto

Badge: `Disponibile`

```text
dist/
  index.html
  assets/
  velora.json
```

## 13. Cartella dist

Badge: `Disponibile`

La cartella `dist` deve essere gia compilata. Velora non esegue script non fidati sul sistema host.

## 14. Manifest velora.json

Badge: `Disponibile`

Il manifest deve rispettare `schemas/velora-manifest.schema.json`.

## 15. Permessi

Badge: `Beta`

Dichiarare sempre i permessi richiesti: identity, notifications, mail, payments, wallet.

## 16. API esterne consentite

Badge: `Beta`

Le origini esterne devono essere HTTPS e dichiarate in `allowedExternalOrigins`.

## 17. File vietati

Badge: `Disponibile`

Vietati: `.env`, chiavi private, token, password, database locali, `node_modules`, `.git`, cache, log, file temporanei.

## 18. Controlli di sicurezza

Badge: `Beta`

Velora controlla manifest, entrypoint, file vietati, path traversal, origini esterne, login paralleli e permessi.

## 19. Publisher Studio

Badge: `Beta`

Nel desktop l'area "Pubblica sito" guida controllo, preparazione e pubblicazione.

## 20. Validazione

Badge: `Disponibile`

Il publisher seleziona la cartella e preme "Controlla". Errori bloccanti devono essere corretti prima della pubblicazione.

## 21. Packaging .vsite

Badge: `Beta`

Il desktop prepara un pacchetto verificabile con hash dei file. Il formato `.vsite` completo distribuito/P2P e in evoluzione.

## 22. Firma della release

Badge: `Beta`

La release include firma publisher beta. La gestione chiavi production-grade e la rotazione sono in preparazione.

## 23. Invio alla review

Badge: `Beta`

La beta registra la release e applica controlli automatici base. Review manuale completa e in preparazione.

## 24. Significato degli score

Badge: `In preparazione`

Security, privacy, compatibility e manifest score saranno esposti quando gli scanner deterministici saranno completi.

## 25. Modifiche richieste

Badge: `In preparazione`

Le modifiche richieste saranno tracciate per release quando la review manuale sara attiva.

## 26. Approvazione

Badge: `Beta`

Nella beta alcune release possono essere attivate automaticamente. Le zone sensibili richiederanno approvazione manuale.

## 27. Replica sui nodi

Badge: `In preparazione`

La replica P2P completa non e ancora dichiarata disponibile.

## 28. Pubblicazione

Badge: `Beta`

Una pubblicazione beta riuscita rende la zona ricercabile/apribile tramite Core e metadata.

## 29. Indicizzazione

Badge: `Beta`

La ricerca esiste in forma base. L'indexer distribuito e in preparazione.

## 30. Aggiornamento sito

Badge: `Beta`

Pubblicare una nuova versione aggiorna la cronologia release.

## 31. Nuova release

Badge: `Beta`

Incrementare `version` nel manifest e ripetere controllo, preparazione, pubblicazione.

## 32. Rollback

Badge: `In preparazione`

Rollback completo in UI e propagazione indice non sono ancora finali.

## 33. Revoca

Badge: `In preparazione`

Revoca completa client/indice/P2P non ancora finale.

## 34. Sospensione

Badge: `In preparazione`

Sospensione publisher/zona richiede admin RBAC e audit completi.

## 35. Statistiche

Badge: `In preparazione`

Metriche privacy-preserving saranno aggiunte senza raccogliere corpi mail, chiavi o cronologia completa.

## 36. Errori comuni

- `VELORA_MANIFEST_MISSING`: aggiungi `velora.json`.
- `VELORA_ENTRYPOINT_MISSING`: aggiungi `index.html`.
- `VELORA_SECRET_DETECTED`: rimuovi segreti.
- `VELORA_IDENTITY_LEVEL_MISMATCH`: correggi livello o SDK.

## 37. FAQ

No, Velora non sostituisce Internet: lo eleva con zone, identita e pubblicazione verificata.

## 38. Esempio Livello 0

Vedi `examples/publisher/level-0-static`.

## 39. Esempio Livello 1

Vedi `examples/publisher/level-1-account`.

## 40. Contatti e assistenza

Durante la beta usare il portale Velora, la documentazione publisher e i canali di supporto indicati dal team.
