# PassimPay operations runbooks

Cashier rail is **PassimPay** (H2H deposit address + withdrawals). The **ledger** is the book of record; `payment_*` tables are operational mirrors.

## Webhook verification failures

1. Confirm `PASSIMPAY_PLATFORM_ID`, `PASSIMPAY_SECRET_KEY`, and `PASSIMPAY_WEBHOOK_SECRET` match the PassimPay dashboard environment.
2. Ensure `POST /v1/webhooks/passimpay` is reachable from PassimPay (public URL + TLS).
3. Check API logs for `invalid signature` — compare raw body verification against what PassimPay signs.

## Deposit not credited

1. Inspect `payment_deposit_callbacks` and `processed_callbacks` for the transaction / order id.
2. Confirm `payment_deposit_intents` has the expected `user_id` for the provider order.
3. Verify ledger idempotency keys for the credit (`passimpay:deposit:fund:*` pattern in application code).

## Withdrawal stuck or failed

1. Inspect `payment_withdrawals` where `provider = 'passimpay'` — statuses `LEDGER_LOCKED`, `SUBMITTED_TO_PROVIDER`, `FAILED`, etc.
2. On provider failure after ledger lock, confirm compensating ledger entries ran (unlock / compensation paths in `passimpay_withdraw.go`).
3. Review worker/API logs for PassimPay HTTP errors (timeouts, 4xx/5xx).

## Blue Ocean seamless errors

1. Validate `BLUEOCEAN_WALLET_SALT` and callback URL registration.
2. Review logs for `402` (insufficient balance) vs signature failures.
3. Ensure `BLUEOCEAN_CURRENCY` matches ledger currency used for game debits/credits.

## BonusHub (deposit → bonus)

1. After a **new** `deposit.credit` ledger line, evaluation uses deposit index / FTD signals from the ledger path (not provider-specific tables alone).
2. Evaluation runs on the `bonus_payment_settled` queue; if Redis enqueue fails, processing may run inline.
3. On evaluation **errors**, inspect `worker_failed_jobs` with `job_type = bonus_payment_settled`.
