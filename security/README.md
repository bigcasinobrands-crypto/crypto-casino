# Security operations

This directory holds **infrastructure-as-code** and **policy docs** for the operations side of the casino stack. Application code remains under [`services/core`](../services/core); player-facing bundles must never contain withdrawal or Vault-capable credentials.

## Layout

| Path | Purpose |
|------|---------|
| [`docs/ENTERPRISE_PROMPT_STATUS.md`](docs/ENTERPRISE_PROMPT_STATUS.md) | Maps the generic **enterprise casino security** Cursor prompt (Node/Python tree) to **this Go monorepo** — what ships vs gaps |
| [`nginx/`](nginx/) | Example **internal-only** reverse proxy allowlist for `/v1/admin` |
| [`docs/custody-key-management.md`](docs/custody-key-management.md) | Hot/warm/cold model mapped to **Fystack MPC** + platform secrets; KMS/HSM; multisig ceremony; **break-glass** |
| [`vault/`](vault/) | Vault policies and dev bootstrap (KV paths, least privilege) |
| [`terraform/aws/vault-kms/`](terraform/aws/vault-kms/) | AWS KMS key for **Vault seal / auto-unseal** (prod-shaped stub) |
| [`docs/epics/`](docs/epics/) | **Project plans** for Vault Transit, Argon2, WebAuthn MFA, erasure worker, logging/alerting, Istio mTLS |
| [`k8s/`](k8s/) | Example **NetworkPolicy** + Istio mTLS stubs |

## Local Vault

From repo root:

```bash
docker compose -f docker-compose.security.yml up -d vault
```

Then follow [`vault/README.md`](vault/README.md). On Windows, use `powershell -File scripts/vault-dev-bootstrap.ps1` after Vault is up.

## Terraform

See [`terraform/aws/vault-kms/README.md`](terraform/aws/vault-kms/README.md). Pin versions; use remote state in real environments; never commit `*.tfstate`.

## CI security scans

Pull requests run [`.github/workflows/security-scan.yml`](../.github/workflows/security-scan.yml) (**Gitleaks**, Trivy, **Gosec**, **Semgrep**). Match CI locally with [`scripts/gitleaks-ci.sh`](../scripts/gitleaks-ci.sh) / [`gitleaks-ci.ps1`](../scripts/gitleaks-ci.ps1), [`scripts/gosec-ci.sh`](../scripts/gosec-ci.sh) / [`gosec-ci.ps1`](../scripts/gosec-ci.ps1), and [`scripts/semgrep-ci.sh`](../scripts/semgrep-ci.sh) / [`semgrep-ci.ps1`](../scripts/semgrep-ci.ps1). Gitleaks reads [`.gitleaks.toml`](../.gitleaks.toml) (example env paths allowlisted). Scope vs the generic “enterprise casino” prompt is summarized in [`docs/ENTERPRISE_PROMPT_STATUS.md`](docs/ENTERPRISE_PROMPT_STATUS.md).
