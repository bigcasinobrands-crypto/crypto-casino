# Bonus operations runbook

- **Kill switches:** `payment_ops_flags.bonuses_enabled`, `automated_grants_enabled`; per-promotion `promotions.grants_paused` (admin PATCH).
- **Policy tuning:** `site_settings` key `bonus_abuse_policy` (JSON). Changes apply on next grant; audit via `bonus_risk_decisions`.
- **Dedupe conflicts:** HTTP 409 on publish — unpause or unpublish the conflicting live version, or change `dedupe_group_key` / rules segment so the fingerprint differs.
- **Worker:** Bonus rollup + VIP accrual run every 15 minutes (`cmd/worker`). Requires `REDIS_URL` for job queue.
- **Replay:** Failed `bonus_payment_settled` rows in `worker_failed_jobs`; superadmin retry enqueues Redis job.

See also: `docs/bonus-dedupe.md`, `docs/bonus-qa-matrix.md`.
