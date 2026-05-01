# Security epics — project plans

Each document is an **in-repo project plan** paired with operational **runbooks** under [`../../runbooks`](../../runbooks). Application implementation for several epics lives in [`services/core`](../../../services/core); cluster and secret infrastructure typically lives outside this repository.

| Epic | Plan | Primary runbook |
|------|------|-----------------|
| Vault Transit PII layer | [vault-transit-pii.md](vault-transit-pii.md) | [vault-transit-operators.md](../../runbooks/vault-transit-operators.md) |
| Argon2 migration (off bcrypt) | [argon2-migration.md](argon2-migration.md) | [argon2-credentials.md](../../runbooks/argon2-credentials.md) |
| MFA / WebAuthn + admin UX | [mfa-webauthn-admin.md](mfa-webauthn-admin.md) | [staff-webauthn-mfa.md](../../runbooks/staff-webauthn-mfa.md) |
| Compliance erasure worker | [compliance-erasure-worker.md](compliance-erasure-worker.md) | [compliance-erasure.md](../../runbooks/compliance-erasure.md) |
| Structured logging + alerting | [structured-logging-alerting.md](structured-logging-alerting.md) | [log-json-alerting.md](../../runbooks/log-json-alerting.md) |
| Istio / mesh mTLS | [istio-mtls.md](istio-mtls.md) | [istio-mtls-rollout.md](../../runbooks/istio-mtls-rollout.md) |
