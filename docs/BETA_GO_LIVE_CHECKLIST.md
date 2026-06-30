# Velora Beta Go-Live Checklist

- `cargo check` in `apps/desktop/src-tauri`
- `cargo test` in `apps/desktop/src-tauri`
- `cargo clippy --all-targets --all-features -- -D warnings` in `apps/desktop/src-tauri`
- `corepack pnpm install`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `docker compose up -d`
- `node --import tsx scripts/test-three-nodes.mjs`
- publish `examples/velora-demo-site`
- search `demo` from a second node
- fetch `shop.demo` from a second node
- publish `1.1.0`
- rollback to `1.0.0`
- verify offline fetch from cache/provider after stopping node A
- build Windows installer only after the previous checks pass
