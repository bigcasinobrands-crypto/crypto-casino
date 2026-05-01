# Bonus engine — opt-in E2E tests (Go)

The core service includes **Postgres-backed** tests that run only when you set an environment variable, so `go test ./...` stays fast when no database is available.

**Env var:** `BONUS_E2E_DATABASE_URL` (e.g. `postgres://casino:casino@127.0.0.1:5432/casino` with `docker compose up -d postgres` from the repo root).

## Where tests live

| Package / path | What it covers |
|----------------|----------------|
| `internal/e2e` | `TestE2EGrantWageringAndComplete` — grant → `ApplyPostBetWagering` → complete. `TestE2ERedisPublishesWageringAfterGrant` — miniredis + PUBLISH on `wagering:player:{id}`. |
| `internal/bonuse2e` | **Harness only** (not a test package): `NewUserWithFixedNoDepositGrant`, `MustPool`. Do not import from production code. |
| `internal/adminops` | `TestE2EHttpSimulatePaymentSettledDryRun` — admin simulate (dry run). `TestE2EHttpForfeitInstance` — HTTP forfeit. |
| `internal/webhooks` | `TestE2EBlueOceanDebitPublishesWageringRedis` — GET seamless `debit` + Redis message. |

## Run (local)

```powershell
$env:BONUS_E2E_DATABASE_URL="postgres://casino:casino@127.0.0.1:5432/casino"
go test ./internal/e2e/... ./internal/adminops/... ./internal/webhooks/... -v -count=1
```

Or a single test:

```powershell
go test ./internal/e2e/... -run TestE2EGrantWageringAndComplete -v
```

**Cleanup:** harness removes bonus instances, ledger, risk rows, and promotions. The **user** row and **append-only** `bonus_audit_log` may remain; use a throwaway database for many runs.

## What is not covered

- Admin **simulate** without `dry_run` (real `EvaluatePaymentSettled`) needs a matching published deposit promotion and is left for a follow-up.
- **Full** multi-step: publish → Fystack deposit → grant → Blue Ocean → forfeit in one script — not automated here.

## Next implementation slices (from gap doc)

After E2E hardening, the recommended **next** product slices are in `docs/bonus-enterprise-gap-analysis.md` §9: **R3** free-spins provider vertical, then **R4+** missions, races, referral (each feature-flagged).

## Related

- `docs/blue-ocean-bonus-wagering.md` — live debits, WR, Redis.
- `docs/bonus-enterprise-gap-analysis.md` — §10 definition of done.
