# BonusHub idempotency key namespaces

All money-affecting inserts use `ledger_entries.idempotency_key` UNIQUE or equivalent `ON CONFLICT DO NOTHING`.

| Prefix | Example | Owner |
|--------|---------|--------|
| `fystack:deposit:` | `fystack:deposit:{resource_id}` | Fystack webhook |
| `fystack:checkout:` | `fystack:checkout:{resource_id}` | Fystack webhook |
| `fystack:pay:` | `fystack:pay:{payment_id}` | Legacy payment processor |
| `bo:game:debit:` | `bo:game:debit:{remote}:{txnID}` (+ optional `:bonus`/`:cash` split) | BlueOcean wallet |
| `bo:game:credit:` | `bo:game:credit:{remote}:{txnID}` | BlueOcean wallet |
| `bo:game:rollback:` | `bo:game:rollback:{remote}:{txnID}` | BlueOcean wallet |
| `bonus:grant:` | `bonus:grant:{source}:{id}:{promotion_version_id}` | BonusHub grant |
| `promo.convert:` | `promo.convert:{instance_id}` | WR completion → cash |
| `promo.forfeit:` | `promo.forfeit:{instance_id}` | Forfeit bonus balance |
| `bonus:auto:` | `bonus:auto:{rule_id}:{user_id}:{period_or_event_id}` | Automation rules |

Collision rule: **never reuse** a key for a different semantic operation. Retries must send the **same** key.
