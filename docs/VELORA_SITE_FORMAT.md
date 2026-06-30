# Velora Site Package

- Name: `Velora Site Package`
- Extension: `.vsite`
- MIME type: `application/vnd.velora.site`

Logical structure:

```text
package/
|-- manifest.json
|-- files.json
|-- signature.json
|-- content/
|   |-- index.html
|   |-- assets/
|   |-- images/
|   `-- static files
`-- metadata/
    `-- build-info.json
```

Rules:

- stable file ordering
- canonical JSON
- normalized paths
- no absolute paths
- no `..`
- deterministic package hashing
- content hashes use `blake3`
