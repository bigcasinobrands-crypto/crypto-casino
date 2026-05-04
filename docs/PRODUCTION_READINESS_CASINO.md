# Production readiness — casino financial operating system

This document ties **operational** requirements to the **`apps/financial-core`** implementation and the existing Go API (`services/core`) until migration is complete.

## Rollback plan (migrations)

1. **Before migrate:** snapshot Postgres (`pg_dump`) or provider backup.  
2. **Apply:** `cd apps/financial-core && npx prisma migrate deploy` (or `migrate dev` in non-prod).  
3. **Rollback:** restore DB from snapshot **or** apply a **forward** migration that reverses schema (Prisma has no automatic down in all environments). For ledger tables, **never** delete `fc_ledger_entries` — only add compensating transactions.  
4. **Code rollback:** deploy previous image; API must match schema version expected by Prisma client.

## Architecture (text)

```
[Player/Admin UI] → [API: Nest financial-core / Go core] → [LedgerService.postTransaction]
                              ↓
                    [LedgerVerificationService] (pre-check)
                              ↓
        [PostgreSQL: fc_ledger_* , fc_deposits, fc_domain_events, fc_processed_callbacks]
                              ↓
                    [BullMQ workers] → adapters [Fystack] [BlueOcean]
```

## Module map (target)

| Module | In repo now | Notes |
|--------|-------------|--------|
| LedgerModule | Yes | `postTransaction`, idempotency, playable/cash-first |
| LedgerVerificationModule | Yes | All `verify*` gates return structured result |
| IdempotencyModule | Yes | `fc_processed_callbacks` |
| EventModule | Partial | `fc_domain_events` + `DomainEventsService` |
| QueueModule | Yes | Granular queue **names** registered in BullMQ |
| DepositModule | **Next** | Wire `fc_deposits` + Fystack webhooks |
| WithdrawalModule | **Next** | Full status enum + lock postings |
| TreasuryModule | Planned | Hot/cold, sweeps — **no** balance authority |
| FystackProviderModule | Planned | Implements wallet/deposit/withdrawal ports |
| BlueOceanProviderModule | Planned | Cash-first bet → `PENDING_SETTLEMENT` |
| WageringModule | Planned | WR from ledger bet lines only |
| BonusModule | Schema stub | State + ledger postings |
| VipModule / Cashback / Rakeback / Challenge / Affiliate | Planned | Periodic + event-driven |
| RiskModule / FraudModule | Partial types | `fc_risk_events` |
| ReconciliationModule | Alerts table | Compare liabilities vs chain |
| AnalyticsModule | **SQL views** from ledger | GGR/NGR/FTD definitions |
| Admin* / Support* / Audit* | RBAC + `fc_audit_log` | No direct balance mutation |

## Acceptance criteria (excerpt)

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | Ledger-only truth | No `user.balance` column; balances from sum(entries) |
| 2 | Balanced postings | `assertDoubleEntryBalanced` + DB txn |
| 3 | Idempotent callbacks | `fc_processed_callbacks` + ledger txn keys |
| 4 | Cash-first bets | `computeCashFirstStake` + verification |
| 5 | Withdrawals locked | `USER_PENDING_WITHDRAWAL` before broadcast |
| 6 | Win needs bet | `verifyWinCanCredit` checks prior bet txn |
| 7 | Replay | Same idempotency returns same `LedgerTransaction` |

## Daily operations (supported by design)

- **Morning finance:** reconciliation job compares `fc_ledger_accounts` aggregates to treasury rail.  
- **Withdrawals:** statuses include `STUCK`, `MANUAL_REVIEW` — explicit paths.  
- **Risk:** verification returns `requiredAction: MANUAL_REVIEW`.  
- **Support:** ledger timeline is authoritative; export entries by `user_id`.

## Alerts (recommended)

| Signal | Severity |
|--------|----------|
| Unbalanced posting attempt | CRITICAL |
| DLQ depth > threshold per financial queue | HIGH |
| `reconciliation.run` finds CRITICAL alert | CRITICAL |
| Duplicate callback rate spike | HIGH |

## Tests added in this increment

- `double-entry.spec.ts` — balanced/unbalanced  
- `cash-first.spec.ts` — stake funding  
- Run: `cd apps/financial-core && npx jest`

## What was built in this PR increment

1. **Schema:** `PENDING_SETTLEMENT`, deposit table, expanded withdrawal/bonus enums, line types `STAKE_HOLD` / `SETTLEMENT_RELEASE`.  
2. **Migration:** `prisma/migrations/0001_init/migration.sql` (full create).  
3. **Ledger:** economic balance by account type, playable balances, cash-first utils.  
4. **LedgerVerificationService:** all requested `verify*` methods (structured).  
5. **IdempotencyService:** callback dedup.  
6. **Queues:** production-grade names.  
7. **Docs:** this checklist + linkage to enterprise spec.

## Next slices (strict order)

1. Deposit service: persist row → verify → `LedgerService` DEPOSIT posting (`DEBIT TREASURY_ASSET`, `CREDIT USER_CASH`).  
2. Withdrawal service: request → verify → lock txn → state machine.  
3. BlueOcean module: bet txn idempotency `blueocean:bet:…`, stake to `PENDING_SETTLEMENT`.  
4. Workers: wire Bull processors with **finite** retries + DLQ alerts.

---

## Full module catalog (operations + ownership)

| Module | Production problem solved | Depends on | Admin primary user | Key alerts |
|--------|---------------------------|------------|---------------------|------------|
| LedgerModule | Single book of truth | Postgres | Finance, Auditor | Unbalanced txn attempt |
| LedgerVerificationModule | Block illegal money moves | LedgerModule | Risk, Treasury | HIGH denial rate |
| IdempotencyModule | Duplicate webhooks | Postgres | Ops | Callback replay spike |
| EventModule | Replay / projections | Ledger | Engineering | Event insert failure |
| DepositModule | Confirmed on-chain → credit | Fystack, Verification | Finance, Support | Stuck in AWAITING_CONFIRMATIONS |
| WithdrawalModule | Safe payout pipeline | Fystack, Verification | Treasury | STUCK / DLQ |
| TreasuryModule | Liquidity & sweeps | Wallet rail | Treasury | Hot below threshold |
| FystackProviderModule | Swappable rail | Ports | Engineering | Signing failure |
| BlueOceanProviderModule | Swappable games | Ports | Product | Invalid signature rate |
| WageringModule | WR from ledger facts | Bonus, Ledger | Marketing | Abnormal contribution |
| BonusModule | Controlled liability | Ledger | Marketing | Cost / GGR ratio |
| VipModule | Tier + rewards | Ledger, Events | CRM | Cost spike |
| CashbackModule / RakebackModule | Accrual correctness | Ledger | Finance | Duplicate period accrual |
| ChallengeModule | Promos from facts | Wagering | Marketing | Reward liability drift |
| AffiliateModule | NGR-based commission | Analytics, Ledger | Affiliate mgr | Self-referral flags |
| RiskModule | Pre-trade gate | Events | Risk | Review backlog |
| FraudModule | Case management | Risk | Risk | Case SLA breach |
| ReconciliationModule | Truth vs chain | All rails | Finance | CRITICAL mismatch |
| AnalyticsModule | GGR/NGR/FTD | Ledger only | Executive | ETL lag |
| AdminFinanceModule | Controlled actions | RBAC, Audit | Finance | Privilege use |
| AdminOperationsModule | Queues, providers | Workers | Ops | Queue depth |
| SupportToolsModule | Explain money | Read APIs | Support | n/a |
| AuditModule | Immutable record | All writes | Compliance | Tamper check |
| QueueModule | Async safety | Redis | DevOps | DLQ growth |
| NotificationModule | Human escalation | Events | All | Send failure |
| SecurityModule | AuthZ / secrets | Platform | Security | Auth anomalies |
| ReportingModule | Reg / exec exports | Analytics | Finance | Job failure |

---

See also: [`enterprise-financial-operating-system.md`](./enterprise-financial-operating-system.md).
