#!/usr/bin/env bash
set -euo pipefail

EXPECTED_DIR="happymeter-feliciometro"
BASE_APP_NAME="happymeter-feliciometro"
SESSION_SECRET_VALUE="${SESSION_SECRET_VALUE:-change-me-with-a-long-random-string}"
ADMIN_USER="${ADMIN_INITIAL_USERNAME:-admin}"
ADMIN_PASS="${ADMIN_INITIAL_PASSWORD:-HappyMeter!2026-ChangeMe}"

if [[ "$(basename "$PWD")" != "$EXPECTED_DIR" ]]; then
  echo "Run this script only inside $EXPECTED_DIR"
  exit 1
fi

if ! command -v heroku >/dev/null 2>&1; then
  echo "Heroku CLI not found."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git not found."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found."
  exit 1
fi

APP_NAME="${HEROKU_APP_NAME:-$BASE_APP_NAME}"

create_app() {
  if heroku create "$APP_NAME" >/tmp/happymeter-heroku-create.log 2>&1; then
    return 0
  fi

  local suffix
  suffix="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 4)"
  APP_NAME="${BASE_APP_NAME}-${suffix}"
  heroku create "$APP_NAME"
}

create_app

heroku config:set NODE_ENV=production -a "$APP_NAME"
heroku config:set SESSION_SECRET="$SESSION_SECRET_VALUE" -a "$APP_NAME"
heroku config:set ADMIN_INITIAL_USERNAME="$ADMIN_USER" -a "$APP_NAME"
heroku config:set ADMIN_INITIAL_PASSWORD="$ADMIN_PASS" -a "$APP_NAME"
heroku config:set SITE_NAME="HappyMeter" -a "$APP_NAME"

heroku addons:create heroku-postgresql:essential-0 -a "$APP_NAME" || true

npm install
npm run seed || true

if [[ ! -d .git ]]; then
  git init
  git branch -M main
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "Initial HappyMeter Feliciometro app"
fi

if git remote get-url heroku >/dev/null 2>&1; then
  git remote remove heroku
fi

heroku git:remote -a "$APP_NAME"
git push heroku main || git push heroku master
heroku run node db/seed.js -a "$APP_NAME" || true

URL="$(heroku info -a "$APP_NAME" --json | sed -n 's/.*\"web_url\":\"\\([^\"]*\\)\".*/\\1/p')"

echo "-------------------------------------------"
echo "HappyMeter deployed."
echo "App name: $APP_NAME"
echo "URL: ${URL:-Unavailable from CLI output}"
echo "Admin username: $ADMIN_USER"
echo "Admin password: $ADMIN_PASS"
echo "Confirmed: this script operates only inside $EXPECTED_DIR"
