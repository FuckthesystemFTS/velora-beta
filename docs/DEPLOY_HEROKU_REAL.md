# Deploy Heroku Real

Current state: `BLOCKED_BY_EXTERNAL_CONFIGURATION`

Already present in repo:

- `Procfile`
- `heroku.yml`
- `Dockerfile`
- `scripts/run-migrations.mjs`

Still required externally:

- Heroku app
- Heroku Postgres
- production `DATABASE_URL`
- production signing keys
- production S3 bucket and credentials

Commands:

```powershell
heroku login
heroku create velora-beta
heroku addons:create heroku-postgresql:essential-0
heroku config:set NODE_ENV=production
heroku config:set DATABASE_URL=...
heroku config:set MEMBERSHIP_SIGNING_PRIVATE_KEY_BASE64=...
heroku config:set ZONE_REGISTRY_SIGNING_PRIVATE_KEY_BASE64=...
heroku config:set RELEASE_SIGNING_PRIVATE_KEY_BASE64=...
heroku config:set CONTROL_API_SERVER_SIGNING_PRIVATE_KEY_BASE64=...
heroku config:set S3_ENDPOINT=...
heroku config:set S3_BUCKET=...
heroku config:set S3_ACCESS_KEY_ID=...
heroku config:set S3_SECRET_ACCESS_KEY=...
git push heroku HEAD:main
heroku run node scripts/run-migrations.mjs
heroku open
```
