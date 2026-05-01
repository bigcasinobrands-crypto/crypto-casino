# Enterprise security prompt — implementation status (this monorepo)

The “Cursor implementation prompt” targets **Node/Python** services and a fixed file tree. **This repository** is a **Go** API (`services/core`) + **React** admin console + **Postgres/Redis**, with security work split between application code, `security/`, and `docs/`. This document maps each phase to **what exists here** and what is **out of scope or not started** in-repo.

| Phase | Prompt expectation | In this repo |
|-------|--------------------|--------------|
| **1 — Vault** | Prod Vault, Raft, TLS, KMS unseal, KV/DB/PKI/Transit/TOTP, full policy set, Vault Agent | **Partial:** `security/vault/vault-config.hcl`, `vault-agent.hcl`, `scripts/bootstrap-vault.sh`, `terraform/aws/vault-kms/`, `security/vault/policies/*.hcl`. **Local dev** uses **dev Vault** in `docker-compose.security.yml` (intentional; not production-shaped). **App:** Vault **Transit** client in `services/core/internal/pii/transit_client.go`, optional init in `cmd/api/main.go`. **Not in repo:** full engine bootstrap scripts (DB/PKI/TOTP engines as code), AppRole/K8s/LDAP/OIDC config beyond stubs. |
| **2 — API** | Kong + JWT + Redis blacklist + Zod, etc. | **Partial:** `security/kong/kong.yaml` (correlation-id, rate limits; **no** JWT plugin on Kong — API validates JWTs in Go). **App:** RS256 + JWKS (`cmd/api/main.go`, `internal/jwtissuer`), JTI revocation `internal/jtiredis`, `httprate` on API, CORS, `internal/securityheaders` / CSP mode. **Not:** Node/Python middleware; input layers are Go handlers + validation, not a single Zod port. |
| **3 — PII** | All PII only as Transit ciphertext + `email_hash`, ABAC, etc. | **Partial:** Transit encrypt/decrypt when Vault env set; compliance/erasure in `internal/compliance`; **`users.email_hmac`** (BYTEA) populated on register/login when `PII_EMAIL_LOOKUP_SECRET` is set (migrations `00055`, partial unique `00058`). **Gap:** schema-wide `enc_*` columns across all tables + ABAC remain incremental (`security/docs/epics/vault-transit-pii.md`). |
| **4 — Admin** | VPN-only admin, MFA, RBAC, audit decorators | **Partial:** Staff auth, **WebAuthn** (`internal/staffauth`), superadmin break-glass (`internal/adminops/break_glass*.go`, migration `00053`), audit patterns. **Gap:** admin on internal-only network is **infra/nginx** (see Kong comments); full RBAC matrix vs prompt roles may differ; “one session only” / step-up MFA intervals — verify product requirements. |
| **5 — Network** | mTLS mesh, compose networks | **Partial:** `security/k8s/examples/*`, Istio stubs, `security/docs/epics/istio-mtls.md`. **Compose:** `docker-compose.yml` not split into `frontend-net` / `data-net` / `vault-net` as in prompt (would be a dedicated compose overhaul). |
| **6 — Detection** | Pino/structlog, CloudWatch/Prometheus rules | **Partial:** JSON log format env (`LogFormat` in config), `security/monitoring/alerting_rules.yml`, runbooks under `security/runbooks/`. |
| **7 — Compliance** | Retention jobs, erasure service | **Partial:** erasure worker docs + Go compliance paths; full 7-year retention automation may need ops scheduling outside repo. |

## Filename crosswalk (prompt → repo)

| Prompt path | This repo |
|-------------|-----------|
| `middleware/auth.middleware.ts` | Go: `internal/playerapi`, `internal/staffauth`, JWT middleware |
| `services/pii-encryption.service.ts` | `internal/pii` |
| `database/migrations/001_create_players_secure.sql` | `services/core/internal/db/migrations/*.sql` (incremental, not renumbered) |
| `kong/kong.yaml` | `security/kong/kong.yaml` |
| `github-actions/security-scan.yml` | `.github/workflows/security-scan.yml` |
| `runbooks/vault-sealed.md` | `security/runbooks/vault-sealed.md` |

## Password hashing (prompt alignment)

Prompt: Argon2id, time=3, memory=65536, parallelism=4. **Implemented** in `services/core/internal/passhash/passhash.go` (`argon2Memory = 64*1024`, `argon2Time = 3`, `argon2Threads = 4`), with legacy bcrypt verify + upgrade path.

## Next steps (recommended order)

1. **Operate Vault dev → staging:** follow `security/vault/README.md` and `runbooks/vault-transit-operators.md`; enable Transit keys used by `pii` package.  
2. **Close PII epic:** `security/docs/epics/vault-transit-pii.md` — column-level encryption + lookup hashes where still plaintext.  
3. **Harden CI:** [`.github/workflows/security-scan.yml`](../../.github/workflows/security-scan.yml) — **Gitleaks** (strict; [`.gitleaks.toml`](../../.gitleaks.toml); local: `scripts/gitleaks-ci.ps1` / `gitleaks-ci.sh`), **Gosec** (strict: `-severity=high -confidence=high`, excludes `internal/e2e`, `internal/bonuse2e`; local: `scripts/gosec-ci.ps1` / `gosec-ci.sh`), **Semgrep** (`p/golang` on `services/core`; local: `scripts/semgrep-ci.ps1` / `semgrep-ci.sh`), **Trivy** FS (CRITICAL/HIGH report; `exit-code: 0` so dependency noise does not block merges).  
4. **Kong / edge:** tighten [`../kong/kong.yaml`](../kong/kong.yaml) per environment; use [`../nginx/admin-internal.example.conf`](../nginx/admin-internal.example.conf) (or your WAF) to **IP-restrict** `/v1/admin`.  
5. **Policy naming:** see [`../vault/policies/README.md`](../vault/policies/README.md) (prompt names ↔ shipped HCL).
