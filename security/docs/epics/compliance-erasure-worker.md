# Project plan: Compliance erasure worker

## Outcome

Data subject erasure requests are **queued**, processed asynchronously by the worker, and auditable via admin API (`compliance_erasure_jobs`, tombstone flow in `internal/compliance`).

## Phases

1. **Legal / product** — Define “erasure” scope per jurisdiction (pseudonymize vs delete vs retain derivative stats).
2. **Implementation** — Job types, idempotency, retries, DLQ behavior; superadmin-only enqueue.
3. **Verification** — Spot-check Postgres + downstream caches; ensure no PII in logs post-tombstone.
4. **Reporting** — Export job status for DPO.

Runbook: [`../../runbooks/compliance-erasure.md`](../../runbooks/compliance-erasure.md).
