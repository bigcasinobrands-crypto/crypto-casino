# Financial data sources audit (Crypto Casino)

This document records **where money metrics come from**, whether they are **ledger-backed**, and **parity** between player UI and admin. Updated alongside ledger KPI fixes.

## Ledger source of truth

- **Primary:** PostgreSQL `ledger_entries` (written by `services/core` when deposits settle, game rounds settle, withdrawals complete, promos post, etc.).
- **Operational mirrors:** `fystack_payments`, `fystack_withdrawals`, provider callbacks — **must not** define revenue KPIs alone.

## Backend (`services/core`)

| Area | Path | Data source | Ledger-backed | Notes / fixes |
|------|------|-------------|---------------|----------------|
| Player balance | `internal/wallet/wallet.go` | Sum pockets from `ledger_entries` | Yes | Shared formula with admin player finance where wired |
| Admin KPIs | `internal/adminops/dashboard.go` | **Updated:** deposits & counts from `ledger_entries` (`deposit.credit`, `deposit.checkout`); GGR from game lines; bonus cost from `promo.grant` + `bonus_locked`; reward expense from cash rakeback/VIP/hunt lines; `active_players_*` = distinct users with `game.debit`; NGR = GGR − bonus grants − reward payouts; ARPU = NGR₇d / wagerers₇d | Yes (withdrawals completed/pending still operational until lock postings exist) | Response includes `metrics_derivation` |
| Casino analytics | `internal/adminops/casino_analytics.go` | **Updated:** FTD / first deposit / repeat deposits from `ledger_credits` CTE; GGR from ledger; bonus from `promo.grant`; NGR proxy adds reward expense | Yes | Time series FTD uses same first-credit logic |
| Crypto chain summary | `internal/adminops/casino_analytics.go` `DashboardCryptoChainSummary` | `fystack_payments` / `fystack_withdrawals` | Partial | Consider joining `ledger_entries` metadata in a later phase for chain-accurate liability |
| BlueOcean / provider | e.g. `internal/blueocean/` (handlers) | Callbacks + ledger debit/credit | Must be ledger-gated | Idempotency should remain on provider refs + ledger |

## Frontend

| Area | Path | Data source | Ledger-backed | Notes |
|------|------|-------------|---------------|-------|
| Player UI wallet | `frontend/player-ui/src/playerAuth.tsx` | `GET /v1/wallet/balance` | Yes (via API) | No client-side balance math as source of truth |
| Admin dashboard KPIs | `frontend/admin-console/src/hooks/useDashboard.ts` | Admin API KPIs | Via backend | Types extended for `ngr_24h`, `ngr_7d`, `reward_expense_*`, `metrics_derivation` |
| Dummy dashboard | `frontend/admin-console/src/lib/dashboardDummy.ts` | Local demo payloads | No | **Production:** dummy **off** unless `VITE_ADMIN_DUMMY_DASHBOARD=true`; dev default unchanged |
| Casino analytics page | `frontend/admin-console/src/pages/FinanceCasinoAnalyticsPage.tsx` | Casino analytics API | Via backend | `reward_expense_minor` available on KPI type |

## Known gaps (next implementation order)

1. **Pending withdrawal liability:** Drive `pending_withdrawals_*` from ledger lock accounts when `USER_PENDING_WITHDRAWAL` (or equivalent) postings exist; until then, operational `fystack_withdrawals` is labeled in `metrics_derivation`.
2. **Full NGR:** Add affiliate fees, provider fees, jackpot contributions from dedicated ledger entry types when present.
3. **FTD filters:** Exclude test mode, admin corrections, internal treasury once those dimensions exist on `ledger_entries` (flags/metadata).
4. **Real-time:** Emit events after ledger writes; invalidate short TTL balance cache; extend existing balance SSE/WebSocket to admin scoped channels.
5. **tests:** SQL/fixture tests for FTD, GGR, NGR queries against `ledger_entries` samples.

## Player visibility (challenges, bonuses, VIP)

| Surface | Shown when |
|---------|------------|
| **Challenges** (`GET /v1/challenges`) | `status IN ('scheduled','active')`, not ended, VIP gate passes for viewer. **Draft / paused / completed** are excluded by design. |
| **Bonus offers** (`player_eligibility.go`) | Promotion version has **`published_at`** set; promotion not archived; eligibility rules pass. Unpublished versions never appear in the player hub. |
| **VIP program UI** | Loads tier config from API; assignment uses operational + ledger-backed rewards when configured. |

Ledger: challenge wager counting and prize payout flows use ledger postings on debit/win/settlement; configuring **draft** does not move money.

## Deployment (staging / production)

Both SPAs call the Go API with **build-time** origins unless Vite dev proxy is used:

| App | Variable | Effect if missing on static host |
|-----|----------|-----------------------------------|
| Player UI | `VITE_PLAYER_API_ORIGIN` | `/v1` requests hit the **static** domain → 404; bonuses/challenges/balance/avatars break. |
| Admin | `VITE_ADMIN_API_ORIGIN` | Admin saves never reach the API → “works locally” only. |

**Optional:** `<meta name="player-api-origin" content="https://api…">` and `<meta name="admin-api-origin" content="https://api…">` in each app’s `index.html` so URLs resolve without rebuilding (still set CORS on the API).

## Acceptance (subset)

- [x] Admin KPI deposits / deposit counts from ledger credits, not `fystack_payments` alone.
- [x] Bonus cost on dashboard from `promo.grant` (bonus pocket), not `user_bonus_instances.granted_amount_minor` alone.
- [x] ARPU denominator = ledger wagerers (`game.debit`), not `game_launches`.
- [x] Casino analytics FTD aligned with first ledger deposit credit.
- [x] Production build does not default admin dashboard to dummy KPIs.
