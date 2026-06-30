# VeloMail Architecture

VeloMail is a native Velora service tied to the existing Velora account. It does not use SMTP, IMAP, Gmail, Outlook, or a second registration.

Current beta implementation:
- One VeloMail account per Velora user.
- Address format: `alias@velora`.
- PostgreSQL directory and mailbox metadata.
- Store-and-forward API with Inbox, Sent, Drafts, Archive, Trash, Star and Spam primitives.
- System sender reservation for `security@velora`, `support@velora`, `updates@velora`, `noreply@velora`, and `notifications@velora`.

Limit:
- Full end-to-end encryption, offline P2P replication and local encrypted multi-device sync are PARTIAL, not claimed complete.

