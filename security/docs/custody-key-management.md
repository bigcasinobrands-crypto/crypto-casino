# Custody and key management

This document aligns **key custody** with the **current production-shaped stack**: [Fystack](https://docs.fystack.io/) (MPC wallets, hosted checkout, treasury-backed withdrawals), the Go API in `services/core`, and **HashiCorp Vault** for platform secrets. It is the authority for naming **Vault KV paths**, **Terraform KMS** usage, and **break-glass** procedures.

## Current custody model (Fystack as custodian)

| Layer | What it holds | “Temperature” | Notes |
|-------|----------------|---------------|--------|
| **User balances** | Ledger rows in Postgres + Fystack per-user wallets | N/A (database + provider) | On-chain funds sit in Fystack’s MPC architecture; you do **not** hold raw user key shares. |
| **Outbound payouts** | `FYSTACK_TREASURY_WALLET_ID` + API credentials | **Operational / warm** | Treasury wallet is hot enough to fund withdrawals via API; protect credentials like signing keys. |
| **Webhook verification** | `FYSTACK_WEBHOOK_VERIFICATION_KEY` (Ed25519 pub) or runtime fetch | **Warm** | Never ship to browsers; store only server-side (Vault KV). |
| **BlueOcean / other integrators** | XAPI login/password, wallet salt | **Warm** | Same as above. |
| **JWT secrets** | `JWT_SECRET`, `PLAYER_JWT_SECRET` | **Warm** | Rotate on compromise; prefer separate player vs staff secrets (already supported in config). |

**Cold** in this architecture is **not** an on-prem paper wallet managed by this repo; it is **provider-level** cold storage inside Fystack’s trust model plus your **contracts and exit plans** with the PSP. If you later add **self-custody** on-chain signing, add a dedicated “cold key ceremony” subsection and hardware-backed keys (HSM or cloud KMS **asymmetric sign**, not a raw seed in Vault).

## Hot / warm / cold (platform perspective)

- **Hot**: Processes that can move funds or alter ledger **without** a second human step (API using treasury creds, automated workers). Constrain with IP allowlists, mTLS, rate limits, and **separate** Vault policies.
- **Warm**: Secrets that authorize the hot path but are **not** pasted into CI logs—served via Vault Agent / dynamic secrets where possible.
- **Cold**: Offline or HSM-protected **root of trust**: Vault unseal recovery keys, cloud account break-glass users, multisig treasury policies **outside** this application’s day-to-day config.

## Multisig and signing ceremony

1. **Treasury policy (Fystack)**: Configure **threshold approvals** in the Fystack workspace for withdrawals and treasury moves. Document the quorum in your ops runbook (who can approve, backup approvers).
2. **No single-human payout**: Large withdrawals should require **manual approval** in admin (`/v1/admin/withdrawals/...`) plus provider-side rules where available.
3. **Future self-custody**: Use a **multisig contract** or **KMS/HSM-backed** signing with an M-of-N policy; never store raw hex seeds in Postgres or `.env`.

## HSM vs cloud KMS

| Need | Recommendation |
|------|----------------|
| **Vault auto-unseal / seal wrap** | Cloud **KMS** (e.g. AWS KMS in [`terraform/aws/vault-kms`](../terraform/aws/vault-kms)) — encrypts unseal material; not a general transaction signer. |
| **High-value signing (future)** | **Cloud HSM** (AWS CloudHSM, GCP HSM keys) or dedicated appliance; integrate via Vault **PKI** / **Transit** with **ECDSA** keys marked **non-exportable**. |
| **Application MAC (Fystack API)** | HMAC with API secret from Vault KV — keep **Transit** for things you want to audit and rotate without pushing plaintext to apps. |

## Vault KV layout (convention)

Mount **KV v2** at path `casino` (dev bootstrap creates this). Suggested paths:

| Path | Contents |
|------|-----------|
| `casino/data/integrations/fystack` | `FYSTACK_API_KEY`, `FYSTACK_API_SECRET`, `FYSTACK_WORKSPACE_ID`, `FYSTACK_WEBHOOK_VERIFICATION_KEY`, treasury IDs |
| `casino/data/integrations/blueocean` | `BLUEOCEAN_API_LOGIN`, `BLUEOCEAN_API_PASSWORD`, `BLUEOCEAN_WALLET_SALT`, … |
| `casino/data/app` | `JWT_SECRET`, `PLAYER_JWT_SECRET`, `DATABASE_URL` (if not using managed rotation), Redis password reference |

Application injection: **Vault Agent** templates → env files or `envconsul`-style reload; do **not** commit rendered files.

## Break-glass (time-bound, audited)

**Break-glass** is for emergencies: recovering Vault access, overriding a stuck payout flag, or reading elevated secrets when normal policy blocks it.

### Human process

1. Open a **break-glass grant** (superadmin): `POST /v1/admin/security/break-glass/grants` with JSON `{"resource_key":"...","justification":"..."}` (justification ≥ 10 characters).
2. A **different** superadmin **approves** (out-of-band confirmation recommended): `POST /v1/admin/security/break-glass/grants/{id}/approve` with optional `{"ttl_minutes":240}` (default 240, max 1440).
3. Grant is valid until `expires_at`. Perform the minimum action, then close it: `POST /v1/admin/security/break-glass/grants/{id}/consume` with optional `{"note":"…"}`.
4. Reject a mistaken request: `POST /v1/admin/security/break-glass/grants/{id}/reject` with `{"reason":"…"}`.
5. List recent grants: `GET /v1/admin/security/break-glass/grants`.
6. All mutations write **`admin_audit_log`** (`break_glass.create|approve|reject|consume`); rows live in **`break_glass_grants`**.

### `resource_key` conventions (extensible)

Use stable strings so automation can gate behavior:

- `vault:kv:read:integrations/fystack` — policy elevation to read Fystack KV (pair with Vault token issuance out-of-band).
- `vault:kv:read:integrations/blueocean`
- `ops:payment-flags:emergency-unlock` — document matching manual or future automated checks.
- `cloud:aws:break-glass-console` — **process only**: no API key in DB; indicates approved window for IdP/cloud break-glass user use.

### Vault side

Issue **short-lived tokens** (TTL ≤ grant window) with the **break-glass** policy after approval. Revoke tokens when the grant is **consumed** or expired.

## Terraform

The [`terraform/aws/vault-kms`](../terraform/aws/vault-kms) module provisions a **KMS key** for Vault **auto-unseal**. It does **not** replace backup/recovery procedures or organization-level break-glass accounts.

## Related code

- Fystack config: [`services/core/internal/config/config.go`](../../services/core/internal/config/config.go)
- Withdrawals / treasury: [`services/core/internal/wallet/withdraw.go`](../../services/core/internal/wallet/withdraw.go)
- Admin audit: `admin_audit_log`; break-glass: `break_glass_grants`, handlers in [`services/core/internal/adminops/break_glass.go`](../../services/core/internal/adminops/break_glass.go)
