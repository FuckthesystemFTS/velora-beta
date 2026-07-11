#!/usr/bin/env sh
set -eu
mkdir -p ./data ./logs
cp -n .env.example .env 2>/dev/null || true
echo "Velora Boost Box Agent predisposto. Modifica .env e usa provisioning con token monouso."
