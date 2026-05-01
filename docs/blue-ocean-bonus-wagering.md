# Blue Ocean wallet integration — game wallet vs bonus wagering

This document clarifies how **seamless wallet** callbacks from Blue Ocean (BO) relate to the **in-house bonus engine** (`services/core/internal/bonus`). It satisfies the “Blue Ocean contract documented” item in `bonus-enterprise-gap-analysis.md` (§10).

## What the BO callback does

- **Route:** `GET /api/blueocean/callback` (see `internal/webhooks/blueocean_wallet.go`).
- **Actions:** `balance`, `debit` (bets), `credit` (wins), `rollback` — all against the **unified** player balance (cash + `bonus_locked` in minor units of `BLUEOCEAN_CURRENCY`).
- **Wagering requirement (WR):** WR progress is applied **only** on the portion of a **debit** that is taken from the **`bonus_locked` ledger pocket** (promo / locked bonus). Cash-funded stakes do not advance WR in this path.

## Flow (debit)

1. `CheckBetAllowedTx` enforces max bet, excluded/allowed game lists, and may record max-bet violations.
2. Debits are split: up to the available `bonus_locked` balance from that pocket, remainder from `cash` (if both are needed to cover the stake).
3. `ApplyPostBetWagering` runs with **`fromBonus` = amount debited from `bonus_locked`**. It updates `wr_contributed_minor` and may **complete** the instance (`promo.convert` to move residual bonus to `cash`).

**BO events that are not “bonus-affecting” in code today**

- `credit` / `win` lines only post `game.credit` to the **default** path (not split by pocket in a way that changes the bonus engine here).
- `rollback` reverses prior debits; there is no separate WR “undo” in this file — if product requires full symmetry, that would be a follow-up (not implemented here).

## Free spins / XAPI

Outbound **free rounds** grants and per-spin result webhooks are **not** implemented in the legacy seamless-wallet handler above. The `internal/bonusblueocean/sync.go` area is a stub / dry-run until a product-specific BO contract is agreed. The bonus **type** in registry is `free_spins_only`.

## Live WR updates (Redis)

When **`REDIS_URL`** is configured on the API, after a **successful** `debit` transaction that applied WR (`fromBonus > 0` from bonus pocket), the API **PUBLISH**es a JSON message to:

- **Channel:** `wagering:player:{user_id}` (per player).

**Payload shape (versioned):**

| Field | Meaning |
|-------|---------|
| `v` | Schema version (currently `1`). |
| `user_id` | Player UUID. |
| `active` | `true` if there is an in-progress WR instance, else `false`. |
| `instance_id` | `user_bonus_instances.id` (when `active`). |
| `wr_required_minor` / `wr_contributed_minor` | Integers in minor units. |
| `pct_complete` | Rounded percentage, 0–100. |

The player SPA can keep using **`GET /v1/rewards/hub`** and **`GET /v1/wallet/bonuses`**; Redis is optional real-time **fan-out** (e.g. a future WebSocket or worker bridge that subscribes and pushes to the browser). No subscriber ships in this repo by default.

## Idempotency

- Ledger lines use idempotency keys that include BO `remote_id` and `transaction_id` (and pocket for split debits) so retries do not double-post.
- WR is updated inside the same DB transaction as the debit; the Redis publish runs **only after** commit.

## Related

- `docs/bonus-max-bet-violations-policy.md` — max stake enforcement and compliance.
- `docs/bonus-e2e.md` — opt-in Go test: grant → `ApplyPostBetWagering` → complete.
- `docs/bonus-enterprise-gap-analysis.md` — overall vs enterprise spec.
