# Ledger & wallet state machine (Phase 1)

## Ledger entry

- **Insert:** `ledger_entries` with unique `idempotency_key` (`ON CONFLICT DO NOTHING` via `ledger.ApplyCredit`).
- **Balance:** Sum of `amount_minor` per `user_id` (no floats).

## Deposit (Fystack)

1. Player `POST /v1/wallet/deposit-session` → row in `fystack_checkouts` (`pending`).
2. Provider checkout + payment webhooks → `fystack_payments` updated.
3. Worker (or sync fallback) calls `ProcessFystackPayment` when `status` ∈ {completed, succeeded, paid} → `ledger.ApplyCredit` idempotency `fystack:pay:{id}`.

## Withdraw

1. Player `POST /v1/wallet/withdraw` → `fystack_withdrawals` (`pending`).
2. Provider status webhooks update row; ledger debit (add `ApplyDebit` + idempotency before production).

## BlueOcean

1. `POST /v1/webhooks/blueocean` → `blueocean_events` (`queued`).
2. Worker → `ProcessBlueOceanEvent` maps `user_id` + `credit_minor` from payload (replace with real mapping).

## Admin audit

- `admin_audit_log` records staff login; extend for freeze/refund actions.
