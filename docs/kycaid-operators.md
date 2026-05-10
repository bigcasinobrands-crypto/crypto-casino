# KYCAID operators checklist

This stack verifies players through KYCAID hosted forms, persists callbacks, and gates PassimPay withdrawals when internal risk rules or the configured USD threshold require `users.kyc_status = approved`.

## Environment (core API host)

| Variable | Purpose |
|----------|---------|
| `KYCAID_ENABLED` | When `true`, enables `POST /v1/kyc/kycaid/session` and processes `POST /v1/webhooks/kycaid`. Default false if unset. |
| `KYCAID_API_TOKEN` | Outbound `Authorization: Token …` and shared secret for `x-data-integrity` verification (see KYCAID docs). |
| `KYCAID_API_BASE_URL` | Optional; defaults to `https://api.kycaid.com`. |
| `PUBLIC_PLAYER_URL` | Required for redirect URLs after the hosted form (combined with admin “redirect path”). |
| `API_PUBLIC_BASE` | Public origin of the core API (no trailing slash). Used to display the webhook URL in admin (`API_PUBLIC_BASE` + `/v1/webhooks/kycaid`). |
| `KYCAID_WEBHOOK_FAIL_CLOSED` | Defaults to fail-closed in production: invalid integrity → HTTP 401. |
| `WITHDRAW_KYC_GATE_DRY_RUN` | When `true`, logs “would block” for withdraw identity rules without returning `kyc_required`. |
| `KYC_LARGE_WITHDRAWAL_THRESHOLD_CENTS` | Classic large-withdraw gate (USD cents). `0` disables only this threshold; DB risk rules may still apply. |

Secrets belong in the platform secret manager (e.g. Render), never in the repo.

## KYCAID dashboard

1. Create or pick a **form**; copy **form id** into **Admin → System → KYCAID** (stored as `kycaid.settings`).
2. Register **callback URL**: `{API_PUBLIC_BASE}/v1/webhooks/kycaid` (POST JSON). Use the admin page **Copy** button once `API_PUBLIC_BASE` is correct.
3. KYCAID signs callbacks with **HMAC-SHA512** over **Base64(raw JSON body)** using the **same API token** — no separate webhook secret in this integration.

## Database

Apply migration `00081_kycaid_integration.sql` (users columns, `kycaid_verification_events`, default `site_settings` rows).

## Behaviour summary

- **Withdraw gate**: `compliance.RequireApprovedIdentityForWithdraw` blocks with code `kyc_required` when the env threshold and/or **withdraw_kyc_policy** signals fire and `kyc_status ≠ approved`.
- **Player UX**: Profile → Settings → Verify opens KYCAID via `POST /v1/kyc/kycaid/session`; withdraw failures with `kyc_required` deep-link to `/profile?settings=verify`.
- **Callbacks**: Terminal outcomes update `users.kyc_status` (`approved` / `rejected` / `pending`); events are de-duplicated by `request_id` when present.
