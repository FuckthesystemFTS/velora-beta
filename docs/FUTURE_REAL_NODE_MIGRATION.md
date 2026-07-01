# Future Real Node Migration

The beta cluster intentionally separates logical inventory from payload storage.

To migrate toward real independent nodes:

1. Implement `RemoteNodeStorage` behind `NodeStorageProvider`.
2. Replace local confirmation with remote signed acknowledgements.
3. Move private node keys into per-node secret stores.
4. Add provider-specific health checks.
5. Preserve CID, quorum and replica status semantics.
6. Migrate one beta logical node at a time to a real node provider.
7. Keep public APIs stable for existing desktop clients.

The current beta cluster is a compatibility bridge, not the final decentralized topology.
