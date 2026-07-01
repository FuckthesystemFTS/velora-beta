# Beta Logical Node Operations

## Deploy Sequence

1. Deploy code with `VELORA_BETA_NODE_CLUSTER_ENABLED=false`.
2. Run migrations.
3. Verify `/health`.
4. Set `VELORA_BETA_NODE_MASTER_KEY` in Heroku config.
5. Enable `VELORA_BETA_NODE_CLUSTER_ENABLED=true`.
6. Restart the app once.
7. Verify `/api/network/status`.
8. Use admin endpoints for detailed node status.

## Public Checks

```powershell
Invoke-RestMethod https://velora-beta-20260629-9a9196313b42.herokuapp.com/health
Invoke-RestMethod https://velora-beta-20260629-9a9196313b42.herokuapp.com/api/network/status
Invoke-RestMethod https://velora-beta-20260629-9a9196313b42.herokuapp.com/api/network/nodes/summary
```

## Admin Checks

Admin routes require a bearer admin session:

- `GET /api/admin/beta-nodes`
- `GET /api/admin/beta-nodes/{id}`
- `POST /api/admin/beta-nodes/{id}/restart`
- `POST /api/admin/beta-nodes/{id}/suspend`
- `POST /api/admin/beta-nodes/{id}/resume`
- `POST /api/admin/beta-nodes/{id}/reconcile`
- `POST /api/admin/beta-nodes/repair`
- `POST /api/admin/beta-nodes/test-failover`

## Rollback

Set `VELORA_BETA_NODE_CLUSTER_ENABLED=false` and restart. Tables remain in place and old client routing continues.
