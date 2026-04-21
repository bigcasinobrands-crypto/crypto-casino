# Pre-production gate — bonuses & chat (NFR-SEC-REV)

Use before enabling real-money bonuses in production.

- [ ] **Money paths**: Ledger idempotency for `promo.grant`, `promo.convert`, `bo:game:debit:*`, `fystack:*` verified under replay (webhook + worker).
- [ ] **Withdrawals**: Cash-only debit; `bonus_blocks_withdraw` when `withdraw_policy` is `block` on active WR bonus.
- [ ] **BlueOcean**: Max bet and excluded games enforced server-side (`403` on violation); debit allocator deterministic (bonus_locked before cash).
- [ ] **Chat**: No player JWT moderation; staff-only `/v1/admin/chat/*` exercised; audit rows for delete/mute/ban/broadcast/settings.
- [ ] **Admin BonusHub**: Manual grant restricted to `superadmin`; publish version audited.
- [ ] **Kill switches**: `bonuses_enabled` / `automated_grants_enabled` tested end-to-end.
- [ ] **Dedupe**: Conflicting publish returns `409`; `site_settings.bonus_abuse_policy` reviewed; `bonus_abuse_denied_total` in ops metrics when denies occur.
- [ ] **VIP**: `vip_point_ledger` idempotency; worker accrual from `game.debit` (cash pocket only).
- [ ] **Player JSON**: `/v1/bonuses/available` and `/v1/vip/status` return only non-sensitive fields; rate limits on `available`.

## Pre-prod readiness

Complete every item before enabling real-money bonuses in production.

- [ ] **All money paths reviewed:** deposit→grant, grant→ledger, bet debit split (bonus_locked before cash), WR progress tracking, forfeit debit, convert-to-cash credit
- [ ] **Chat staff migration complete:** no player-facing mod routes remain; all moderation flows via `/v1/admin/chat/*` only
- [ ] **RBAC verified:** superadmin-only on manual grant, simulate, retry, pause toggle, automation CRUD
- [ ] **Kill switches tested:** `bonuses_enabled`, `automated_grants_enabled` (global), `grants_paused` (per-promotion)
- [ ] **Idempotency verified:** replay deposit webhook end-to-end, confirm no double grant and no duplicate ledger entry
- [ ] **Worker DLQ monitored:** failed jobs visible in admin console (`GET /v1/admin/bonushub/worker-failed-jobs`), retry tested via `POST .../retry`
- [ ] **Backup + restore drill completed on staging:** see `docs/backup-scope.md` restore checklist
- [ ] **Legal sign-off:** bonus T&C approved, privacy retention periods defined, erasure policy documented and tested
