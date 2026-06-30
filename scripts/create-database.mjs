#!/usr/bin/env node
console.log("Local PostgreSQL:");
console.log("  createdb velora");
console.log("  $env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/velora'");
console.log("  npm run run:migrations");
console.log("Heroku beta:");
console.log("  heroku addons:create heroku-postgresql:essential-0 -a REPLACE_WITH_PUBLIC_URL");
console.log("  heroku config:set DATABASE_URL=REPLACE_WITH_GENERATED_SECRET -a REPLACE_WITH_PUBLIC_URL");
