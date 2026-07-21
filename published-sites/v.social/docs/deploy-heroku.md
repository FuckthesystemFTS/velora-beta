# Heroku deploy checklist (prepared, not executed)

## 1) Login and app creation

```bash
heroku login
heroku create <your-app-name>
```

## 2) Add Postgres

```bash
heroku addons:create heroku-postgresql:essential-0 -a <your-app-name>
```

## 3) Configure env vars

```bash
heroku config:set APP_URL=https://<your-app-name>.herokuapp.com -a <your-app-name>
heroku config:set SESSION_COOKIE_NAME=v_session -a <your-app-name>
heroku config:set SESSION_TTL_HOURS=336 -a <your-app-name>

heroku config:set CLOUDINARY_CLOUD_NAME=<cloud_name> -a <your-app-name>
heroku config:set CLOUDINARY_API_KEY=<api_key> -a <your-app-name>
heroku config:set CLOUDINARY_API_SECRET=<api_secret> -a <your-app-name>

heroku config:set SMTP_HOST=smtp.gmail.com -a <your-app-name>
heroku config:set SMTP_PORT=587 -a <your-app-name>
heroku config:set SMTP_USER=<gmail_account> -a <your-app-name>
heroku config:set SMTP_PASS=<gmail_app_password> -a <your-app-name>
heroku config:set SMTP_FROM="V <no-reply@your-domain>" -a <your-app-name>
```

## 4) Deploy

```bash
git push heroku main
```

The `release` phase runs Prisma migrations automatically (`Procfile`).

## 5) Verify

```bash
heroku open -a <your-app-name>
heroku logs --tail -a <your-app-name>
curl https://<your-app-name>.herokuapp.com/api/health
```
