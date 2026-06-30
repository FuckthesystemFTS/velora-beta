# VeloMail P2P Delivery

Target model: encrypted store-and-forward with replication factor:

```env
VELOMAIL_TARGET_REPLICATION_FACTOR=3
VELOMAIL_MIN_REPLICATION_FACTOR=2
```

Current beta status:
- PostgreSQL mailbox delivery works for known `@velora` addresses.
- Offline peer replication is PARTIAL.
- Attachment chunk replication is planned after local encrypted content store completion.

