# BlueOcean seamless wallet and BonusHub

## Current integration

- **Operator contract** (URLs, `key`, JSON shape): see [Blue Ocean seamless integration](https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172128/Seamless+integration) and debit/credit/rollback pages.
- Callback: [`blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go) — `action` / `command` `balance`, `debit`, `credit`, `rollback` (aliases `bet` → `debit`, `win` → `credit`). Methods supported: **GET** (documented by BO) and **POST** with JSON/form where testers send a body (merged with query for signature checks).
- Response: JSON `{"status":<int>,"balance":"<decimal major>"}` (e.g. `{"status":200,"balance":"300.00"}`), optional `msg`, per BO examples. **Zero-amount debits** return `status` 200 and unchanged balance. **Rollback** uses only stored debit amounts for `transaction_id`; if no debit, `status` 404.
- Idempotency: `bo:game:debit:{remote}:{txnID}`, `bo:game:credit:…`, `bo:game:rollback:…`.

## Adapter contract (BonusHub)

1. **Playable balance** returned to BlueOcean = sum of ledger lines in pockets **`cash`** + **`bonus_locked`** for the user (same currency as configured for BO wallet).
2. **Debit allocator** (deterministic): consume **`bonus_locked`** balance first, then **`cash`**, until the stake is covered. Write one or two ledger lines with correct `pocket` metadata and distinct idempotency keys suffixes if split (e.g. `bo:game:debit:{remote}:{txnID}:bonus` / `:cash`) — **same txnID must always produce the same split** on replay (`ON CONFLICT DO NOTHING` on keys).
3. **Credit / rollback**: mirror policy used at debit (document: wins return to the pocket that funded the stake — MVP: credit **`bonus_locked`** up to prior debit from bonus, overflow **`cash`**; rollback reverses prior lines idempotently).
4. **Insufficient funds**: if combined playable < amount → **`403`** (BO JSON status, with `msg` e.g. insufficient funds) and current balance as decimal string per seamless contract.

## Free rounds / separate bonus wallet

- Not observed in our callback surface. If BlueOcean adds `free_round` or dual-wallet fields, add a thin adapter branch without rewriting the core bonus engine.
- Validate against the **integration PDF / partner portal** before go-live.

## References

- Code: [`services/core/internal/webhooks/blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go)
