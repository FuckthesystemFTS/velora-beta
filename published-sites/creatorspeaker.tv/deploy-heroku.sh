#!/usr/bin/env bash

set -euo pipefail

APP_BASE="creatorspeaker-tv"
APP_NAME="${HEROKU_APP_NAME:-$APP_BASE}"

if ! command -v heroku >/dev/null 2>&1; then
  echo "Heroku CLI non trovata."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git non trovato."
  exit 1
fi

if [ ! -f package.json ]; then
  echo "Esegui lo script dalla cartella creatorspeaker-tv."
  exit 1
fi

create_app() {
  if heroku apps:info -a "$APP_NAME" >/dev/null 2>&1; then
    echo "Uso app esistente: $APP_NAME"
    return 0
  fi

  if heroku create "$APP_NAME"; then
    return 0
  fi

  local suffix
  suffix="$(date +%s | tail -c 5)"
  APP_NAME="${APP_BASE}-${suffix}"
  heroku create "$APP_NAME"
}

create_app

heroku addons:create heroku-postgresql:essential-0 -a "$APP_NAME" || true

heroku config:set NODE_ENV=production -a "$APP_NAME"
heroku config:set SESSION_SECRET="${SESSION_SECRET:-change-me-on-heroku}" -a "$APP_NAME"
heroku config:set ADMIN_INITIAL_USERNAME="admin" -a "$APP_NAME"
heroku config:set ADMIN_INITIAL_PASSWORD="CreatorSpeakerTV!2026-ChangeMe" -a "$APP_NAME"
heroku config:set SITE_NAME="creatorspeaker TV" -a "$APP_NAME"
heroku config:set RUN_AUTOMATIONS=true -a "$APP_NAME"
heroku config:set SUBSCRIPTIONS_ENABLED=true -a "$APP_NAME"
heroku config:set CLOUDINARY_FOLDER="${CLOUDINARY_FOLDER:-creatorspeaker}" -a "$APP_NAME"
heroku config:set TELEGRAM_ENABLED=false -a "$APP_NAME"
heroku config:set FACEBOOK_ENABLED=false -a "$APP_NAME"
heroku config:set AMAZON_PROVIDER=demo -a "$APP_NAME"
heroku config:set BANK_ACCOUNT_HOLDER="CreatorSpeaker TV" -a "$APP_NAME"
heroku config:set BANK_IBAN="INSERISCI_IBAN_REALE" -a "$APP_NAME"
heroku config:set BANK_CAUSAL_PREFIX="Ordine creatorspeaker TV" -a "$APP_NAME"

npm install

if [ ! -d .git ]; then
  git init
fi

git add .
git commit -m "Initial creatorspeaker TV platform" || true
heroku git:remote -a "$APP_NAME"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "HEAD" ]; then
  BRANCH="main"
fi

git push heroku "$BRANCH":main
heroku open -a "$APP_NAME" || true

echo ""
echo "Deploy completato."
echo "URL finale:"
heroku info -a "$APP_NAME" | grep "Web URL" || true
echo ""
echo "Credenziali admin iniziali:"
echo "username: admin"
echo "password: CreatorSpeakerTV!2026-ChangeMe"
echo ""
echo "Da configurare manualmente:"
echo "- IBAN reale"
echo "- token Telegram"
echo "- token Facebook"
echo "- credenziali Amazon"
echo "- logo reale"
