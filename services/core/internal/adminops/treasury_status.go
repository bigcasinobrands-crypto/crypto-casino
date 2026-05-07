package adminops

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/adminapi"
)

// Treasury cap status (E-10).
//
// Operator-facing endpoint that reports the platform's 24h withdrawal
// payout total versus the configured daily cap. Used by the admin console
// to render a "Treasury 78%" widget so finance can see at a glance whether
// withdrawals are about to start queueing.

type treasuryStatus struct {
	BudgetCents       int64 `json:"budget_cents"`
	SpentCents24h     int64 `json:"spent_cents_24h"`
	RemainingCents    int64 `json:"remaining_cents"`
	BudgetEnabled     bool  `json:"budget_enabled"`
	HeldForReview     int   `json:"held_for_review_count"`
	HeldForReviewSum  int64 `json:"held_for_review_sum_cents"`
}

// TreasuryStatus returns a snapshot of the operator daily payout cap, the
// 24h spend so far, and how many withdrawals are currently
// PENDING_REVIEW because of cap exhaustion. Always returns 200 even when
// the cap is disabled (BudgetEnabled=false in that case).
func (h *Handler) TreasuryStatus(w http.ResponseWriter, r *http.Request) {
	var s treasuryStatus
	if h.Cfg != nil && h.Cfg.OperatorDailyPayoutCapCents > 0 {
		s.BudgetEnabled = true
		s.BudgetCents = h.Cfg.OperatorDailyPayoutCapCents
	}

	var spent int64
	if err := h.Pool.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE entry_type = 'withdrawal.pending.settled'
		  AND amount_minor < 0
		  AND pocket = 'pending_withdrawal'
		  AND created_at >= now() - INTERVAL '24 hours'
	`).Scan(&spent); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "treasury_query_failed", err.Error())
		return
	}
	if spent < 0 {
		spent = -spent
	}
	s.SpentCents24h = spent
	if s.BudgetEnabled {
		s.RemainingCents = s.BudgetCents - s.SpentCents24h
		if s.RemainingCents < 0 {
			s.RemainingCents = 0
		}
	}

	var heldCount int
	var heldSum int64
	if err := h.Pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int, COALESCE(SUM(amount_minor),0)::bigint
		FROM payment_withdrawals
		WHERE status = 'PENDING_REVIEW'
		  AND failure_reason = 'operator_daily_payout_cap_exceeded'
	`).Scan(&heldCount, &heldSum); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "treasury_held_query_failed", err.Error())
		return
	}
	s.HeldForReview = heldCount
	s.HeldForReviewSum = heldSum

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s)
}
