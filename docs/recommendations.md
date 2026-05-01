# Build recommendations — Crypto Casino baseline

Practical checklist beyond the main technical plan: product, engineering, security, ops, and delivery.

## Product & scope

- **Phase 1 “done” (one page):** Sign up → deposit → play (BlueOcean) → withdraw → staff sees corresponding data in admin. Use this to limit scope creep.
- **BlueOcean money model:** Choose and document one wallet/seamless mode *before* wiring ledger and webhooks so deposits, play, and settlements stay consistent.

## Engineering

- **OpenAPI-first for `/v1`:** Start small; keep a single spec and typed or generated clients for `frontend/admin-console` and `frontend/player-ui` so frontends and backend stay aligned. For new third-party backends, follow **`docs/CONTRIBUTING-INTEGRATIONS.md`**.
- **Single ledger apply path:** The same module/function applies game and payment events for both synchronous API code and async workers—avoid two implementations.
- **Staging ≈ prod:** Same URL patterns for webhooks, TLS, and secrets handling as production.

## Security & compliance

- **Secrets manager from day one;** document key rotation. Never commit real secrets.
- **Admin isolation:** Dedicated origin (`admin.…`), strict CORS, RBAC on every `/v1/admin/*`, and an **audit log** for sensitive staff actions.
- **Webhook playbook:** Verify signature → enqueue → idempotent apply → DLQ; document safe replay *before* incidents.

**Legal:** Real-money / crypto gambling is regulated. Licensing, KYC/AML, and responsible gambling are legal/ops requirements—not something the codebase replaces.

## Operations

- **`docs/container-runtime.md`:** API Docker image, migration-on-start, and health probe paths.
- **Structured logs + request IDs** on API and workers from the start.
- **Metrics:** Queue depth, webhook failure rate, latency—enough to see regressions early.
- **Backups:** Encrypted backups + at least one **restore drill** before calling Phase 1 complete.

## Team & delivery

- **Branch protection + CI:** Lint, tests, dependency audit, migrations in CI before multiple people touch ledger or webhook code.
- **Clear ownership:** If using multiple agents or contractors, enforce boundaries (who owns schema, ledger, integrations, each app) and require review on money paths.

## Checklist

- [ ] Phase 1 “done” doc written
- [ ] BlueOcean wallet model documented
- [ ] OpenAPI stub growing with each route
- [ ] Staging + webhook tunnel tested
- [ ] Secrets only in manager / sealed CI
- [ ] Admin on separate subdomain + audit log plan
- [ ] Webhook → queue → idempotency → DLQ documented
- [ ] Logging/metrics baseline
- [ ] Backup restore tested
- [ ] CI + branch protection
- [ ] Legal/licensing path identified for target markets
