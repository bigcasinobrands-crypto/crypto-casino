# Bonus-specific threat model

STRIDE-oriented analysis of bonus/promotion abuse vectors with mitigations and ownership.

## 1. Multi-account abuse

**Threat:** Player creates multiple accounts to claim the same promotion repeatedly (e.g. first-deposit bonus on each account).

| Vector | Mitigation | Owner |
|--------|-----------|-------|
| Email aliases | Email normalization at registration (strip dots, plus-addressing) | playerauth |
| Same device/IP | Pre-grant risk check: `account_too_new` rule rejects accounts < 1h; future: IP/device fingerprint clustering | bonus/risk.go |
| Referral chains | Velocity limit: max 5 grants per user per 24h; lifetime budget cap ($50k) | bonus/risk.go |
| KYC bypass | Compliance export includes all bonus instances; manual review queue for flagged grants | adminops/user_compliance.go |

**Status:** Velocity + budget cap + account-age checks live in `PreGrantRiskCheck`. IP/device clustering is future work (NFR-OBS).

## 2. Payment fraud / deposit manipulation

**Threat:** Player triggers fake or reversed deposits to earn bonuses before funds settle, or manipulates deposit amounts.

| Vector | Mitigation | Owner |
|--------|-----------|-------|
| Fake webhook | Ed25519 signature verification on Fystack webhooks; HMAC fallback for legacy | webhooks/fystack_webhook.go |
| Double-credit | Idempotency key `fystack:deposit:{resource_id}` prevents duplicate ledger lines | webhooks/fystack_webhook.go |
| Chargeback after grant | Bonus snapshot records `deposit_minor`; compliance export for disputes; `worker_failed_jobs` for replay | bonus/grant.go, adminops |
| Amount manipulation | Server-side `parseAmountMinor` from webhook payload; never trust client amounts | webhooks/fystack_webhook.go |

**Status:** All mitigations implemented. Chargeback-clawback automation is future work.

## 3. Wagering requirement circumvention

**Threat:** Player attempts to complete WR through excluded games, low-risk opposing bets, or by exploiting contribution weights.

| Vector | Mitigation | Owner |
|--------|-----------|-------|
| Excluded game bypass | `CheckBetAllowedTx` rejects bets on excluded game IDs server-side (BlueOcean debit path) | bonus/wager.go |
| Max bet violation | `CheckBetAllowedTx` enforces `max_bet_minor` from active bonus snapshot | bonus/wager.go |
| Low-risk stacking | `game_weight_pct` in snapshot scales WR contribution (e.g. 10% for table games) | bonus/wager.go |
| Opposing bets (roulette red+black) | Betting-pattern detection: future work — flag sessions with high opposing-bet ratios | future |
| Game provider collusion | BlueOcean callback is server-authoritative; player cannot inject credits | webhooks/blueocean_wallet.go |

**Status:** Max bet, game exclusions, and contribution weights enforced at debit time. Betting-pattern signals are future work.

## 4. Withdrawal abuse / cash-out before WR

**Threat:** Player deposits, receives bonus, then immediately withdraws real money before completing wagering.

| Vector | Mitigation | Owner |
|--------|-----------|-------|
| Direct cash-out | `WithdrawPolicyBlock` checks active bonus `withdraw_policy`; blocks when `block` or `block_withdraw` | bonus/withdraw_gate.go |
| Cash-only debit | `BalanceCashTx` used for withdrawal ledger debit — only withdraws from `cash` pocket, not `bonus_locked` | wallet/withdraw.go |
| Forfeit-then-withdraw | Forfeiting removes `bonus_locked` via ledger debit before status change; no leftover bonus balance | bonus/grant.go (ForfeitInstance) |
| Fraud checks | `RunFraudChecks` in withdraw path evaluates velocity + pattern rules | wallet/withdraw.go |

**Status:** All mitigations implemented.

## 5. Collusion / bonus sharing

**Threat:** Multiple players coordinate to funnel bonus value to a single cash-out account (e.g. intentional losses in P2P games).

| Vector | Mitigation | Owner |
|--------|-----------|-------|
| P2P transfer via game | BlueOcean games are house-edge only — no P2P transfers; all credits from provider | webhooks/blueocean_wallet.go |
| Bonus → friend withdrawal | Bonus_locked pocket is non-transferable; convert-to-cash only after WR completion | bonus/wager.go |
| Staff abuse | Manual grant requires `superadmin` role; all grants audit-logged with staff_user_id | adminops/bonushub.go |
| Coordinated deposits | Velocity limits + lifetime budget cap catch rapid grant accumulation across related accounts | bonus/risk.go |

**Status:** Core controls in place. Cross-account relationship detection (shared IP/device) is future work.

## 6. Automation rule abuse

**Threat:** Misconfigured automation rules grant excessive bonuses or are exploited by targeting edge-case segments.

| Vector | Mitigation | Owner |
|--------|-----------|-------|
| Overly broad rules | Automation rules require `superadmin` to create/edit; rules have `enabled` toggle and `priority` ordering | adminops/bonushub.go |
| Segment bypass | `segment_filter.channels` evaluated server-side; empty = any (conservative default) | bonus/automation.go |
| Kill switch | Per-promotion `grants_paused` + global `bonuses_enabled` / `automated_grants_enabled` flags | bonus/flags.go, bonus/evaluate.go |
| Runaway grants | Pre-grant risk pipeline (velocity + budget cap) runs before every automated grant | bonus/risk.go → grant.go |

**Status:** All mitigations implemented.

## Ownership summary

| Component | Owner team | Key files |
|-----------|-----------|-----------|
| Webhook verification | Platform / Payments | `webhooks/fystack_webhook.go`, `webhooks/blueocean_wallet.go` |
| Grant pipeline + risk | Bonus / Anti-fraud | `bonus/grant.go`, `bonus/risk.go`, `bonus/evaluate.go` |
| Wagering enforcement | Bonus / Games | `bonus/wager.go` |
| Withdrawal gate | Payments / Compliance | `wallet/withdraw.go`, `bonus/withdraw_gate.go` |
| Admin RBAC + audit | Platform / Security | `adminops/bonushub.go`, `adminapi/` |
| Kill switches | Ops | `bonus/flags.go`, `paymentflags/` |
| Monitoring | SRE | `obs/counters.go`, admin ops summary |
