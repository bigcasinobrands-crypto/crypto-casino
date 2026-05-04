# Bonus engines and VIP — ledger integration

All monetary eligibility and settlement for promotions should ultimately reconcile to **`ledger_entries`**. Admin UI “engines” map to these backend surfaces.

| Admin engine (concept) | Ledger signals | Primary Go entrypoints |
|------------------------|------------------|-------------------------|
| Deposit match / reload / match + free spins | Successful deposits: `deposit.credit`, `deposit.checkout` (positive amounts). Deposit index / FTD: `ledger.CountSuccessfulDepositCredits` and webhook flow after lines post. | `webhooks/fystack_webhook.go` → `bonus.PaymentSettled`; `bonus/evaluate.go` (`EvaluatePaymentSettled`); `bonus/grant.go` (`promo.grant`) |
| Free spins only | Grant path + provider callbacks (not stake totals from admin UI). | FS workers / provider adapters (see freespin packages); ledger records unlock/spend per product rules |
| Cashback (net loss) | Signed cash P&L window: `ledger.SumCashGameNetForWindow` (`game.debit`, `game.credit`, `game.rollback`, pocket `cash`). | `bonus/rewards_rebate.go` |
| Wager / turnover rebate | Net cash stake in window: `ledger.SumSuccessfulCashStakeForWindow` (`game.debit` − `game.rollback`). | `bonus/rewards_rebate.go`, `ledger/successful_wager.go` |
| No-deposit / registration | Controlled grants (`promo.grant` / bonus locked) + eligibility flags; no deposit line required. | `bonus/evaluate.go`, `bonus/grant.go`, abuse/risk tables |
| VIP tier / rakeback / hunt gates | Lifetime wager accrual from cash gameplay: `bonus/vip_accrual.go` on **`game.debit`**. `player_vip_state.lifetime_wager_minor` + `bonus/vip_tier_resync.go`. Challenges VIP-only: `challenges/vip_gate.go` reads `player_vip_state`. | `bonus/vip_accrual.go`, `bonus/vip_tier_resync.go`, `wallet/rewards_hub.go` |

## Shared helpers (`services/core/internal/ledger`)

- **`CountSuccessfulDepositCredits`** — deposit count for index / first-deposit style rules (shared with Fystack webhook).
- **`SumCashGameNetForWindow`** — net loss / win for cashback periods.
- **`SumSuccessfulCashStakeForWindow`** — turnover for wager-rebate periods.

Keep admin analytics and promo math on these helpers (or raw equivalent queries) so **player, admin, and risk** do not diverge.
