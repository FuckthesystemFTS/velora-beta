# Moderazione distribuita

## Regole fondamentali

- la prima segnalazione non nasconde il post
- nessuno strike automatico al primo report
- il case nasce una sola volta per post salvo configurazioni future
- i voti sono anonimi verso gli utenti esterni
- niente appello formale

## Pipeline

### Livello 0

Creazione `Report` + `ModerationCase`.

### Livello 1

Assegnazione automatica a 10 utenti casuali idonei:

- non autore
- non reporter
- non sospesi
- non bloccati reciprocamente
- account sufficientemente maturi
- non sovraccarichi

### Livello 2

Assegnazione a 5 utenti verificati esclusi dal livello 1.

### Livello 3

Assegnazione a 3 membri team/moderazione.

## Stati case

- `OPEN`
- `LEVEL1_PENDING`
- `LEVEL1_CLOSED_KEEP`
- `LEVEL2_PENDING`
- `LEVEL2_CLOSED_KEEP`
- `TEAM_PENDING`
- `SUSPENDED_TEMP`
- `REMOVED_FINAL`
- `RESTORED`
- `EXPIRED`

## Audit

Ogni passaggio genera `AuditLog`:

- report iniziale
- selezione giurati
- voto
- decisione team
- processing code
