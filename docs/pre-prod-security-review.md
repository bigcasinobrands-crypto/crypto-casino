# Pre-production security review (game + payments)

- [ ] Webhook signature verification on in production (`WEBHOOK_*_SECRET` non-empty).
- [ ] Replay tests: duplicate `provider_event_id` / payment `id` does not double-ledger.
- [ ] Rate limits verified on `/v1/admin/auth/login` and `/v1/auth/*`.
- [ ] If **player cookie sessions** are enabled (`PLAYER_COOKIE_AUTH`): production **CORS** allows credentials only from real player origins; **SameSite** matches deployment (e.g. `lax`/`none`+`Secure`); SPA uses **credentialed fetches** and CSRF header on mutations; **`PLAYER_COOKIE_OMIT_JSON_TOKENS`** only with a client that does not require tokens in JSON.
- [ ] RBAC: `support` vs `admin` rules reviewed before destructive admin tools ship.
- [ ] **Optional:** external penetration test; remediate critical findings before public launch.
