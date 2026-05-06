# Living traceability matrix

Maps plan requirement IDs to implementation artifacts. Update each release.

## Schema & data (MIG)

| Req | Migration | Key tables |
|-----|-----------|-----------|
| MIG-01 | `00016_bonushub.sql` | `promotions`, `promotion_versions`, `user_bonus_instances`, `bonus_automation_rules`, `bonus_risk_decisions`, `worker_failed_jobs`, `chat_settings`, `player_notifications`, `game_contribution_profiles` |
| MIG-02 | `00016_bonushub.sql` | `ledger_entries.pocket` column, `payment_ops_flags` bonus columns |
| MIG-03 | `00017_bonus_promo_pause_events.sql` | `promotions.grants_paused`, `bonus_outbound_events` |
| MIG-04 | `00018_chat_blocked_terms.sql` | `chat_blocked_terms` |

## Functional requirements (FR)

| Req | Backend files | Admin route | Admin UI | Player route | Player UI |
|-----|--------------|-------------|----------|-------------|-----------|
| FR-BONUS-01: Grant engine | `bonus/grant.go`, `bonus/evaluate.go` | — | — | — | — |
| FR-BONUS-02: WR + wagering | `bonus/wager.go` | — | — | — | — |
| FR-BONUS-03: Expiry/forfeit | `bonus/expire.go`, `bonus/grant.go` (ForfeitInstance) | POST `.../instances/{id}/forfeit` | BonusHub → Instances tab | — | — |
| FR-BONUS-04: Deposit triggers | `bonus/rules.go`, `bonus/types.go` (PaymentSettled) | — | — | — | — |
| FR-BONUS-05: Automation rules | `bonus/automation.go` | GET/POST/PATCH `.../automation-rules` | BonusHub → Automation tab | — | — |
| FR-BONUS-06: BlueOcean allocator | `webhooks/blueocean_wallet.go` | — | — | — | — |
| FR-DATA-04: Idempotency keys | `docs/idempotency-keys.md` | — | — | — | — |
| FR-INT-01: PassimPay deposit → bonus | `webhooks/passimpay_webhook.go` | — | — | — | — |
| FR-INT-02: Outbound events | `bonus/events.go` | — | — | — | — |
| FR-OPS-01: Kill switches | `bonus/flags.go`, `paymentflags/` | PATCH `.../promotions/{id}`, PATCH `/ops/payment-flags` | BonusHub → Promotions (pause toggle), PaymentOps | — | — |
| FR-OPS-02: Economic timeline | `adminops/bonushub.go` (userEconomicTimeline) | GET `/users/{id}/economic-timeline` | PlayerDetail → Economic Timeline | — | — |
| FR-OPS-03: Runbooks | `docs/bonus-runbooks.md`, `docs/passimpay-runbooks.md` | — | — | — | — |
| FR-OPS-04: Dry-run / simulate | `adminops/bonushub_ops.go` | POST `.../simulate-payment-settled` | BonusHub → Simulate tab | — | — |
| FR-OPS-05: Risk explanation | `adminops/user_compliance.go` (UserBonusRiskDecisions) | GET `/users/{id}/bonus-risk` | PlayerDetail → Risk Decisions | — | — |
| FR-OPS-06: Compliance export | `adminops/user_compliance.go` (ComplianceExportUser) | GET `/users/{id}/compliance-export` | PlayerDetail → Download button | — | — |
| FR-OPS-07: Terms version/hash | `wallet/bonus_handlers.go` | — | — | GET `/v1/wallet/bonuses` | HeaderWalletBar |
| FR-PLAYER-03: Notifications | `wallet/bonus_handlers.go`, `bonus/notify.go` | — | — | GET `/v1/notifications`, POST `/v1/notifications/read` | `NotificationBell.tsx` |

## Functional requirements — chat

| Req | Backend files | Admin route | Admin UI |
|-----|--------------|-------------|----------|
| FR-CHAT-01: Staff moderation | `chat/staff.go` | `/v1/admin/chat/*` (messages, mute, ban, delete, broadcast, settings, blocked-terms) | GlobalChatPage.tsx |
| FR-CHAT-02: Player WS + history | `chat/client.go`, `chat/hub.go`, `chat/handlers.go` | — | — |
| FR-CHAT-03: Blocked terms | `chat/blocklist.go`, `chat/staff.go` | POST/DELETE `/v1/admin/chat/blocked-terms` | GlobalChat → Blocked Terms tab |

## Non-functional requirements (NFR)

| Req | Implementation | Docs |
|-----|---------------|------|
| NFR-API: Pagination | `after_id` keyset cursor on promotions, worker-failed-jobs list routes | — |
| NFR-CHAT: Rate limits | `chat/filter.go` (flood/dupes); `chat_settings` (slow mode) | `docs/chat-scale-limits.md` |
| NFR-DR: Backup scope | — | `docs/backup-scope.md` |
| NFR-OBS: Metrics | `obs/counters.go`; exposed via GET `/v1/admin/ops/summary` | — |
| NFR-PRIV: Privacy | — | `docs/privacy-retention.md` |
| NFR-RES: DLQ | `worker_failed_jobs` table; admin list + retry routes | `docs/bonus-runbooks.md` |
| NFR-SEC-REV: Security review | — | `docs/bonus-security-review-checklist.md` |
| NFR-TEST: E2E plan | — | `docs/e2e-test-plan.md` |

## Risk & compliance

| Req | Backend files | Admin route | Docs |
|-----|--------------|-------------|------|
| RISK-01: Pre-grant pipeline | `bonus/risk.go` (PreGrantRiskCheck) | — | `docs/bonus-threat-model.md` |
| RISK-02: Risk queue | `bonus/risk.go` (ListPendingReviews, ResolveReview) | GET `.../risk-queue`, POST `.../risk-queue/{id}/resolve` | — |
| RISK-03: Threat model | — | — | `docs/bonus-threat-model.md`, `docs/threat-model.md` |

## Admin console navigation (IA)

| Group | Pages | Sidebar file |
|-------|-------|-------------|
| Dashboard | `/` | `AppSidebar.tsx` |
| Players | `/users`, `/support` | `AppSidebar.tsx` |
| Finance | `/ledger`, `/payments-ops`, `/deposits`, `/withdrawals` | `AppSidebar.tsx` |
| Games | `/games`, `/game-launches`, `/game-disputes`, `/bog`, `/blueocean` | `AppSidebar.tsx` |
| Engagement | `/bonushub`, `/global-chat` | `AppSidebar.tsx` |
| Operations | `/logs`, `/settings` | `AppSidebar.tsx` |
| Compliance | `/logs` (audit placeholder) | `AppSidebar.tsx` |

## Test coverage

| Area | Test file | Type |
|------|----------|------|
| Bonus rules (grant amount, WR) | `bonus/rules_test.go` | Unit |
| Deposit matching (first/nth/channels) | `bonus/rules_test.go` | Unit |
| BlueOcean signature | `blueocean/*_test.go` | Unit |
| Staff auth | `staffauth/*_test.go` | Unit |
| Games catalog | `games/*_test.go` | Unit |
| E2E smoke (planned) | `docs/e2e-test-plan.md` | Manual / CI |
