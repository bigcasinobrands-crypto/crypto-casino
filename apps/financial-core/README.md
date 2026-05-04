# Financial core (Enterprise crypto casino — modular monolith)

This package is the **unified financial authority** for the platform: **double-entry ledger**, **domain events**, **BullMQ** workers, and future modules (deposits, withdrawals, BlueOcean, Fystack adapters).

The existing **Go** API in `services/core` remains the production app until migration; this NestJS app is the **reference implementation** of the enterprise model described in [`docs/enterprise-financial-operating-system.md`](../../docs/enterprise-financial-operating-system.md).

## Quick start

```bash
cd apps/financial-core
cp .env.example .env
# Create DB financial_core in Postgres, then:
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev
```

Health: `GET http://127.0.0.1:3080/health`

## Non-negotiables

- Balances are **always** derived from `fc_ledger_entries` (never `user.balance`).
- Fystack / BlueOcean are **adapters**; the ledger is the only book of record.
- Every monetary movement is a **balanced** `LedgerTransaction` with a unique `idempotency_key`.

## Layout

- `prisma/schema.prisma` — chart of accounts, transactions, entries, events, callbacks, risk, withdrawals, audit.
- `src/ledger` — `LedgerService.postTransaction`, double-entry validation.
- `src/queue` — BullMQ queue names and registration.
- `src/events` — domain event append helpers (same DB transaction as ledger when required).
