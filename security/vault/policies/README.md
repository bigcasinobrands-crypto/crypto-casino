# Vault policies in this repo vs enterprise prompt naming

The enterprise implementation prompt references generic policy names. This repository ships **least-privilege HCL** under version control with slightly different filenames.

| Prompt name (example) | File here | Notes |
|------------------------|-----------|--------|
| `casino-app-policy.hcl` | [`core-api.hcl`](core-api.hcl) | Read KV under `casino/` plus **Transit** `encrypt/decrypt` for the configured key mount (wildcard paths). |
| `casino-readonly-policy.hcl` | [`ops-readonly.hcl`](ops-readonly.hcl) | Read/list metadata for operators. |
| `casino-admin-policy.hcl` / vault admin | [`break-glass.hcl`](break-glass.hcl) | Break-glass grants are modeled in **application** DB + API; Vault policy here is not a full “super admin” duplicate. |
| `casino-payment-policy.hcl` | *Not split yet* | Add a dedicated policy when payment microservice or worker gets its own Vault identity. |
| `casino-ci-policy.hcl` | *Not in repo* | Define in your CI vault namespace with narrow write for bootstrap only. |

When provisioning Vault in staging/production, **copy or symlink** these files to your naming convention, or use `vault policy write` with the same contents.
