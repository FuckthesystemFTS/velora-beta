# Final Beta Deployment

Heroku app: `velora-beta-20260629`

Required final sequence:

1. Run TypeScript and Rust checks.
2. Deploy Heroku.
3. Run migrations.
4. Enable `VELORA_FORUM_ENABLED` and `VELORA_GLOBAL_CHAT_ENABLED`.
5. Verify health, publishing and chat online.
6. Complete admin bootstrap.
7. Build Windows once.
8. Run macOS workflow once.
9. Update manifest and download files.
