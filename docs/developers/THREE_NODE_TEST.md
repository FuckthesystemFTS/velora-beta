# Three Node Test

Run:

```powershell
cd C:\Users\Hp\Desktop\VELORA
node --import tsx scripts/test-three-nodes.mjs
```

This script verifies:

1. node A starts on `4101`
2. node B starts on `4102`
3. node C starts on `4103`
4. node A publishes `examples/velora-demo-site`
5. node B finds `shop.demo` by searching `demo`
6. node B fetches the `.vsite` package and caches it locally
7. node A publishes `1.1.0`
8. rollback switches the active record back to `1.0.0`
9. node A stops
10. node C fetches `shop.demo` from provider/cache and still succeeds

Verified report path:

```text
tmp/three-node-report.json
```
