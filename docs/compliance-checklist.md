# Compliance & product checklist (crypto)

This is a **non-legal** engineering checklist. Owners: product, legal, and risk.

- **KYC / AML**: Define when deposit, play, and withdraw are allowed; document velocity limits.
- **Jurisdiction**: Geo + sanctions policy; align blocked countries with `BLOCKED_COUNTRY_CODES` and future wallet screening.
- **Custody disclosure**: Terms/FAQ describing MPC/custodial model via Fystack.
- **Responsible gambling**: Links to self-exclusion and account closure (already enforced on auth/launch/seamless paths).
- **Confirmation policy**: Only `deposit.confirmed` credits the ledger; document any use of `deposit.pending` for UI-only states.
- **Admin controls**: `payment_ops_flags` for deposits, withdrawals, and real play; audit via `admin_audit_log`.
