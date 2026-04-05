# Finance exports (ledger → reporting)

## Source data

- **`ledger_entries`**: authoritative cash movements (`amount_minor`, `currency`, `entry_type`, `metadata`, `created_at`).
- **`fystack_payments` / `fystack_withdrawals` / `fystack_checkouts`**: provider correlation and statuses.

## Suggested exports

- **Daily gross gaming revenue (GGR)**: sum `game.debit` − `game.credit` + adjustments, per `currency`, per day (derive with finance).
- **Player liabilities**: sum of positive balances per user from ledger (cash only until BonusHub buckets exist).
- **Reconciliation**: join `deposit.credit` / `withdrawal.debit` idempotency keys to Fystack resource ids stored in `metadata`.

Wire scheduled CSV/Parquet jobs in the data warehouse or BI tool; keep PII out of raw exports where possible.
