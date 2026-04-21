# BlueOcean seamless wallet and BonusHub

## Current integration

- Callback: `GET` on [`blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go) with `action` / `command` `balance`, `debit`, `credit`, `rollback` (aliases `bet` → `debit`, `win` → `credit`).
- Response: JSON `{"status":"200|402|...","balance":"<integer>"}` — **single balance integer** exposed to the provider.
- Idempotency: `bo:game:debit:{remote}:{txnID}`, `bo:game:credit:…`, `bo:game:rollback:…`.

## Adapter contract (BonusHub)

1. **Playable balance** returned to BlueOcean = sum of ledger lines in pockets **`cash`** + **`bonus_locked`** for the user (same currency as configured for BO wallet).
2. **Debit allocator** (deterministic): consume **`bonus_locked`** balance first, then **`cash`**, until the stake is covered. Write one or two ledger lines with correct `pocket` metadata and distinct idempotency keys suffixes if split (e.g. `bo:game:debit:{remote}:{txnID}:bonus` / `:cash`) — **same txnID must always produce the same split** on replay (`ON CONFLICT DO NOTHING` on keys).
3. **Credit / rollback**: mirror policy used at debit (document: wins return to the pocket that funded the stake — MVP: credit **`bonus_locked`** up to prior debit from bonus, overflow **`cash`**; rollback reverses prior lines idempotently).
4. **Insufficient funds**: if combined playable < amount → `402` with current total as balance string.

## Free rounds / separate bonus wallet

- Not observed in our callback surface. If BlueOcean adds `free_round` or dual-wallet fields, add a thin adapter branch without rewriting the core bonus engine.
- Validate against the **integration PDF / partner portal** before go-live.

## References

- Code: [`services/core/internal/webhooks/blueocean_wallet.go`](../services/core/internal/webhooks/blueocean_wallet.go)
