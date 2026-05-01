# Project plan: Vault Transit PII layer

## Outcome

Sensitive PII at rest is encrypted with **Vault Transit** (envelope encryption). Application code never holds long-term DEKs; decrypt happens only in Vault with audited access.

## Phases

1. **Platform** — Deploy Vault (HA), KMS auto-unseal, periodic seal tests. Define Transit mount + key rotation policy. See [`../../vault/README.md`](../../vault/README.md) and [`../../terraform/aws/vault-kms/README.md`](../../terraform/aws/vault-kms/README.md).
2. **Application integration** — Core registers a Transit client when `VAULT_ADDR` / token (or agent) + key name are set (`internal/pii`). Document which columns or fields are ciphertext vs plaintext during migration.
3. **Data migration** — Backfill: read plaintext → encrypt → write ciphertext; feature flag or dual-read window; verify samples; cut over reads.
4. **Operations** — Runbook for key rotation, sealed Vault, and emergency decrypt. [`../../runbooks/vault-transit-operators.md`](../../runbooks/vault-transit-operators.md).

## Out of repo

Vault cluster, HSM/KMS bindings, IAM for CSI/agent, network policies to restrict which pods can reach Vault.

## Acceptance

- New PII fields are written via Transit encrypt.
- Old rows migrated with verification checksums / row counts.
- No API process logs full plaintext at default log level.

## Application status (monorepo)

- `internal/pii/transit_client.go`: retries transient Vault failures (5xx/429); **decrypt** emits structured `vault_transit_decrypt` (mount, key, length only); encrypt logs **Debug** only.
- `security/vault/policies/core-api.hcl`: includes `transit/encrypt/*` and `transit/decrypt/*` for the default `transit` mount.
- Dev bootstrap (`scripts/vault-dev-bootstrap.*`) enables the Transit engine and creates key `player-pii` (or `VAULT_TRANSIT_KEY_NAME`).
- Optional `PII_EMAIL_LOOKUP_SECRET`: populates `users.email_hmac` on register and backfills on login (`internal/pii.EmailLookupHMACBytes`; migration `00055` + partial unique index `00058`).
