# HappyMeter / Feliciometro

Web app mobile first per osservare benessere percepito, abitudini, attivita felici e andamento personale attraverso prepagine introduttive, test pubblico, test quotidiano e insight in italiano e inglese

## Stack

- Node.js 20
- Express
- EJS con `express-ejs-layouts`
- CSS custom e JavaScript vanilla
- PostgreSQL se `DATABASE_URL` e disponibile
- SQLite locale come fallback
- Chart.js via CDN

## Route principali

- Pubbliche: `/welcome`, `/welcome/2`, `/`, `/splash`, `/login`, `/register`, `/test`, `/daily-test`, `/privacy`, `/cookie`, `/terms`, `/health`
- Protette: `/app`, `/app/today`, `/app/activities`, `/app/diary`, `/app/insights`, `/app/community`, `/app/badges`, `/app/profile`, `/app/premium`

## Base metodologica del Feliciometro

HappyMeter non e uno strumento medico. Il suo calcolatore e ispirato a modelli riconosciuti nel campo del benessere soggettivo, tra cui WHO-5, Satisfaction With Life Scale, PANAS e PERMA. La formula usata nell app e una sintesi pratica e non diagnostica pensata per aiutare l utente a osservare abitudini, emozioni e andamento personale

## Come funziona Happy Score

- I valori giornalieri arrivano da slider 1-10 su felicita, energia, sonno, stress, umore, movimento, relazioni, gratitudine, significato e soddisfazione della giornata
- Lo stress viene trattato in modo inverso
- Sono previsti bonus positivi per gesto felice, attivita felici e nota di gratitudine
- Lo score finale resta sempre tra 0 e 100
- Gli insight diventano piu ricchi con il crescere dei dati salvati
- HappyMeter non formula diagnosi e non sostituisce professionisti sanitari

## Lingue abilitate

- Italiano
- English

## Avvio locale

```bash
npm install
npm start
```

## Smoke test locale

```bash
npm run smoke
```

## Email transazionali

HappyMeter usa la casella `info@happymeter.it` per email di benvenuto e recupero password

Parametri SMTP Register.it:

- Host: `authsmtp.securemail.pro`
- Porta: `465`
- Sicurezza: SSL
- Username: `info@happymeter.it`
- Mittente: `info@happymeter.it`

Variabili ambiente richieste:

```bash
SMTP_HOST=authsmtp.securemail.pro
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@happymeter.it
SMTP_PASS=
MAIL_FROM=info@happymeter.it
MAIL_REPLY_TO=info@happymeter.it
PRIVACY_EMAIL=info@happymeter.it
```

Test invio email:

```bash
npm run check:mail
```

## SEO

Il progetto e ottimizzato tecnicamente per SEO, ma il posizionamento dipende da contenuti, autorevolezza, indicizzazione e tempo

## Configurazione dominio www.happymeter.it su Register.it

1. Aggiungere il dominio su Heroku
2. Copiare il DNS Target da `heroku domains`
3. Entrare in Register.it
4. Aprire la gestione DNS del dominio `happymeter.it`
5. Creare o modificare il record CNAME
   Host: `www`
   Valore: DNS target Heroku
   TTL: `3600` o default
6. Salvare
7. Attendere la propagazione DNS
8. Controllare `heroku certs:auto -a happymeter-feliciometro`
9. Aprire `https://www.happymeter.it`
