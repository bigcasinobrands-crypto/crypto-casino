# VIP operations runbook

- **Schema:** `vip_tiers`, `player_vip_state`, `vip_point_ledger` (migration `00020_bonus_vip_facts.sql`).
- **Accrual:** Worker processes `ledger_entries` with `entry_type = 'game.debit'` and `pocket = 'cash'`; idempotency `vip:accrual:{ledger_id}`.
- **Admin:** `GET/POST /v1/admin/vip/tiers`, `GET /v1/admin/vip/players?tier_id=`, `GET/PATCH /v1/admin/users/{id}/vip` (PATCH superadmin).
- **Player:** `GET /v1/vip/status` (Bearer).

Adjust tier thresholds via `vip_tiers.min_lifetime_wager_minor` (and future tier recalculation jobs as needed).
