# Automated payment jobs — security checklist

- **Idempotency**: All ledger writes use stable keys (`fystack:deposit:…`, `bo:game:debit:…`, `fystack:wdr:…`).
- **Single-flight**: Reconciliation runs on a ticker in `cmd/worker`; avoid overlapping cron without advisory locks if you add a second scheduler.
- **Secrets**: Never log `FYSTACK_API_SECRET` or webhook bodies containing PII; redact structured logs.
- **RBAC**: Mutating ops (`PATCH /ops/payment-flags`, `POST /ops/reconcile-fystack`, `POST /ops/provision-fystack-wallet`) require **superadmin** and write `admin_audit_log`.
- **Least privilege**: Use a DB role for workers limited to payment tables if you split roles in production.
