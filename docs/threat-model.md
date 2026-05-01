# Lightweight threat model (Phase 1)

STRIDE-oriented view of trust boundaries: **browser** (player/admin SPA), **API**, **Postgres**, **Redis**, **workers**, **BlueOcean**, **Fystack**.

| Asset | Threats | Mitigations (baseline) |
|-------|-----------|-------------------------|
| **Staff JWT / refresh** | Theft, replay | Short access TTL; refresh rotation; HTTPS only; CORS allowlist on `/v1/admin`; audit log on login. |
| **Player JWT / refresh** | Same | Short access TTL; refresh rotation; HTTPS. Optional **cookie sessions** (`PLAYER_COOKIE_AUTH`): httpOnly access/refresh + readable CSRF cookie; mutating `/v1` requires `X-CSRF-Token`. Optional **omit JSON tokens** (`PLAYER_COOKIE_OMIT_JSON_TOKENS`) when clients use cookies only; credentialed player SPA sets `VITE_PLAYER_CREDENTIALS`. |
| **Ledger integrity** | Double credit, forged events | Idempotency keys; webhook signature verify (configure secrets); single `ApplyLedger` path; worker + DB constraints. |
| **Webhook endpoints** | Flooding, forged payloads | Rate limits; verify signature before enqueue; reject invalid body. |
| **Admin actions** | Privilege abuse | RBAC on routes; audit log extension for money-moving actions (when added). |
| **Secrets in repo** | Leak | `.gitignore` `.env`; CI secrets; no keys in client bundles. |

| **Chat moderation** | Impersonation, abuse by players | All mod actions (delete/mute/ban/broadcast/settings/blocked-terms) moved to `/v1/admin/chat/*` under staff JWT + RBAC; player routes are read-only (WS + history). Audit log on every mod action with staff_user_id + reason. |
| **BonusHub grants** | Duplicate bonus, abuse | Idempotency keys per deposit×promo; single active WR gate; `grants_paused` per-promo kill switch; superadmin-only manual grant bypasses pause; all mutations audit-logged. |
| **Bonus abuse policy** | Velocity farming, promo brute force | `site_settings.bonus_abuse_policy` tunable limits; `PreGrantRiskCheck` + `bonus_risk_decisions` audit; publish-time dedupe (`offer_family` + `eligibility_fingerprint`); metric `bonus_abuse_denied_total` in ops snapshot. |
| **VIP accrual** | Double points | `vip_point_ledger.idempotency_key` = `vip:accrual:{ledger_entry_id}`; worker batch is idempotent. |
| **Bonus withdraw** | Cash-out before WR | `withdraw.go` enforces active-WR policy (`lock_until_complete` / `forfeit_on_withdraw`); bonus_locked pocket cannot be directly withdrawn; `CheckBetAllowedTx` enforces max-bet and excluded games in-tx. |
| **Worker DLQ** | Silent failures | Failed `bonus_payment_settled` inserts into `worker_failed_jobs`; admin GET + retry (superadmin); resolved_at prevents duplicate re-enqueue. |
| **Custody & payout keys** | Theft of Fystack / treasury creds; insider abuse of elevated Vault access | Fystack holds MPC funds; platform stores **FYSTACK_*** only server-side; target **Vault KV** + KMS auto-unseal (see `security/terraform/aws/vault-kms`). **Break-glass:** `break_glass_grants` + dual superadmin (`/v1/admin/security/break-glass/*`); time-boxed approval; `admin_audit_log` on create/approve/reject/consume. |

**Update when:** adding new webhooks, OAuth, or admin money tools.
