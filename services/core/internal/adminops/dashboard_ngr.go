package adminops

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

// dashboardNGRBreakdown holds ledger-backed GGR components and NGR cost buckets (minor units).
// GGR = SettledBetsMinor − SettledWinsMinor (posted ledger semantics; see metrics_derivation).
type dashboardNGRBreakdown struct {
	SettledBetsMinor    int64
	SettledWinsMinor    int64
	BonusCost           int64
	CashbackPaid        int64
	RakebackPaid        int64
	VipRewardsPaid      int64
	AffiliateCommission int64
	JackpotCosts        int64
	PaymentProviderFees int64
	ManualAdjustments   int64
	// TotalWageredDebitMinor is ABS stake volume on debit lines only (matches dashboard KPI "total wagered"; excludes rollbacks).
	TotalWageredDebitMinor int64
	GGR                    int64 // SettledBetsMinor − SettledWinsMinor after Scan
}

// ngrTotalFromBreakdown returns GGR minus all cost buckets (safe when GGR is 0).
func ngrTotalFromBreakdown(b dashboardNGRBreakdown) int64 {
	costs := b.BonusCost + b.CashbackPaid + b.RakebackPaid + b.VipRewardsPaid +
		b.AffiliateCommission + b.JackpotCosts + b.PaymentProviderFees + b.ManualAdjustments
	return b.GGR - costs
}

func ngrDebugEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("NGR_ANALYTICS_DEBUG")))
	return v == "1" || v == "true" || v == "yes"
}

func logNGRDebug(windowLabel string, start, end time.Time, all bool, b dashboardNGRBreakdown) {
	if !ngrDebugEnabled() {
		return
	}
	ngr := ngrTotalFromBreakdown(b)
	slog.Info("ngr_analytics_debug",
		"window", windowLabel,
		"start", start.Format(time.RFC3339),
		"end", end.Format(time.RFC3339),
		"all_time", all,
		"settled_bets_minor", b.SettledBetsMinor,
		"settled_wins_minor", b.SettledWinsMinor,
		"ggr_minor", b.GGR,
		"bonus_cost_minor", b.BonusCost,
		"cashback_paid_minor", b.CashbackPaid,
		"rakeback_paid_minor", b.RakebackPaid,
		"vip_rewards_minor", b.VipRewardsPaid,
		"affiliate_commission_minor", b.AffiliateCommission,
		"jackpot_costs_minor", b.JackpotCosts,
		"payment_provider_fees_minor", b.PaymentProviderFees,
		"manual_adjustments_minor", b.ManualAdjustments,
		"total_wagered_debit_minor", b.TotalWageredDebitMinor,
		"ngr_minor", ngr,
	)
}

// queryDashboardNGRBreakdown loads settled bets/wins, GGR, and NGR cost buckets for the window.
// Time axis: ledger_entries.created_at (committed posting time; no separate posted_at column).
func queryDashboardNGRBreakdown(ctx context.Context, pool *pgxpool.Pool, start, end time.Time, all bool) (dashboardNGRBreakdown, error) {
	var b dashboardNGRBreakdown
	if pool == nil {
		return b, nil
	}
	win := clauseWithAlias(all, "le", start, end)
	ngrF := ledger.NGRReportingFilterSQL("le")
	jackpotCol := `0::bigint`

	q := `
SELECT
	COALESCE((SELECT SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(le.amount_minor) WHEN le.entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(le.amount_minor) ELSE 0 END)
		FROM ledger_entries le
		WHERE le.entry_type IN ('game.debit','game.bet','sportsbook.debit','game.rollback','sportsbook.rollback')
		AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(CASE WHEN le.entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit') THEN le.amount_minor ELSE 0 END)
		FROM ledger_entries le
		WHERE le.entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit')
		AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'promo.grant' AND le.pocket = 'bonus_locked' AND le.amount_minor > 0 AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		JOIN reward_programs rp ON rp.id = (NULLIF(le.metadata->>'reward_program_id',''))::bigint
		WHERE le.entry_type = 'promo.rakeback' AND le.pocket = 'cash' AND le.amount_minor > 0
		  AND rp.kind = 'cashback_net_loss' AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		LEFT JOIN reward_programs rp ON rp.id = (NULLIF(le.metadata->>'reward_program_id',''))::bigint
		WHERE le.entry_type = 'promo.rakeback' AND le.pocket = 'cash' AND le.amount_minor > 0
		  AND (rp.kind IS NULL OR rp.kind <> 'cashback_net_loss') AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type IN ('vip.level_up_cash','promo.daily_hunt_cash','challenge.prize')
		  AND le.pocket = 'cash' AND le.amount_minor > 0 AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'affiliate.payout' AND le.pocket = 'cash' AND le.amount_minor > 0 AND ` + win + ` AND ` + ngrF + `), 0),
	` + jackpotCol + `,
	COALESCE((SELECT SUM(-le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'provider.fee' AND le.pocket = 'cash' AND le.amount_minor < 0 AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'admin.play_credit' AND le.pocket = 'cash' AND le.amount_minor > 0 AND ` + win + ` AND ` + ngrF + `), 0),
	COALESCE((SELECT SUM(ABS(le.amount_minor)) FROM ledger_entries le
		WHERE le.entry_type IN ('game.debit','game.bet','sportsbook.debit') AND ` + win + ` AND ` + ngrF + `), 0)
`
	args := []any{start, end}
	if all {
		args = []any{end}
	}
	err := pool.QueryRow(ctx, q, args...).Scan(
		&b.SettledBetsMinor,
		&b.SettledWinsMinor,
		&b.BonusCost,
		&b.CashbackPaid,
		&b.RakebackPaid,
		&b.VipRewardsPaid,
		&b.AffiliateCommission,
		&b.JackpotCosts,
		&b.PaymentProviderFees,
		&b.ManualAdjustments,
		&b.TotalWageredDebitMinor,
	)
	if err != nil {
		return b, err
	}
	b.GGR = b.SettledBetsMinor - b.SettledWinsMinor
	return b, nil
}

// queryActiveWageringUsers counts distinct users with a stake line in the window (game.debit or sportsbook.debit).
func queryActiveWageringUsers(ctx context.Context, pool *pgxpool.Pool, start, end time.Time, all bool) (int64, error) {
	if pool == nil {
		return 0, nil
	}
	win := clauseWithAlias(all, "le", start, end)
	ngrF := ledger.NGRReportingFilterSQL("le")
	q := `
SELECT COALESCE(COUNT(DISTINCT le.user_id), 0)
FROM ledger_entries le
WHERE le.entry_type IN ('game.debit','sportsbook.debit')
  AND ` + win + ` AND ` + ngrF
	args := []any{start, end}
	if all {
		args = []any{end}
	}
	var n int64
	err := pool.QueryRow(ctx, q, args...).Scan(&n)
	return n, err
}

func ngrBreakdownJSON(b dashboardNGRBreakdown) map[string]any {
	ngr := ngrTotalFromBreakdown(b)
	return map[string]any{
		"settled_bets_minor":    b.SettledBetsMinor,
		"settled_wins_minor":    b.SettledWinsMinor,
		"total_wagered_minor":   b.TotalWageredDebitMinor,
		"ggr":                   b.GGR,
		"ggr_minor":             b.GGR,
		"bonus_cost":            b.BonusCost,
		"cashback_paid":         b.CashbackPaid,
		"rakeback_paid":         b.RakebackPaid,
		"vip_rewards_paid":      b.VipRewardsPaid,
		"affiliate_commission":  b.AffiliateCommission,
		"jackpot_costs":         b.JackpotCosts,
		"payment_provider_fees": b.PaymentProviderFees,
		"manual_adjustments":    b.ManualAdjustments,
		"ngr_total":             ngr,
	}
}

// DashboardNGRBreakdown returns the same ledger-backed NGR components as casino analytics KPIs.
func (h *Handler) DashboardNGRBreakdown(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	b, err := queryDashboardNGRBreakdown(ctx, h.Pool, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "ngr breakdown query failed")
		return
	}
	if ngrDebugEnabled() {
		logNGRDebug("ngr_breakdown_endpoint", start, end, all, b)
	}
	writeJSON(w, map[string]any{
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"time_axis": "ledger_entries.created_at",
		"breakdown": ngrBreakdownJSON(b),
	})
}
