# Vault (local dev)

## Dev server

```powershell
docker compose -f docker-compose.security.yml up -d vault
```

Default dev root token: `dev-root-token` (override with `VAULT_DEV_ROOT_TOKEN_ID` in compose).

## Bootstrap KV + Transit + policies

With Vault CLI (`$env:VAULT_ADDR='http://127.0.0.1:8200'`, `$env:VAULT_TOKEN='dev-root-token'`):

```bash
vault secrets enable -path=casino kv-v2
vault secrets enable transit
# Key name must match VAULT_TRANSIT_KEY_NAME in services/core (default below):
vault write -f transit/keys/player-pii
vault policy write core-api policies/core-api.hcl
vault policy write ops-readonly policies/ops-readonly.hcl
vault policy write break-glass policies/break-glass.hcl
```

`core-api.hcl` includes **`transit/encrypt/*`** and **`transit/decrypt/*`**. If you use a non-default Transit mount path, mirror that path in policy (not only `transit/`).

Or run `powershell -File ../../scripts/vault-dev-bootstrap.ps1` from `security/vault`.

## Production

- **Do not** use `-dev` mode. Use TLS, real auth (KMS auto-unseal per `terraform/aws/vault-kms`), and audited break-glass grants in the admin API.
- Policies here are **starting points**; tighten `break-glass` to the minimum paths required before production.
