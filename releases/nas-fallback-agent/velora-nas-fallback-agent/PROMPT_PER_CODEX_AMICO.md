Agisci come Codex sul computer/NAS del mio amico e configura Velora NAS Fallback Agent senza chiedere interventi manuali salvo password di sistema se richiesta.

Obiettivo:
- Preparare una cartella dedicata per Velora NAS Fallback
- Validare che non contenga file personali, wallet, seed, private key o database di altri progetti
- Installare solo dipendenze minime disponibili sul sistema
- Configurare l'agente in modalita fallback-storage-only
- Non aprire porte pubbliche
- Non configurare mining
- Non configurare proxy/VPN/shell remota
- Abilitare solo traffico outbound HTTPS verso https://velora-beta-20260629-9a9196313b42.herokuapp.com
- Creare servizio di avvio se il sistema lo supporta, altrimenti creare script start/stop
- Generare report finale con path, utente di esecuzione, limiti storage, stato health e prossimi passaggi

Regole:
- Non cancellare dati esistenti
- Non usare cartelle di altri lavori
- Non copiare segreti in repository o log
- Se manca Node.js o Docker, installa o usa l'opzione piu sicura disponibile per quel NAS
- Se non puoi completare un passaggio, crea istruzioni precise e continua gli altri passaggi

File attesi nel pacchetto:
- README.md
- velora-nas-agent.config.example.json
- velora-nas-fallback-agent.mjs
- start.ps1
- start.sh

Prima azione:
Analizza il sistema, scegli una cartella dedicata sicura, copia la config example in config reale e imposta storageRoot su una sottocartella `data`.
