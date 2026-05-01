# Why large security items are multi-phase (not one PR)

Items like **Vault Transit for PII**, **mandatory MFA/WebAuthn**, **compliance erasure workers**, and **full service-mesh mTLS** are **programs**, not commits, because they:

1. **Touch production keys and data classes** — Wrong cutover leaks PII or locks out admins; they need runbooks, rollback, and often legal/compliance sign-off.
2. **Require runtime dependencies** — Vault Enterprise paths, HSM/KMS, IdP for WebAuthn, SIEM for alerts. Code in-repo is only useful once those exist.
3. **Imply user-visible or data migrations** — Argon2id-only password storage, RS256-only JWTs, or erasure jobs change behavior for **every** account and **every** token; you need phased rollout (feature flags, dual validation, key rotation windows).
4. **Span more than this repository** — Istio/mTLS, WAF rules, and alerting are cluster- and org-wide; repos ship **stubs and CI**; operators finish the rollout.

This codebase adds **incremental slices** (cookie sessions, CSRF, OpenAPI, Terraform/Kong/K8s stubs, optional HIBP when `HIBP_CHECK_PASSWORDS` is set, production RS256 gate with an HS256 escape hatch, structured logs when adopted) so each phase can ship safely. Treat the items below as **epics** with their own milestones.
