# Velora NAS Fallback Agent - Beta

Questo pacchetto serve solo come nodo NAS di fallback per backup cifrati e repliche autorizzate Velora.

Non e un miner
Non e una VPN
Non e un proxy aperto
Non apre shell remote
Non deve ricevere seed, wallet, private key o password Velora degli utenti

## Installazione rapida per Synology o server NAS

1. Crea una cartella dedicata, per esempio `/volume1/velora-nas-fallback`
2. Copia questo pacchetto nella cartella
3. Duplica `velora-nas-agent.config.example.json` in `velora-nas-agent.config.json`
4. Modifica solo `storageRoot`, `maxStorageGb` e URL backend se necessario
5. Avvia lo script di bootstrap generato dal Codex locale seguendo `PROMPT_PER_CODEX_AMICO.md`

## Requisiti minimi

- NAS sempre acceso o quasi sempre acceso
- 50 GB liberi consigliati per beta
- Connessione stabile
- Nessuna porta pubblica obbligatoria nella fase beta
- Accesso outbound HTTPS verso Velora

## Sicurezza

L'agente deve funzionare con utente non amministratore quando possibile.
I dati salvati devono stare in una directory dedicata.
Le chiavi locali del NAS non devono essere inviate a chat, repository o log pubblici.
