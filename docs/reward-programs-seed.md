# Reward programs (operator setup)

Reward hub features read from the `reward_programs` table (migration `00024_rewards_hub.sql`). Each row points at a **published** `promotion_versions.id` so grants use the same WR / risk / ledger path as other bonuses.

## Admin API

- `GET /admin/.../bonushub/reward-programs` — list programs (staff session).
- `POST /admin/.../bonushub/reward-programs` — create (superadmin). Body:

```json
{
  "program_key": "daily_login_v1",
  "kind": "daily_fixed",
  "promotion_version_id": 1,
  "config": { "amount_minor": 100 },
  "enabled": true,
  "priority": 10
}
```

## Kinds and config

| kind | config JSON | notes |
|------|-------------|--------|
| `daily_fixed` | `{ "amount_minor": 100 }` | One claim per UTC day per user (7-day back window). |
| `daily_hunt` | `{ "thresholds_wager_minor": [10000, 50000], "amounts_minor": [50, 200] }` | Cash wager from `game.debit` (cash pocket) per UTC day; worker grants when thresholds crossed. |
| `wager_rebate` | `{ "period": "daily", "percent": 5, "cap_minor": 50000 }` | Settles **yesterday** UTC; weekly uses `"period":"weekly"` (runs Monday for prior week). |
| `cashback_net_loss` | `{ "period": "daily", "percent": 10, "cap_minor": 100000 }` | Base = net loss on cash game entries in window (negative net only). |

## SQL seed example

Replace `promotion_version_id` with a real published version id from your environment.

```sql
INSERT INTO reward_programs (program_key, kind, promotion_version_id, config, enabled, priority)
VALUES (
  'daily_login_v1',
  'daily_fixed',
  1,
  '{"amount_minor": 100}'::jsonb,
  true,
  100
);

INSERT INTO reward_programs (program_key, kind, promotion_version_id, config, enabled, priority)
VALUES (
  'hunt_daily_v1',
  'daily_hunt',
  1,
  '{"thresholds_wager_minor": [5000, 25000], "amounts_minor": [25, 100]}'::jsonb,
  true,
  50
);
```

The worker must run for hunt milestones and periodic rebates (`cmd/worker` 15-minute loop).
