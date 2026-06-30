# VeloMail Encryption

Required target format:
- AEAD-encrypted body and attachments.
- Per-message random symmetric key.
- Key wrapping for authorized recipient devices.
- Signed envelope.
- Content hash before replication.

Current beta status:
- Message bodies are stored as encoded payloads with content hash and envelope signature fields.
- This is not final E2E cryptography and must not be described as complete.
- Backend and UI are prepared for encrypted envelopes.

