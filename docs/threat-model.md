# Lightweight threat model (Phase 1)

STRIDE-oriented view of trust boundaries: **browser** (player/admin SPA), **API**, **Postgres**, **Redis**, **workers**, **BlueOcean**, **Fystack**.

| Asset | Threats | Mitigations (baseline) |
|-------|-----------|-------------------------|
| **Staff JWT / refresh** | Theft, replay | Short access TTL; refresh rotation; HTTPS only; CORS allowlist on `/v1/admin`; audit log on login. |
| **Player JWT / refresh** | Same | Same pattern on `/v1/auth/*`; rate limits on login/register. |
| **Ledger integrity** | Double credit, forged events | Idempotency keys; webhook signature verify (configure secrets); single `ApplyLedger` path; worker + DB constraints. |
| **Webhook endpoints** | Flooding, forged payloads | Rate limits; verify signature before enqueue; reject invalid body. |
| **Admin actions** | Privilege abuse | RBAC on routes; audit log extension for money-moving actions (when added). |
| **Secrets in repo** | Leak | `.gitignore` `.env`; CI secrets; no keys in client bundles. |

**Update when:** adding new webhooks, OAuth, or admin money tools.
