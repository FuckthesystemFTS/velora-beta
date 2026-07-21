# Sicurezza

## Misure implementate

- hash password con bcrypt
- sessioni in DB con revoca esplicita
- cookie `HttpOnly` e `SameSite=Lax`
- secure headers in middleware
- Content Security Policy
- validazione input con Zod
- sanitizzazione contenuti HTML
- controlli MIME/size sugli upload
- origin check su route mutative
- RBAC server-side per route e pagine sensibili
- audit logging

## Estensioni predisposte

- 2FA
- antivirus/scansione upload
- Redis per rate limit distribuito
- email verification e reset password completi
