# V

V is a full-stack social network with distributed moderation:

1. initial report with no automatic penalty
2. level-1 jury (random users)
3. level-2 jury (verified users)
4. team decision by configurable majority

No formal appeal flow is exposed to users.

## Stack

- Next.js App Router + TypeScript
- PostgreSQL + Prisma
- Tailwind CSS
- Server-side session auth
- Zod validation
- Cloudinary-first media upload (local fallback)
- SMTP email (Gmail supported)
- Vitest + Playwright

## Local setup

```powershell
Copy-Item .env.example .env -Force
npm install
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Working demo credentials

Default password: `ChangeMe123!`

- `superadmin@v.local`
- `admin1@v.local`
- `admin2@v.local`
- `moderator1@v.local`
- `moderator2@v.local`
- `moderator3@v.local`
- `verified1@v.local`
- `user1@v.local`

Login accepts `email` or `username`.

## Core routes

- User feed: `/home`
- Profile: `/profile/:username`
- Jury inbox: `/moderation/inbox`
- Team panel: `/team`
- Admin panel: `/admin`
- Forgot password: `/forgot-password`
- Reset password: `/reset-password?token=...`

## Cloudinary setup

Set these in `.env`:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

If not set, upload falls back to `public/uploads`.

## Gmail SMTP setup

Set these in `.env`:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER=<your-gmail>`
- `SMTP_PASS=<gmail-app-password>`
- `SMTP_FROM="V <no-reply@your-domain>"`

Emails implemented:

- welcome email on registration
- password reset email

## Heroku preparation status

Already prepared:

- `Procfile`
- `app.json`
- `release: prisma migrate deploy`
- health route: `GET /api/health`
- build/start scripts ready

Not executed yet:

- Heroku CLI login
- app creation and remote config
- final deploy command

## Tests

```powershell
npm run test
npm run lint
npm run build
```

## Docs

- [Architecture](docs/architecture.md)
- [Moderation](docs/moderation.md)
- [Security](docs/security.md)
- [Heroku deploy](docs/deploy-heroku.md)
