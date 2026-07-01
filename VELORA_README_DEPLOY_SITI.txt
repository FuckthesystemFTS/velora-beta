VELORA - README OPERATIVO PER SVILUPPATORI E CODEX
Aggiornato: 1 luglio 2026

OBIETTIVO
Questo file serve agli sviluppatori che vogliono preparare un sito/app e pubblicarlo su Velora usando la beta attuale. Contiene le istruzioni operative da dare anche a un agente Codex che lavora su un progetto esterno.

URL BETA E API
Base URL pubblico:
https://velora-beta-20260629-9a9196313b42.herokuapp.com

Endpoint principali:
- GET  /health
- GET  /release-manifest.json
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- GET  /api/v1/account
- POST /api/v1/identity/verify-basic
- POST /api/v1/mail/send
- GET  /api/v1/mail/inbox
- GET  /api/v1/mail/sent
- POST /api/v1/sites/register-release
- GET  /api/v1/sites/releases/:address
- GET  /api/v1/search?q=...

ACCOUNT UNIFICATO VELORA
1. Registrare un account:
   POST /api/v1/auth/register
   Body JSON:
   {
     "username": "nome-sviluppatore",
     "password": "password-sicura"
   }

2. La risposta contiene:
   - user.id
   - user.username
   - user.identityLevel
   - mail.address
   - mail.identityLevel

3. Conservare user.id. Nella beta attuale molte API richiedono l'header:
   x-user-id: <user.id>

4. Login successivo:
   POST /api/v1/auth/login
   Body JSON:
   {
     "username": "nome-sviluppatore",
     "password": "password-sicura"
   }

5. Verifica identita base:
   POST /api/v1/identity/verify-basic
   Header:
   x-user-id: <user.id>
   Body JSON:
   {}

Nota: la verifica identita forte con documento/liveness/revisione non e ancora la versione finale. Per ora verify-basic abilita il livello beta necessario ai flussi iniziali.

STRUTTURA MINIMA DI UN SITO VELORA
Ogni sito da pubblicare deve essere una cartella locale con almeno:
- index.html
- velora.json
- eventuali asset statici: CSS, JS, immagini, font, dati statici

Esempio velora.json:
{
  "address": "shop.nomeutente",
  "title": "Nome sito",
  "description": "Descrizione breve",
  "category": "Shop",
  "version": "0.1.0"
}

Regole consigliate:
- Usare address in minuscolo.
- Evitare spazi nell'address.
- Usare prefissi chiari: shop.nome, app.nome, zone.nome.
- Non includere segreti, token, .env, chiavi private o database locali nella cartella pubblicata.
- Il sito deve funzionare come static build: aprendo index.html deve caricare asset relativi o inclusi.

COME PREPARARE UN PROGETTO WEB ESISTENTE
Per React/Vite/Next static export o simili:
1. Generare la build statica del progetto.
2. Copiare dentro la cartella finale un file velora.json.
3. Verificare che index.html esista nella root della cartella da pubblicare.
4. Evitare chiamate hardcoded a localhost.
5. Usare API HTTPS pubbliche o API Velora.

Per Vite:
1. npm run build oppure pnpm build.
2. Pubblicare la cartella dist.
3. Inserire dist/velora.json.

Per siti statici semplici:
1. Creare index.html.
2. Aggiungere velora.json.
3. Mettere asset in sottocartelle.

PUBBLICAZIONE DA DESKTOP VELORA
1. Installare/aprire Velora beta.
2. Creare account o fare login.
3. Entrare in "Pubblica sito".
4. Inserire la zona, per esempio:
   shop.nomeutente
5. Inserire la cartella progetto, per esempio:
   C:\Users\Hp\Desktop\mio-sito\dist
6. Premere "Controlla".
7. Se la validazione passa, premere "Prepara".
8. Premere "Pubblica".
9. Cercare la zona in Velora.

PUBBLICAZIONE VIA API
La beta desktop crea localmente il pacchetto firmabile e poi chiama /api/v1/sites/register-release.
Per integrazioni esterne serve inviare un payload compatibile con PublisherPackageResponse. In pratica deve includere:
- address
- title
- description
- category
- version
- publisherPublicKey
- contentCid
- manifestHash
- packageHash
- signature
- files/chunks se previsti dal pacchetto
- userId

Header richiesto:
content-type: application/json

Body semplificato:
{
  "address": "shop.nomeutente",
  "title": "Nome sito",
  "description": "Descrizione breve",
  "category": "Shop",
  "version": "0.1.0",
  "publisherPublicKey": "<public-key>",
  "contentCid": "<cid>",
  "manifestHash": "<hash>",
  "packageHash": "<hash>",
  "signature": "<signature>",
  "userId": "<user-id>"
}

Nota: nella beta attuale e consigliato pubblicare via desktop, perche il desktop calcola hash, pacchetto e firma locale in modo coerente con l'API.

VELOMAIL
Ogni account registrato riceve una mailbox:
<username>@velora

Invio:
POST /api/v1/mail/send
Header:
x-user-id: <user.id>
Body:
{
  "to": ["destinatario@velora"],
  "subject": "Oggetto",
  "body": "Messaggio"
}

Inbox:
GET /api/v1/mail/inbox
Header:
x-user-id: <user.id>

Sent:
GET /api/v1/mail/sent
Header:
x-user-id: <user.id>

ISTRUZIONI DA DARE A CODEX SU UN PROGETTO ESTERNO
Prompt consigliato:

"Prepara questo progetto per la pubblicazione su Velora beta. Non cambiare la logica principale del sito. Genera una build statica funzionante, assicurati che esista index.html nella cartella finale, crea velora.json con address/title/description/category/version, rimuovi riferimenti a localhost e segreti, poi indicami la cartella esatta da selezionare in Velora Desktop nella sezione Pubblica sito."

Checklist per Codex:
- Identificare framework e comando build.
- Eseguire install/build solo se necessario.
- Non includere .env, chiavi, token, database, cartelle node_modules o file temporanei nella pubblicazione.
- Creare velora.json nella cartella finale.
- Verificare che index.html punti ad asset esistenti.
- Verificare dimensioni ragionevoli degli asset.
- Restituire address consigliato e path completo della cartella da pubblicare.

LIMITI ATTUALI DELLA BETA
- macOS non e ancora disponibile come pacchetto pubblico finche GitHub o altro CI non fornisce runner macOS funzionante.
- Firma codice Windows non ancora attiva.
- Notarizzazione Apple non ancora attiva.
- Identita forte non ancora completa.
- Moderazione contenuti e revisione manuale non ancora complete.
- Content store/chunking/P2P sono in avanzamento, non ancora layer finale.
- Search/index e ranking sono base beta, non motore definitivo.
- API auth attuale usa userId in header per alcune funzioni beta; il passaggio successivo e token/sessione firmata production-grade.

CHECK FINALE PRIMA DI PUBBLICARE UN SITO
- Ho un account Velora e sono loggato.
- Ho verificato l'identita base.
- La cartella contiene index.html.
- La cartella contiene velora.json.
- L'address in velora.json coincide con quello scelto in Velora Desktop.
- Non sto pubblicando segreti o dati privati.
- Ho premuto Controlla, Prepara e Pubblica senza errori.
- Ho cercato la zona da Velora dopo la pubblicazione.

RISULTATO ATTESO
Il sito deve comparire nella ricerca Velora o aprirsi inserendo direttamente la zona, per esempio:
shop.nomeutente

CONTATTI OPERATIVI INTERNI
Per aggiornare la beta pubblica:
- Rigenerare build desktop.
- Rigenerare MSI.
- Aggiornare releases/beta/windows.
- Aggiornare release-manifest.json.
- Deploy Heroku.
- Verificare health, manifest, download e SHA-256 pubblico.
