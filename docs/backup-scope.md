# Backup scope and disaster recovery (NFR-DR)

---

## Tables in backup scope

All tables below must be included in every backup run. They are grouped by domain.

### Identity and access

| Table | Notes |
|---|---|
| `users` | Player accounts, email, password hash, KYC status, self-exclusion flags |
| `staff_users` | Admin/support/superadmin accounts |
| `staff_sessions` | Active staff sessions (short-lived, but useful for audit) |
| `admin_audit_log` | Immutable log of every admin action |

### Financial

| Table | Notes |
|---|---|
| `ledger_entries` | Core double-entry ledger — loss of this table is catastrophic |
| `fystack_*` | All Fystack-prefixed tables: webhook deliveries, payments, withdrawals |
| `payment_ops_flags` | Kill-switch state for deposits, withdrawals, bonuses |

### Bonus system

| Table | Notes |
|---|---|
| `user_bonus_instances` | Per-user bonus grants, WR progress, status |
| `promotions` | Promotion definitions and `grants_paused` flag |
| `promotion_versions` | Versioned rules, reward config, published state |
| `bonus_automation_rules` | Automated grant rule definitions |
| `bonus_risk_decisions` | Risk-engine decisions per grant (contains `user_id`) |
| `bonus_outbound_events` | Outbound event log for bonus lifecycle |
| `worker_failed_jobs` | Dead-letter queue for failed async jobs |
| `game_contribution_profiles` | Per-game WR contribution percentages |

### Gaming

| Table | Notes |
|---|---|
| `blueocean_events` | BlueOcean game callback log (bet/win/rollback) |

### Chat

| Table | Notes |
|---|---|
| `chat_messages` | Player and system messages |
| `chat_mutes` | Timed mute records |
| `chat_bans` | Permanent ban records |
| `chat_blocked_terms` | Moderation word blocklist |
| `chat_settings` | Singleton settings row (slow mode, enabled flag) |

### Notifications

| Table | Notes |
|---|---|
| `player_notifications` | In-app notification records |

---

## Backup strategy

### Recommended approach

1. **Nightly `pg_dump`** — full logical dump of all tables listed above. Store compressed dumps in an off-site object store (S3/GCS/R2) with 30-day retention.
2. **WAL archiving** — enable continuous WAL archiving for point-in-time recovery (PITR). This allows restoring to any moment between nightly dumps.
3. **Retention** — keep nightly dumps for 30 days minimum; WAL segments for 7 days.

### Encryption

- Dumps must be encrypted at rest (server-side encryption on the object store).
- WAL segments inherit the same encryption policy.

---

## Restore drill checklist

Run this checklist on staging **before** enabling production real-money bonuses.

- [ ] Restore latest `pg_dump` to a clean staging database
- [ ] Verify `users` row count matches source snapshot
- [ ] Verify `ledger_entries` aggregate sum (net zero for double-entry)
- [ ] Verify `user_bonus_instances` counts by status (`active`, `completed`, `forfeited`, `expired`)
- [ ] Verify `chat_settings` singleton row exists and values are sane
- [ ] Verify `promotions` / `promotion_versions` published state matches source
- [ ] Run staging E2E smoke suite (deposit → grant → bet → WR → convert)
- [ ] Confirm `payment_ops_flags` are restored correctly (bonuses_enabled, automated_grants_enabled)
- [ ] Confirm `staff_users` and RBAC roles are intact
- [ ] Document restore time and any issues encountered

### PITR drill (quarterly)

- [ ] Pick a random timestamp within the last 24 hours
- [ ] Restore WAL to that timestamp on staging
- [ ] Run the same verification checklist above

---

## Pre-prod gate

> **Restore drill must be completed and signed off before enabling real-money bonuses in production.**

Record the drill results in the `admin_audit_log` or an equivalent sign-off artifact.
