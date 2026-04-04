# Pre-production security review (game + payments)

- [ ] Webhook signature verification on in production (`WEBHOOK_*_SECRET` non-empty).
- [ ] Replay tests: duplicate `provider_event_id` / payment `id` does not double-ledger.
- [ ] Rate limits verified on `/v1/admin/auth/login` and `/v1/auth/*`.
- [ ] RBAC: `support` vs `admin` rules reviewed before destructive admin tools ship.
- [ ] **Optional:** external penetration test; remediate critical findings before public launch.
