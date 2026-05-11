package adminops

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// dashboardNGRBreakdown holds ledger-backed cost components for NGR (minor units, all posted lines).
type dashboardNGRBreakdown struct {
	GGR                 int64
	BonusCost           int64
	CashbackPaid        int64
	RakebackPaid        int64
	VipRewardsPaid      int64
	AffiliateCommission int64
	JackpotCosts        int64
	PaymentProviderFees int64
	ManualAdjustments   int64
}

// ngrTotalFromBreakdown returns GGR minus all cost buckets (safe when GGR is 0).
func ngrTotalFromBreakdown(b dashboardNGRBreakdown) int64 {
	costs := b.BonusCost + b.CashbackPaid + b.RakebackPaid + b.VipRewardsPaid +
		b.AffiliateCommission + b.JackpotCosts + b.PaymentProviderFees + b.ManualAdjustments
	return b.GGR - costs
}

// queryDashboardNGRBreakdown loads GGR (same definition as headline casino GGR) and NGR cost buckets for the window.
func queryDashboardNGRBreakdown(ctx context.Context, pool *pgxpool.Pool, start, end time.Time, all bool) (dashboardNGRBreakdown, error) {
	var b dashboardNGRBreakdown
	if pool == nil {
		return b, nil
	}
	win := clauseWithAlias(all, "le", start, end)
	// Jackpot: reserved for future ledger types; no writers today → 0.
	jackpotCol := `0::bigint`

	q := `
SELECT
	COALESCE((SELECT
		SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(le.amount_minor) WHEN le.entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(le.amount_minor) ELSE 0 END) -
		SUM(CASE WHEN le.entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit') THEN le.amount_minor ELSE 0 END)
		FROM ledger_entries le
		WHERE le.entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback','game.win_rollback','sportsbook.debit','sportsbook.credit','sportsbook.rollback')
		AND ` + win + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'promo.grant' AND le.pocket = 'bonus_locked' AND le.amount_minor > 0 AND ` + win + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		JOIN reward_programs rp ON rp.id = (NULLIF(le.metadata->>'reward_program_id',''))::bigint
		WHERE le.entry_type = 'promo.rakeback' AND le.pocket = 'cash' AND le.amount_minor > 0
		  AND rp.kind = 'cashback_net_loss' AND ` + win + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		LEFT JOIN reward_programs rp ON rp.id = (NULLIF(le.metadata->>'reward_program_id',''))::bigint
		WHERE le.entry_type = 'promo.rakeback' AND le.pocket = 'cash' AND le.amount_minor > 0
		  AND (rp.kind IS NULL OR rp.kind <> 'cashback_net_loss') AND ` + win + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type IN ('vip.level_up_cash','promo.daily_hunt_cash','challenge.prize')
		  AND le.pocket = 'cash' AND le.amount_minor > 0 AND ` + win + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'affiliate.payout' AND le.pocket = 'cash' AND le.amount_minor > 0 AND ` + win + `), 0),
	` + jackpotCol + `,
	COALESCE((SELECT SUM(-le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'provider.fee' AND le.pocket = 'cash' AND le.amount_minor < 0 AND ` + win + `), 0),
	COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
		WHERE le.entry_type = 'admin.play_credit' AND le.pocket = 'cash' AND le.amount_minor > 0 AND ` + win + `), 0)
`
	args := []any{start, end}
	if all {
		args = []any{end}
	}
	err := pool.QueryRow(ctx, q, args...).Scan(
		&b.GGR,
		&b.BonusCost,
		&b.CashbackPaid,
		&b.RakebackPaid,
		&b.VipRewardsPaid,
		&b.AffiliateCommission,
		&b.JackpotCosts,
		&b.PaymentProviderFees,
		&b.ManualAdjustments,
	)
	return b, err
}

func ngrBreakdownJSON(b dashboardNGRBreakdown) map[string]any {
	ngr := ngrTotalFromBreakdown(b)
	return map[string]any{
		"ggr":                    b.GGR,
		"bonus_cost":             b.BonusCost,
		"cashback_paid":          b.CashbackPaid,
		"rakeback_paid":          b.RakebackPaid,
		"vip_rewards_paid":       b.VipRewardsPaid,
		"affiliate_commission":   b.AffiliateCommission,
		"jackpot_costs":          b.JackpotCosts,
		"payment_provider_fees":  b.PaymentProviderFees,
		"manual_adjustments":     b.ManualAdjustments,
		"ngr_total":              ngr,
	}
}
