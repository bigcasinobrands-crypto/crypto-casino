#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/security/vault"
export VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
export VAULT_TOKEN="${VAULT_TOKEN:-dev-root-token}"
vault secrets enable -path=casino kv-v2 2>/dev/null || true
vault secrets enable transit 2>/dev/null || true
TRANSIT_KEY="${VAULT_TRANSIT_KEY_NAME:-player-pii}"
vault write -f "transit/keys/${TRANSIT_KEY}" 2>/dev/null || true
for f in policies/*.hcl; do
  name=$(basename "$f" .hcl)
  vault policy write "$name" "$f"
done
echo "Bootstrap complete."
