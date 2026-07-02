# Forum And Chat Globale

The Forum beta contains one active section:

- slug: `global-chat`
- title: `Chat Globale`

The chat is authenticated through the same Bearer session used by the rest of Velora. Messages are persisted in PostgreSQL and are limited to 200 characters server-side and client-side.

Transport is controlled polling every five seconds from the desktop client.
