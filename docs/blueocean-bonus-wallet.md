# BlueOcean seamless wallet and BonusHub

## Current integration

- **Operator contract** (URLs, `key`, JSON shape): see [Blue Ocean seamless integration](https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172128/Seamless+integration) and debit/credit/rollback pages.
- Callback: [`blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go) — `action` / `command` `balance`, `debit`, `credit`, `rollback` (aliases `bet` → `debit`, `win` → `credit`). Methods supported: **GET** (documented by BO) and **POST** with JSON/form where testers send a body (merged with query for signature checks).
- Response: JSON `{"status":<int>,"balance":<number>}` with **balance in major units** as a JSON number (e.g. `{"status":200,"balance":300}` or `{"status":200,"balance":0.4}`), optional `msg`. Numeric encoding matches strict comparisons in Blue Ocean test tooling. **Zero-amount debits** return `status` 200 and unchanged balance. **Rollback** uses only stored debit amounts for `transaction_id`; if no debit, `status` 404.
- Idempotency: `bo:game:debit:{cash|bonus}:{remote}:{txnID}`, `bo:game:credit:…`, `bo:game:rollback:…`. **Duplicate debit** requests with the same `transaction_id` return the current balance without applying the stake again.

## Adapter contract (BonusHub)

1. **Playable balance** returned to BlueOcean = sum of ledger lines in pockets **`cash`** + **`bonus_locked`** for the user (same currency as configured for BO wallet).
2. **Debit allocator** (deterministic): consume **`cash`** first, then **`bonus_locked`**, until the stake is covered. One or two ledger lines with distinct idempotency keys `bo:game:debit:cash:…` / `bo:game:debit:bonus:…`. **Duplicate** `debit` calls with the same `transaction_id` short-circuit via net ledger effect for that txn (no second charge); `ON CONFLICT DO NOTHING` on keys remains a safety net.
3. **Credit / rollback**: mirror policy used at debit (document: wins return to the pocket that funded the stake — MVP: credit **`bonus_locked`** up to prior debit from bonus, overflow **`cash`**; rollback reverses prior lines idempotently).
4. **Insufficient funds**: if combined playable < amount → **`403`** (BO JSON status, with `msg` e.g. insufficient funds) and current **numeric** balance in the JSON body.

## Free rounds / separate bonus wallet

- Not observed in our callback surface. If BlueOcean adds `free_round` or dual-wallet fields, add a thin adapter branch without rewriting the core bonus engine.
- Validate against the **integration PDF / partner portal** before go-live.

## References

- Code: [`services/core/internal/webhooks/blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go)
