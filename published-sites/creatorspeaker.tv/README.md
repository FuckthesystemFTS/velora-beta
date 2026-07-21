# creatorspeaker TV

Piattaforma web mobile-first e deployabile separatamente da `sitoinstrada.it`, con:

- sito pubblico commerciale Creator & Speaker Network
- carrello locale e checkout con bonifico
- area riservata utenti
- upload contenuti
- video studio foto + audio con crediti
- area admin completa
- modulo offerte Amazon in modalita demo/manuale
- pubblicazione Telegram/Facebook con configurazione separata
- scheduler automatico tollerante a integrazioni mancanti

## Stack

- Node.js 20
- Express
- EJS
- PostgreSQL se `DATABASE_URL` presente
- SQLite fallback locale con `better-sqlite3`
- `express-session` e `connect-pg-simple`
- `bcrypt`
- `multer`
- `helmet`
- `express-rate-limit`
- `node-cron`
- `qrcode`
- `fluent-ffmpeg` + `ffmpeg-static`

## Avvio locale

```bash
npm install
npm run check:public
npm run db:migrate
npm run seed
npm start
```

URL locali:

```text
http://localhost:3000
http://localhost:3000/health
```

## Credenziali iniziali

Admin:

```text
username: admin
password: CreatorSpeakerTV!2026-ChangeMe
```

Utente demo:

```text
email: demo@creatorspeaker.local
password: DemoUser!2026
```

## Script

```bash
npm start
npm run dev
npm run seed
npm run db:migrate
npm run check:public
npm run deploy:heroku
```

## Variabili ambiente

Parti da `.env.example`.

## Deploy Heroku separato

Nome app base:

```text
creatorspeaker-tv
```

Se non disponibile:

```text
creatorspeaker-tv-XXXX
```

Comandi:

```bash
heroku login
heroku create creatorspeaker-tv
```

Se il nome non e disponibile:

```bash
heroku create creatorspeaker-tv-XXXX
```

PostgreSQL:

```bash
heroku addons:create heroku-postgresql:essential-0 -a NOME_APP
```

Config base:

```bash
heroku config:set NODE_ENV=production -a NOME_APP
heroku config:set SESSION_SECRET="INSERISCI-SEGRETO-LUNGO-CASUALE" -a NOME_APP
heroku config:set ADMIN_INITIAL_USERNAME="admin" -a NOME_APP
heroku config:set ADMIN_INITIAL_PASSWORD="CreatorSpeakerTV!2026-ChangeMe" -a NOME_APP
heroku config:set SITE_NAME="creatorspeaker TV" -a NOME_APP
heroku config:set RUN_AUTOMATIONS=true -a NOME_APP
```

Bonifico:

```bash
heroku config:set BANK_ACCOUNT_HOLDER="CreatorSpeaker TV" -a NOME_APP
heroku config:set BANK_IBAN="INSERISCI_IBAN_REALE" -a NOME_APP
heroku config:set BANK_CAUSAL_PREFIX="Ordine creatorspeaker TV" -a NOME_APP
```

Telegram:

```bash
heroku config:set TELEGRAM_ENABLED=true -a NOME_APP
heroku config:set TELEGRAM_BOT_TOKEN="INSERISCI_TOKEN_BOT" -a NOME_APP
heroku config:set TELEGRAM_CHANNEL_ID="@NOME_CANALE_O_ID" -a NOME_APP
```

Facebook:

```bash
heroku config:set FACEBOOK_ENABLED=true -a NOME_APP
heroku config:set FACEBOOK_PAGE_ID="INSERISCI_PAGE_ID" -a NOME_APP
heroku config:set FACEBOOK_PAGE_ACCESS_TOKEN="INSERISCI_PAGE_ACCESS_TOKEN" -a NOME_APP
heroku config:set FACEBOOK_PAGE_URL="INSERISCI_URL_PAGINA_FACEBOOK" -a NOME_APP
```

Amazon:

```bash
heroku config:set AMAZON_PROVIDER=creators_api -a NOME_APP
heroku config:set AMAZON_ASSOCIATE_TAG="INSERISCI_ASSOCIATE_TAG" -a NOME_APP
heroku config:set AMAZON_TRACKING_ID="INSERISCI_TRACKING_ID" -a NOME_APP
heroku config:set AMAZON_MARKETPLACE=IT -a NOME_APP
heroku config:set AMAZON_API_CREDENTIAL_ID="INSERISCI_CREDENTIAL_ID" -a NOME_APP
heroku config:set AMAZON_API_CREDENTIAL_SECRET="INSERISCI_CREDENTIAL_SECRET" -a NOME_APP
heroku config:set AMAZON_API_REGION=EU -a NOME_APP
```

Deploy:

```bash
git add .
git commit -m "Fix public admin leak and improve responsive UI"
heroku git:remote -a NOME_APP
git push heroku main
```

Se branch `master`:

```bash
git push heroku master
```

Apri e log:

```bash
heroku open -a NOME_APP
heroku logs --tail -a NOME_APP
```

## Script deploy automatico

```bash
bash deploy-heroku.sh
```

Lo script:

- verifica Heroku CLI e Git
- crea app separata `creatorspeaker-tv`
- prova ad aggiungere PostgreSQL senza bloccare il deploy
- imposta config base
- esegue commit separato
- pusha su Heroku
- stampa URL finale e promemoria configurazioni mancanti

## Test manuali consigliati

Verifica dopo `npm start`:

- `GET /health` risponde con `ok: true`
- `npm run check:public` passa senza leak
- homepage visibile e responsive
- homepage pubblica senza riferimenti admin
- pacchetti visibili e pulsanti carrello funzionanti
- `/cart` e `/checkout` leggono il carrello locale
- checkout crea ordine e pagina `/order/:orderCode`
- login admin funzionante
- `/admin/login` separato e protetto
- cambio password admin funzionante
- pannello ordini funzionante
- registrazione utente e login funzionanti
- dashboard utente pulita e separata da admin
- upload contenuti funzionante
- video studio scala crediti e crea output MP4 se ffmpeg e disponibile
- `/offerte` mostra offerte demo approvate
- Telegram/Facebook non rompono app se non configurati
- privacy/cookie/termini visibili
- nessuna credenziale esposta nel frontend

## Note operative

- Nessuna collisione con `sitoinstrada.it`: questo progetto va deployato come app Heroku separata.
- Il sito pubblico non mostra link o riferimenti admin.
- Nessun SMTP e nessun recupero password via email.

## Credenziali/API necessarie per attivare tutte le funzioni reali

### A. Credenziali base piattaforma

- `SESSION_SECRET`
  Serve per firmare le sessioni.
  Variabile: `SESSION_SECRET`

- `DATABASE_URL`
  Serve per PostgreSQL in produzione.
  Variabile: `DATABASE_URL`
  Su Heroku viene creata dall'add-on PostgreSQL.

- `ADMIN_INITIAL_USERNAME`
  Username primo admin.
  Variabile: `ADMIN_INITIAL_USERNAME`

- `ADMIN_INITIAL_PASSWORD`
  Password primo admin.
  Variabile: `ADMIN_INITIAL_PASSWORD`

### B. Bonifico bancario

- `BANK_ACCOUNT_HOLDER`
  Intestatario conto.

- `BANK_IBAN`
  IBAN reale.

- `BANK_CAUSAL_PREFIX`
  Prefisso causale ordine.

Queste non sono API, ma sono necessarie per rendere reali gli ordini tramite bonifico.

### C. Telegram

Per pubblicare automaticamente su Telegram servono:

- `TELEGRAM_ENABLED=true`
- `TELEGRAM_BOT_TOKEN`
  Token del bot creato con BotFather.
- `TELEGRAM_CHANNEL_ID`
  ID del canale o username canale, per esempio `@nomecanale`.
- Il bot deve essere aggiunto come amministratore del canale.
- Il bot deve avere permesso di pubblicare messaggi e foto.

Variabili Heroku:

```bash
heroku config:set TELEGRAM_ENABLED=true -a NOME_APP
heroku config:set TELEGRAM_BOT_TOKEN="INSERISCI_TOKEN_BOT" -a NOME_APP
heroku config:set TELEGRAM_CHANNEL_ID="@NOME_CANALE_O_ID" -a NOME_APP
```

### D. Facebook / Meta

Per pubblicare sulla pagina Facebook servono:

- `FACEBOOK_ENABLED=true`
- `FACEBOOK_PAGE_ID`
  ID numerico della pagina.
- `FACEBOOK_PAGE_ACCESS_TOKEN`
  Page Access Token con permessi validi per pubblicare sulla pagina.
- `FACEBOOK_PAGE_URL`
  URL pubblico della pagina.

Permessi e condizioni:

- la pagina deve essere gestita dall'account che genera il token
- l'app Meta deve avere i permessi necessari alla pubblicazione sulla pagina
- il token deve essere valido e non scaduto
- Meta può richiedere configurazione app e review dei permessi

Variabili Heroku:

```bash
heroku config:set FACEBOOK_ENABLED=true -a NOME_APP
heroku config:set FACEBOOK_PAGE_ID="INSERISCI_PAGE_ID" -a NOME_APP
heroku config:set FACEBOOK_PAGE_ACCESS_TOKEN="INSERISCI_PAGE_ACCESS_TOKEN" -a NOME_APP
heroku config:set FACEBOOK_PAGE_URL="INSERISCI_URL_PAGINA" -a NOME_APP
```

### E. Amazon Affiliati / Creators API

Per cercare prodotti e offerte Amazon in modo reale e lecito, usare API ufficiali.

Non usare scraping.

Servono:

- `AMAZON_PROVIDER=creators_api` oppure `demo`/`manual`
- `AMAZON_ASSOCIATE_TAG`
  Tag affiliato o tracking ID usato nei link.
- `AMAZON_TRACKING_ID`
  Tracking ID Amazon Associates, se diverso dal tag principale.
- `AMAZON_MARKETPLACE=IT`
- `AMAZON_API_CREDENTIAL_ID`
  Credential ID o client id fornita da Amazon.
- `AMAZON_API_CREDENTIAL_SECRET`
  Secret associato alla credenziale.
- `AMAZON_API_REGION=EU`

Variabili Heroku:

```bash
heroku config:set AMAZON_PROVIDER=creators_api -a NOME_APP
heroku config:set AMAZON_ASSOCIATE_TAG="INSERISCI_ASSOCIATE_TAG" -a NOME_APP
heroku config:set AMAZON_TRACKING_ID="INSERISCI_TRACKING_ID" -a NOME_APP
heroku config:set AMAZON_MARKETPLACE=IT -a NOME_APP
heroku config:set AMAZON_API_CREDENTIAL_ID="INSERISCI_CREDENTIAL_ID" -a NOME_APP
heroku config:set AMAZON_API_CREDENTIAL_SECRET="INSERISCI_CREDENTIAL_SECRET" -a NOME_APP
heroku config:set AMAZON_API_REGION=EU -a NOME_APP
```

Nota importante:

> La piattaforma non deve fare scraping Amazon. Se le credenziali Amazon ufficiali non sono disponibili, il sistema resta in modalità demo/manuale: l'admin può inserire offerte manualmente e pubblicarle su Telegram/Facebook.

### F. Video studio

Per la funzione video foto + audio non servono API esterne.

Servono solo:

- `ffmpeg-static` installato come dipendenza
- spazio file temporaneo
- crediti utente

Nota Heroku:

Lo storage locale di Heroku può essere effimero. Per una produzione reale futura è consigliato uno storage esterno S3-compatible, anche se questa prima versione funziona in locale e in demo Heroku.

### G. Servizi email

- Non integrare SMTP
- Non integrare recupero password
- Le email restano simulate come log interno
