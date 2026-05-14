package adminops

import (
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
)

// DebugFinanceGGR returns settled-stake, win, and GGR components for the requested window (superadmin).
func (h *Handler) DebugFinanceGGR(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	b, err := queryDashboardNGRBreakdown(ctx, h.Pool, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	hold := 0.0
	if b.SettledBetsMinor > 0 {
		hold = float64(b.GGR) / float64(b.SettledBetsMinor) * 100
	}
	writeJSON(w, map[string]any{
		"window": map[string]any{
			"start": start.Format(time.RFC3339),
			"end":   end.Format(time.RFC3339),
			"all":   all,
		},
		"definitions": map[string]string{
			"ggr":                  "settled_stakes_minor - settled_wins_minor (same as dashboard NGR breakdown)",
			"settled_stakes":       "SUM stake CASE on debit/bet lines net of rollback lines; NGR filter applied",
			"gross_debit_turnover": "SUM ABS on game.debit/game.bet/sportsbook.debit only (not the GGR stake basis)",
		},
		"settled_stakes_minor":               b.SettledBetsMinor,
		"settled_wins_minor":                 b.SettledWinsMinor,
		"ggr_minor":                          b.GGR,
		"gross_stake_debit_turnover_minor":   b.TotalWageredDebitMinor,
		"implied_hold_pct_of_settled_stakes": hold,
	})
}

// DebugFinanceNGR returns the full NGR breakdown for the window (superadmin).
func (h *Handler) DebugFinanceNGR(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	b, err := queryDashboardNGRBreakdown(ctx, h.Pool, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	ngr := ngrTotalFromBreakdown(b)
	writeJSON(w, map[string]any{
		"window": map[string]any{
			"start": start.Format(time.RFC3339),
			"end":   end.Format(time.RFC3339),
			"all":   all,
		},
		"breakdown": ngrBreakdownJSON(b),
		"ngr_minor": ngr,
	})
}

// DebugFinanceLedgerReconciliation returns diagnostic counts for ledger hygiene (superadmin).
func (h *Handler) DebugFinanceLedgerReconciliation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	win := clauseWithAlias(all, "le", start, end)
	ngrF := ledger.NGRReportingFilterSQL("le")

	var dupKeys int64
	if err := h.Pool.QueryRow(ctx, `
SELECT COUNT(*) FROM (
  SELECT le.idempotency_key
  FROM ledger_entries le
  WHERE `+win+` AND `+ngrF+` AND COALESCE(le.idempotency_key,'') <> ''
  GROUP BY le.idempotency_key
  HAVING COUNT(*) > 1
) t`).Scan(&dupKeys); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	var testSeed, debitResetCredits, excludedUserLines int64
	if err := h.Pool.QueryRow(ctx, `
SELECT
  COALESCE((SELECT COUNT(*) FROM ledger_entries le WHERE `+win+` AND le.entry_type = 'test.seed'), 0),
  COALESCE((SELECT COUNT(*) FROM ledger_entries le WHERE `+win+`
    AND le.entry_type = 'game.credit' AND le.idempotency_key LIKE '%:debit_reset:%'), 0),
  COALESCE((SELECT COUNT(*) FROM ledger_entries le WHERE `+win+`
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = le.user_id AND COALESCE(u.exclude_from_dashboard_analytics,false))
    AND le.entry_type <> 'provider.fee'), 0)
`).Scan(&testSeed, &debitResetCredits, &excludedUserLines); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	b, err := queryDashboardNGRBreakdown(ctx, h.Pool, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, map[string]any{
		"window": map[string]any{
			"start": start.Format(time.RFC3339),
			"end":   end.Format(time.RFC3339),
			"all":   all,
		},
		"duplicate_idempotency_key_groups": dupKeys,
		"lines": map[string]int64{
			"test_seed":                                  testSeed,
			"game_credit_debit_reset_pattern":            debitResetCredits,
			"lines_from_exclude_analytics_users_non_fee": excludedUserLines,
		},
		"reporting_ggr_minor":                  b.GGR,
		"reporting_settled_stakes_minor":       b.SettledBetsMinor,
		"reporting_gross_debit_turnover_minor": b.TotalWageredDebitMinor,
		"ngr_filter_sql_documentation":         "ledger.NGRReportingFilterSQL",
		"note":                                 "Account-category ledger, provider-test flags, and historical aggregate rebuild are roadmap items; this endpoint reflects current ledger-backed reporting SQL only.",
	})
}
