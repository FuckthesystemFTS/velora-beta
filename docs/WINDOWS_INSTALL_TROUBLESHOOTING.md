# Velora Windows Installer Troubleshooting

Versione beta verificata: `0.1.0`

Installer generato:

`apps/desktop/src-tauri/target/release/bundle/msi/Velora_0.1.0_x64_en-US.msi`

Distribuzione beta:

`releases/beta/windows/Velora_0.1.0_x64_en-US.msi`

SHA-256:

`4A55628031E1CEDE54C9459AC29CCA92B3B1E358371A1698D88A37FA2DCBE41B`

## Configurazione verificata

| Voce | Stato |
| --- | --- |
| Product name | `Velora` |
| Versione | `0.1.0` |
| Identifier | `com.velora.desktop` |
| Icona bundle | `icons/icon.ico` |
| Target | `msi` Windows x64 |
| WebView2 | richiesto dal runtime Tauri/WebView2 |
| Disinstallazione | gestita dallo standard MSI |

## SmartScreen

La beta non risulta firmata con certificato Windows pubblico. Su macchine nuove puo comparire Microsoft SmartScreen. Per una distribuzione pubblica stabile serve firma codice.

## Log MSI

Per raccogliere log installazione:

```powershell
msiexec /i Velora_0.1.0_x64_en-US.msi /L*V velora-install.log
```

## Problemi noti

- Se WebView2 non e presente, Windows puo richiedere installazione/aggiornamento runtime.
- La beta usa un backend Heroku pubblico e un database Postgres `essential-0`.
- Il Control Center e predisposto ma non esposto a utenti normali nel client.
