#!/usr/bin/env bash
# Idempotent-ish bootstrap for a NEW Vault cluster. Re-run safe skips when already initialized.
set -euo pipefail

export VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"

echo "1) Operator: vault operator init -key-shares=5 -key-threshold=3 -pgp-keys=..."
echo "   Store unseal keys in split custody; encrypt with PGP or use KMS auto-unseal (preferred)."
echo "2) Unseal: vault operator unseal (x3)"
echo "3) Enable secrets:"
cat <<'HCL'
vault secrets enable -path=casino kv-v2
vault auth enable approle
HCL
echo "4) Apply policies from security/vault/policies/*.hcl"
echo "5) Configure audit device (file/syslog) and TLS listeners (see vault-config.hcl)"
