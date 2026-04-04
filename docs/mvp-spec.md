# MVP specification (v1 locks)

| Decision | Baseline choice (adjust per market) |
|----------|-------------------------------------|
| **Games** | BlueOcean-first; in-house originals deferred. |
| **Assets** | USDT minor units in ledger (`amount_minor`); extend `currency` column for multi-asset. |
| **Fystack** | Deposit session + withdrawal request rows + webhooks → ledger (stubs until REST/SDK wired). |
| **Success metrics (product)** | Player completes register → deposit session created → play launch URL loads → withdrawal row created; staff sees users, ledger, webhooks in admin. |
| **Success metrics (engineering)** | `/health/ready` green; migrations applied; worker drains queue with Redis; idempotent ledger keys enforced. |
