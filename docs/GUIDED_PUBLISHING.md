# Guided Publishing

Publisher Studio now follows this path:

1. Choose the Velora Zone.
2. Select a folder with the native desktop picker.
3. Velora runs validation automatically.
4. The user prepares the package.
5. The user confirms and publishes.
6. The backend registers the release and beta node replication status.

The path field is read-only in the UI. Users should use `Seleziona cartella`, `Cambia cartella` and `Apri cartella`.

Current validation checks the local release through the Tauri command `validate_local_release`.
