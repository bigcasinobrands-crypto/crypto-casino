# BlueOcean seamless wallet and BonusHub

## Current integration

- **Operator contract** (URLs, `key`, JSON shape): see [Blue Ocean seamless integration](https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172128/Seamless+integration) and debit/credit/rollback pages.
- Callback: [`blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go) — `action` / `command` `balance`, `debit`, `credit`, `rollback` (aliases `bet` → `debit`, `win` → `credit`). Methods supported: **GET** (documented by BO) and **POST** with JSON/form where testers send a body (merged with query for signature checks).
- Response: JSON `{"status":<int>,"balance":<number>}` with **balance in major units** as a JSON number (e.g. `{"status":200,"balance":300}` or `{"status":200,"balance":0.4}`), optional `msg`. Numeric encoding matches strict comparisons in Blue Ocean test tooling. **HTTP** responses use status **200**; business outcome is in the JSON `status` field (per [BO seamless overview](https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172128/Seamless+integration)). **Zero-amount debits** return JSON `status` 200 and unchanged balance.
- **Rollback** (empty `amount` is fine): **bet rollback** restores funds from stored `bo:game:debit:*` lines for `transaction_id`; **win rollback** debits back a prior `bo:game:credit` for the same id (`game.win_rollback` in ledger). Unknown `transaction_id` → JSON `status` **404** and `TRANSACTION_NOT_FOUND`. Repeating the same rollback after it already applied → **200** and current balance (idempotent replay).
- Idempotency: `bo:game:debit:{cash|bonus}:{remote}:{txnID}`, `bo:game:credit:…`, `bo:game:rollback:{bonus|cash}:…`, `bo:game:rollback:win:…`. **Duplicate debit** requests with the same `transaction_id` return the current balance without applying the stake again.
- **Concurrent / stress tests:** the handler uses a longer callback timeout and **retries** transient Postgres errors (deadlock `40P01`, serialization `40001`) so parallel BO requests for the same player do not surface as JSON `500 Internal error` spuriously.

## Game launch (player)

Real-money launch calls BO XAPI **`getGame`** (or demo flows via **`getGameDemo`**) with the operator’s `userid` / `user_username` matching **`blueocean_player_links.remote_player_id`** and a non-zero `games.bog_game_id` from catalog sync. If launches fail, check: `BLUEOCEAN_API_BASE_URL` + credentials, IP allowlisting, **`createPlayer`** / link row for the account, catalog sync (`bog_game_id`), and `BLUEOCEAN_LAUNCH_MODE` / fun-play flags vs game row. Code path: [`games/handlers.go` LaunchHandler](../services/core/internal/games/handlers.go).

## Adapter contract (BonusHub)

1. **Playable balance** returned to BlueOcean = sum of ledger lines in pockets **`cash`** + **`bonus_locked`** for the user (same currency as configured for BO wallet).
2. **Debit allocator** (deterministic): consume **`cash`** first, then **`bonus_locked`**, until the stake is covered. One or two ledger lines with distinct idempotency keys `bo:game:debit:cash:…` / `bo:game:debit:bonus:…`. **Duplicate** `debit` calls with the same `transaction_id` short-circuit via net ledger effect for that txn (no second charge); `ON CONFLICT DO NOTHING` on keys remains a safety net.
3. **Credit / rollback**: wins credit **`cash`** (`game.credit`). **Bet rollback** restores bonus/cash via `game.rollback` credits. **Win rollback** removes a prior win with `game.win_rollback` (cash debit), idempotent on `bo:game:rollback:win:{remote}:{txnID}`.
4. **Insufficient funds**: if combined playable < amount → **`403`** (BO JSON status, with `msg` e.g. insufficient funds) and current **numeric** balance in the JSON body.

## Free rounds / separate bonus wallet

- Not observed in our callback surface. If BlueOcean adds `free_round` or dual-wallet fields, add a thin adapter branch without rewriting the core bonus engine.
- Validate against the **integration PDF / partner portal** before go-live.

## References

- Code: [`services/core/internal/webhooks/blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go)
