# Windows Beta Installer

Current build entrypoints:

```powershell
cd C:\Users\Hp\Desktop\VELORA
corepack pnpm build
cd apps\desktop\src-tauri
cargo tauri build
```

Current state:

- the Tauri icon regression has been fixed with `apps/desktop/src-tauri/icons/icon.ico`
- installer path and SHA-256 must be reported only after `cargo tauri build` produces real files
- code signing is still pending
