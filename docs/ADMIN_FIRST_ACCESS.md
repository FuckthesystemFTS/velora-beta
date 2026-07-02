# Admin First Access

Status: not complete in this pass.

Existing backend has admin challenge/session primitives, but a safe first password bootstrap flow still needs to be completed before public beta can be declared ready.

Required behavior:

- Generate a one-time bootstrap token.
- Store only its hash.
- Let the owner choose a password in UI.
- Invalidate the token after use.
- Never log password or token internals.
