# Blue Ocean wallet integration — game wallet vs bonus wagering

This document clarifies how **seamless wallet** callbacks from Blue Ocean (BO) relate to the **in-house bonus engine** (`services/core/internal/bonus`). It satisfies the “Blue Ocean contract documented” item in `bonus-enterprise-gap-analysis.md` (§10).

## What the BO callback does

- **Route:** `GET /api/blueocean/callback` (see `internal/webhooks/blueocean_wallet.go`).
- **Actions:** `balance`, `debit` (bets), `credit` (wins), `rollback` — all against the **unified** player balance (cash + `bonus_locked` in minor units of `BLUEOCEAN_CURRENCY`).
- **Wagering requirement (WR):** While the player has an **active** bonus instance with unfinished WR, WR progress is applied from the **full debit stake** (cash + `bonus_locked` portions combined), after **game/category weights** and **allowed/excluded game lists** (same rules as `CheckBetAllowedTx`). Split ledger lines (cash-first debit + optional bonus line) still correspond to **one** stake for WR purposes.

## Flow (debit)

1. `CheckBetAllowedTx` enforces max bet, excluded/allowed game lists, and may record max-bet violations.
2. Debits are split: up to available **cash** is spent first, then **`bonus_locked`** (enterprise promo policy for playable balance).
3. `ApplyPostBetWagering` runs with **`stakeMinor` = full requested debit amount**. It updates `wr_contributed_minor` and may **complete** the instance (`promo.convert` to move residual bonus to `cash`).

**BO events that are not “bonus-affecting” in code today**

- `credit` / `win` lines only post `game.credit` to the **default** path (not split by pocket in a way that changes the bonus engine here).

## Flow (rollback — bet stake)

`rollback` reverses prior **debit** lines (bonus + cash). When new `game.rollback` ledger rows are inserted:

- **VIP:** Per-pocket reversal rows (`vip:rollback:cash:`… / `vip:rollback:bonus:`…) mirror accrual from stake lines.
- **WR:** One rollback adjustment uses the **sum** of newly inserted rollback magnitudes (matches how debit applied WR on the full stake).

## Free spins / XAPI

Outbound **free rounds** grants and per-spin result webhooks are **not** implemented in the legacy seamless-wallet handler above. The `internal/bonusblueocean/sync.go` area is a stub / dry-run until a product-specific BO contract is agreed. The bonus **type** in registry is `free_spins_only`.

## Live WR updates (Redis)

When **`REDIS_URL`** is configured on the API, after a **successful** `debit` or qualifying `rollback` transaction that **changed** WR (`wr_contributed_minor`), the API **PUBLISH**es a JSON message to:

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
