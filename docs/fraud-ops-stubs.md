# Fraud operations (stubs)

Extend beyond velocity checks:

- **Signals**: device fingerprint, IP/geo mismatch, rapid deposit→withdraw, linked accounts.
- **Lists**: internal blocklist for user ids, addresses, and email domains; audit all changes in `admin_audit_log`.
- **Cases**: hold withdrawals in `payment_ops_flags` or per-user flags (future column); analyst queue in admin console.

Hook risk scores into `POST /v1/wallet/withdraw` and Fystack withdrawal approval flows when a vendor or internal engine is chosen.
