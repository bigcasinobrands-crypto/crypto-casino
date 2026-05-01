# Enterprise Bonus System — Gap Analysis (Codebase vs Spec)

**Purpose:** Ground-truth comparison of the existing **live** Crypto Casino monorepo against the “Enterprise Bonus System — Full Upgrade Specification.” Use this before phased implementation; **do not treat the spec’s file paths or stack names as authoritative** where this document disagrees.

**Audit scope (representative):**  
`services/core/internal/bonus/`, `services/core/internal/adminops/bonushub*.go`, `services/core/internal/wallet/bonus_handlers.go`, `services/core/internal/wallet/rewards_hub.go`, `services/core/internal/webhooks/` (migrations + flow), `services/core/internal/bonusblueocean/sync.go`, `services/core/internal/bonus/bonustypes/registry.go`, `services/core/internal/db/migrations/` (00003, 00016, 00021), `frontend/admin-console/` (Bonus Engine area), `frontend/player-ui/` (rewards hooks).

---

## 1. Spec corrections (read first)

| Spec statement | Actual repo |
|----------------|-------------|
| Admin = “React/Next.js” | **`frontend/admin-console`** is **Vite + React** (not Next.js in this tree). |
| Engine handles `promo_code`, `promo_credit` as **bonus_type** values | **`bonus_type`** is **`TEXT` on `promotion_versions`** (`00021_bonus_engine.sql`). Built-in IDs are in `internal/bonus/bonustypes/registry.go`: `deposit_match`, `reload_deposit`, `free_spins_only`, `composite_match_and_fs`, `cashback_net_loss`, `wager_rebate`, `no_deposit`, `custom`. **No** `promo_code` / `promo_credit` **types** in that registry. Promo codes: field on versions + **`POST /v1/profile/redeem-promo`** (`playerauth`). |
| New type `free_spins` | Registry uses **`free_spins_only`**. Any new canonical ID must align UI, API, and DB. |
| “Extend promotions bonus_type enum” | **`promotions`** table has no `bonus_type` column in core bonushub migration; type lives on **`promotion_versions`**. |

---

## 2. Architecture snapshot (what exists)

### 2.1 Core bonus engine (`services/core/internal/bonus/`)

- **Rules:** JSON on `promotion_versions.rules`; parsed in `rules.go` (deposit trigger, reward, wagering, `withdraw_policy`, `excluded_game_ids`).
- **Deposit grants:** `EvaluatePaymentSettled` (Fystack path → worker job `bonus_payment_settled`) + `GrantFromPromotionVersion` → ledger `promo.grant` into **`bonus_locked`** pocket.
- **Segment / targets:** `segment_targeting.go` + `player_eligibility.go` — VIP floor (`vip_min_tier` vs tier `sort_order`), geo allow/deny, explicit CSV targets / `explicit_targeting_only`.
- **Preview / simulate:** `PreviewPaymentMatches`; admin `simulate-payment-settled` (`bonushub_ops.go`).
- **Wagering:** `wager.go` — `ActiveWageringInstance`, `CheckBetAllowedTx` (max bet + excluded games), `ApplyPostBetWagering`; errors `ErrExcludedGame`, `ErrMaxBetExceeded`.
- **Contribution:** `contribution.go` — weights JSON on **`game_contribution_profiles`** (`name = 'default'`): **`per_game`** (game id, case-insensitive) → **category** (`games.category`) → **`default`**; see `docs/bonus-max-bet-violations-policy.md`.
- **Risk / automation / VIP accrual:** present under `bonus/` (separate files); automation rules table in migrations.

### 2.2 Admin Bonus Hub (`adminops/bonushub*.go`)

Promotions, versions, publish, patch, targets, risk queue, instances, manual grant, worker failed jobs, calendar, dashboard, recommendations, etc. UI in `frontend/admin-console` (Bonus Engine shell, wizard, rules editor, operations).

### 2.3 Player APIs (`wallet/bonus_handlers.go`, `rewards_hub.go`)

- `GET /v1/wallet/bonuses`, `GET /v1/bonuses/available`, forfeit, balances with `bonus_locked`.
- `GET /v1/rewards/hub` — calendar (`BuildRewardsCalendar`), hunt (`GetHuntStatus`), VIP map, bonus instances, available offers, aggregates.

### 2.4 Payments vs Blue Ocean

- **Fystack:** webhooks → ledger deposit lines → **`bonus_payment_settled`** → `EvaluatePaymentSettled`.
- **Blue Ocean:** webhooks → `blueocean_events` → worker → **`game.credit`** ledger path; **not** the deposit-match bonus evaluator. **`internal/bonusblueocean/sync.go`** is **dry-run logging only** after publish (`BLUEOCEAN_BONUS_SYNC_ENABLED`); **no real outbound XAPI** for free rounds in code today.
- **Seamless wallet + bonus WR + Redis:** see **`docs/blue-ocean-bonus-wagering.md`** (debit split, when WR runs, `wagering:player:{id}` messages).

### 2.5 Audit / jobs

- **`admin_audit_log`** (staff actions) exists from early migrations.
- **`bonus_audit_log`** (append-only, triggers block UPDATE/DELETE) + **`bonus_outbox`** + worker poller exist (`00031`, `00032`); grant/forfeit enqueue side effects; **`dlq_at`** after max delivery attempts. Admin: **`GET /v1/admin/bonushub/bonus-audit-log`**, **`GET /v1/admin/bonushub/bonus-outbox`**, UI **Bonus Engine → Compliance trail**.
- **`worker_failed_jobs`** exists (surfaced in admin operations); spec’s exponential backoff / metrics for **all** job types + dedicated outbox metrics/alerts **still** TBD.

---

## 3. PART 1 — New bonus types / pipelines

| Requirement | Status | Gap |
|-------------|--------|-----|
| **1A Free spins delivery** (`free_spin_packages`, BO XAPI grant, webhook for spin results → WR on winnings, reconciliation job, wizard, player UI) | **Missing** (no table; BO sync stub only). Registry: **`free_spins_only`**. | Full vertical slice + real BO contract + idempotency. |
| **1B Cashback net loss** | **Implemented (different shape):** `reward_programs` / `kind = cashback_net_loss` + **`reward_rebate_grants`** (period key `daily:…` / `weekly:…`) + **`ProcessRebateGrants`** in the worker (15m tick with other jobs). Net loss = cash pocket `game.debit`+`game.credit` in window; grinds through **`GrantFromPromotionVersion`**. A separate `cashback_periods` table was **not** added — this path is the canonical one unless product wants a rename/migration. | “Pending estimate” player API (optional), richer reporting. |
| **1C Races / leaderboards** (tables, score hook in wager, WS, settlement, admin, player) | **Missing** | Entire subsystem. |
| **1D Missions** (tables, hooks on wager + payment, claim flow, player cards) | **Missing** | Entire subsystem. |
| **1E Referral** (links, events, stages, fraud → risk) | **Missing** (risk queue exists for other flows) | Entire subsystem + abuse signals. |

---

## 4. PART 2 — Wagering hardening

| Requirement | Status | Gap |
|-------------|--------|-----|
| **2A Contribution** game_id > category > default | **Done (JSON):** **`per_game`** map → category → **`default`** in `game_contribution_profiles` weights; `coerceContributionPct` accepts numeric / `json.Number` / string. | DB/UI editors for weights beyond raw JSON (optional). |
| **Integer-only amounts** | **Improved:** `wager.go` snapshot reads use **`snapPositiveInt64FromMap`** / **`snapPositiveWeightPct`** (`float64`, ints, `json.Number`, decimal strings). Ledger remains **`BIGINT`**. | Further tightening of rules JSON parse paths if any `float64` remains for money. |
| **2B Max bet violations table + count + threshold forfeit** | **`bonus_wager_violations`** + counter; **`SweepMaxBetViolationForfeits`** + env **`BONUS_MAX_BET_VIOLATIONS_AUTO_FORFEIT`** (worker); policy **`docs/bonus-max-bet-violations-policy.md`**; admin **Compliance** callout + **Settings → Bonus worker (read-only)** + **`GET /v1/admin/system/operational-flags`** field **`bonus_max_bet_violations_auto_forfeit`**. | Metrics/alerts on sweep volume; optional **centralized** config vs env-only. |
| **2C Redis pub/sub progress** | **Publisher + channel contract:** `PublishWageringProgressFromPool` on **`REDIS_URL`**; channel **`wagering:player:{user_id}`** after Blue Ocean `debit` when bonus stake > 0; see **`docs/blue-ocean-bonus-wagering.md`**. | Browser subscriber (WS/SSE) still optional; hub can poll. |
| **2D Forfeit ACID + immutable bonus audit** | **`bonus_audit_log`** + in-TX **`bonus_outbox`** on grant/forfeit; staff still writes **`admin_audit_log`** on staff forfeit. | Extend audit to every lifecycle edge (e.g. explicit **expired** row handling in sweep if product wants distinct status vs forfeited). |

---

## 5. PART 3 — Player UI

| Requirement | Status | Gap |
|-------------|--------|-----|
| Full **`/rewards`** rebuild (sections, WS, missions, races, modals) | **Partial:** `RewardsPage` / `useRewardsHub` + hub API; **not** spec-complete; backend missing missions/races. | Large coordinated UI + API work. |
| VIP page spec | VIP APIs + tiers exist | Mostly UI/UX + any missing boost-window APIs. |
| Promo **`/v1/bonuses/validate-code`** / **`redeem`** | **`POST /v1/profile/redeem-promo`** and **`POST /v1/bonuses/redeem`** (alias, same body `{ "code" }`); validate-code not added. | Add validate-only if needed. |

---

## 6. PART 4 — Admin console

| Requirement | Status | Gap |
|-------------|--------|-----|
| Analytics (GGR %, funnel, segments, CSV) | Partial KPIs / performance | Data model for GGR, new charts, export. |
| Operations live event feed (WS) | Not identified | New stream + UI. |
| Risk drawer (fingerprints, bulk, evidence) | Risk queue exists | Depth TBD; likely new APIs + UI. |
| Catalog columns + duplicate | Catalog exists | Joins to cost/completion; new clone endpoint. |
| Free spins monitor / Races manager | N/A | After Part 1 backends. |

---

## 7. PART 5 — Infrastructure

| Requirement | Status | Gap |
|-------------|--------|-----|
| **`bonus_outbox`** + poller | **Present** (`cmd/worker` ticker + `bonus.ProcessBonusOutbox`); **process counters** in `obs` (worker) + **`bonus_outbox_redriven_total`** on API after redrive. **DB queue** on **`GET /v1/admin/dashboard/system`**. **Superadmin** **`POST /v1/admin/bonushub/bonus-outbox/{id}/redrive`** clears DLQ (`dlq_at`, `attempts`, `last_error`) for stuck rows; Compliance **Outbox** table **Redrive** button; **`admin_audit_log`** `bonushub.bonus_outbox_redrive`. | Alerts / unified scrape; bulk redrive. |
| DLQ backoff + metrics | **Partial:** outbox **`dlq_at`** after N attempts; **`worker_failed_jobs`** for Redis jobs | Exponential backoff for outbox redrive; unified dashboards. |
| **`bonus_config`** DB + admin UI | **Partial:** env + `bonus/policy.go` JSON knobs | Centralized config + RBAC. |
| BO webhook **ordering** (`sequence_id`, Redis buffer) | **`blueocean_events`** has no `sequence_id` in `00003` | Schema + consumer discipline. |

---

## 8. PART 6 — Migrations

All spec tables **to be added** as **new** numbered migrations (never edit applied migrations):

`free_spin_packages`, (optional) dedicated `cashback_periods` if you split from **`reward_rebate_grants`**, `races`, `race_entries`, `missions`, `player_missions`, `referral_links`, `referral_events`, **`bonus_config`**. (**`bonus_outbox`** / **`bonus_audit_log`**: `00031`**; outbox DLQ: **`00032`**; **`bonus_wager_violations`** + instance counter: **`00033`**.)

---

## 9. Recommended execution order (adjusted for live system)

The spec’s Part 7 order is directionally sound but **too large per “phase”** for production. Suggested **release slices**:

1. **R0 — Safety & observability:** `bonus_audit_log` (append-only) + writers on grant/forfeit/status; **`bonus_outbox`** only for **new** side-effects or retrofitted behind flag; DLQ retry policy for existing worker jobs.  
2. **R1 — Wager hardening:** violation counter + `bonus_wager_violations` + optional auto-forfeit; contribution model extension; remove float from money-adjacent JSON parsing where feasible.  
3. **R2 — Cashback vertical:** `cashback_periods` + job + admin minimal UI + player estimate API.  
4. **R3 — Free spins vertical:** packages table + real BO XAPI + webhooks + reconciliation (**feature-flagged**).  
5. **R4+ — Missions, races, referral** each as separate releases with flags.

**Do not** land R3–R4 without R0–R1 if risk tolerance is low.

---

## 10. Definition of done (minimal) before claiming “enterprise-ready core”

- [x] Every **grant / forfeit / expiry / manual grant** writes a row to **`bonus_audit_log`** (or agreed equivalent) with **no UPDATE/DELETE** (grant + forfeit paths; expiry uses **`ForfeitInstance`** with reason **`expired`**).  
- [x] **Outbox** or proven equivalent eliminates “DB committed, notification/job lost” class of bugs for bonus side effects (worker drains **`bonus_outbox`**; DLQ after max attempts).  
- [x] **Max-bet abuse** path: logged violations + operator visibility (**`bonus_wager_violations`**, admin API + UI); **documented auto-forfeit policy** still optional.  
- [x] **Blue Ocean** contract documented: **game wallet vs bonus/WR** — see **`docs/blue-ocean-bonus-wagering.md`**.  
- [x] **Player + admin E2E (opt-in, `BONUS_E2E_DATABASE_URL`):** package **`internal/e2e`** (grant → wager → complete; Redis pub/sub with miniredis), **`internal/adminops`** (simulate **dry run** HTTP, forfeit HTTP), **`internal/webhooks`** (BO seamless **debit** + Redis). See **`docs/bonus-e2e.md`**. **Still TBD non–dry-run** simulate (full `EvaluatePaymentSettled` against a seeded deposit campaign) and multi-endpoint scripted E2E.  

---

## 11. Using this doc with Claude / Cursor

Paste: *“Implement only milestone R0 from `docs/bonus-enterprise-gap-analysis.md`; do not implement races/missions until R0 is merged.”*

This file is the **gap analysis confirmation** requested by the original spec’s CRITICAL CONTEXT.

---

## 12. Crosswalk: “Master Reference / Cursor Build” (2026) vs this repo

The **enterprise master document** (bonus types, WR, wallet, admin, security, `CURSOR BUILD PROMPT` with **NestJS + TypeORM + Kafka + Jest** deliverables) describes a **target** platform. **This monorepo is not that stack** — it is the live baseline below.

| Master spec (build prompt) | This repo today |
|----------------------------|-----------------|
| Standalone **Bonus Engine** microservice, **Node/NestJS** | **Go** in `services/core` (`internal/bonus`, `wallet`, `adminops/bonushub*`). A second Nest service would **duplicate** domain; only add with an explicit ADR. |
| **TypeORM** migrations, entities in §18 | **goose** SQL in `internal/db/migrations/`, `promotion_versions` + `user_bonus_instances` (not the spec’s `bonus_templates` / `player_bonuses` names; **same roles**). |
| **Kafka** `bet.settled` consumers | **Webhooks** (BlueOcean, Fystack) + **Redis** list queue (`internal/jobs`); not Kafka. |
| **Fraud** tables: `device_fingerprints`, `player_ip_log`, `bonus_risk_assessments` (full) | **Partial:** `player_risk_signals`, risk queue, targeting — **not** a full spec clone of all fraud tables. |
| Free rounds **provider API** + per-round webhook loop | **Registry** has `free_spins_only`; **no** end-to-end grant + spin result pipeline (see **§3**; BO XAPI still contract TBD). |
| Cashback period job, net-loss math (§7) | **Type** `cashback_net_loss` exists; **no** `cashback_periods` + scheduled settlement as in spec. |
| Missions, races, referral (§8–10) | **Not implemented** (entire subsystems). |
| Redis **pub/sub** for live WR to player UI (§20.3) | **Partial:** PUBLISH on **`wagering:player:{id}`** when BO debits with bonus stake and Redis is configured; no in-repo browser bridge yet. |
| Phases 5–6 settlement + free spins in Nest | **Go:** `wager.go`, `contribution.go`, grant/forfeit, outbox/audit — **align concepts**, not port files verbatim. |
| Admin **Ant Design** + routes in prompt | **Vite + React** admin; Bonus Hub / wizard / rules / operations exist; not every §15 screen. |
| Jest, Supertest, load tests 1k bet/s | **Go `testing`**; load harness **TBD** per §10 DoD. |

**Conclusion:** Treat the master doc as a **product/requirements** source; implement **incrementally in Go** using the **release slices in §9** (R0–R4+). The **“CURSOR BUILD PROMPT”** stack (Nest, Kafka, TypeORM) is a **blueprint**, not a drop-in instruction set for *this* tree.
