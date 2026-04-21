# Fystack operations runbooks

## Webhook verification failures

1. Confirm `FYSTACK_*` credentials and `FYSTACK_BASE_URL` match the workspace (sandbox vs prod).
2. Fetch a fresh Ed25519 key via `GET .../webhook-verification-key` (the API caches for a few minutes).
3. Ensure the raw HTTP body is verified against **canonical JSON** (sorted keys), not a re-serialized variant from a proxy.

## Deposit not credited

1. Check `fystack_webhook_deliveries` for the `deposit.confirmed` row and `processed` flag.
2. Confirm `fystack_wallets.provider_wallet_id` maps the payload `wallet_id` to the correct `user_id`.
3. Re-run **Payments ops → Reconcile** (superadmin) or wait for the worker ticker to call `ReconcileStaleFystackDeliveries`.

## Withdrawal stuck or failed

1. Inspect `fystack_withdrawals.status` and `provider_withdrawal_id`.
2. On `withdrawal.failed` webhooks, the ledger should receive a compensating `withdrawal.compensation` line (idempotent key `fystack:wdr_comp:...`).
3. If the provider API errored at request time, check for `withdrawal.compensation` with key `fystack:wdr_api_fail:...`.

## Blue Ocean seamless errors

1. Validate `BLUEOCEAN_WALLET_SALT` and callback URL registration.
2. Review logs for `402` (insufficient balance) vs signature failures.
3. Ensure `BLUEOCEAN_CURRENCY` matches ledger currency used for game debits/credits.

## BonusHub (deposit → bonus)

1. After a **new** `deposit.credit` or `deposit.checkout` ledger line, the API/worker emits `PaymentSettled` with `deposit_index` (1-based count of successful deposit credits for that user) and `first_deposit` (`deposit_index == 1`). Promotion `rules.trigger` may use `first_deposit_only`, `nth_deposit`, and `channels` (e.g. `on_chain_deposit`, `hosted_checkout`).
2. Evaluation runs on the `bonus_payment_settled` queue; if Redis enqueue fails, the webhook/worker runs `EvaluatePaymentSettled` inline.
3. On evaluation **errors**, a row is written to `worker_failed_jobs` with `job_type = bonus_payment_settled` and the JSON payload. List via admin `GET /v1/admin/bonushub/worker-failed-jobs?job_type=bonus_payment_settled` after fixing the underlying issue, replay by re-enqueueing the job or calling evaluate with the same payload (idempotency prevents double grants).
4. Per-promotion pause: `PATCH /v1/admin/bonushub/promotions/{id}` with `{"grants_paused": true}` blocks automated grants for that promotion; superadmin manual grant still works.
