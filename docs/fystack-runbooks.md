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
