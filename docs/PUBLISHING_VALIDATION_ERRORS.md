# Publishing Validation Errors

Stable user-facing error families:

- `VELORA_MANIFEST_MISSING`: `velora.json` is missing.
- `VELORA_MANIFEST_INVALID`: manifest cannot be parsed.
- `VELORA_ENTRYPOINT_MISSING`: `index.html` is missing.
- `VELORA_UNSUPPORTED_FILE`: executable or unsupported file detected.
- `VELORA_PACKAGE_TOO_LARGE`: package exceeds configured limits.

Errors must be displayed with a human explanation and a suggested fix. Technical codes should be secondary detail.
