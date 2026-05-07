package adminops

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
)

// FundSegregationRow is one currency snapshot of the player-vs-house balance sheet.
type FundSegregationRow struct {
	Currency             string `json:"currency"`
	PlayerCashLiability  int64  `json:"player_cash_liability_minor"`
	PlayerBonusLiability int64  `json:"player_bonus_liability_minor"`
	PlayerPendingWD      int64  `json:"player_pending_withdrawal_minor"`
	HouseClearingDeposit int64  `json:"house_clearing_deposit_minor"`
	HouseClearingOut     int64  `json:"house_clearing_out_minor"`
	HouseNetClearing     int64  `json:"house_net_clearing_minor"`
	NetImbalance         int64  `json:"net_imbalance_minor"`
	Healthy              bool   `json:"healthy"`
}

// FundSegregationReport is the full payload returned by GET /v1/admin/finance/fund-segregation.
type FundSegregationReport struct {
	GeneratedAt string               `json:"generated_at"`
	Rows        []FundSegregationRow `json:"rows"`
	// Tolerance below which the row counts as healthy. The ledger is
	// double-entry so the legitimate steady-state imbalance is exactly zero;
	// we keep a tiny tolerance for the brief windows between paired
	// transaction commits (intra-tx the legs always settle together, but a
	// snapshot taken between a deposit's user-credit and house-clearing-leg
	// can momentarily show non-zero — this is observed only in load tests).
	ToleranceMinor int64 `json:"tolerance_minor"`
	// AlertsRaised counts how many rows triggered a reconciliation_alerts
	// insert in this run (i.e. exceeded tolerance). Surfaced for ops dashboards.
	AlertsRaised int `json:"alerts_raised"`
}

// FundSegregationHandler returns a per-currency comparison of the player-side
// liability (cash + bonus_locked + pending_withdrawal pockets aggregated across
// all real users) and the house-side clearing accounts. In a healthy ledger
// these must balance for every currency:
//
//	sum(player cash + bonus_locked + pending_withdrawal)
//	  ==  sum(house clearing_deposit) - sum(house clearing_withdrawal_out)
//
// because every player credit is mirrored by a house clearing leg. When this
// is broken — e.g. a deposit credited a player without the inbound clearing
// leg, or a withdrawal posted the outbound leg without releasing pending — we
// MUST raise a reconciliation alert immediately. This is the most important
// "is the ledger consistent" canary in the platform.
func (h *Handler) FundSegregationHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		report, err := buildFundSegregationReport(r.Context(), h)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "fund_segregation_failed", err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(report)
	}
}

func buildFundSegregationReport(ctx context.Context, h *Handler) (FundSegregationReport, error) {
	const tolerance int64 = 0
	houseUserID := ledger.HouseUserID(h.Cfg)

	rows, err := h.Pool.Query(ctx, `
		WITH player AS (
			SELECT
				currency,
				COALESCE(SUM(amount_minor) FILTER (WHERE pocket = 'cash'), 0)::bigint               AS player_cash,
				COALESCE(SUM(amount_minor) FILTER (WHERE pocket = 'bonus_locked'), 0)::bigint        AS player_bonus,
				COALESCE(SUM(amount_minor) FILTER (WHERE pocket = 'pending_withdrawal'), 0)::bigint  AS player_pending
			FROM ledger_entries
			WHERE user_id <> $1::uuid
			GROUP BY currency
		), house AS (
			SELECT
				currency,
				COALESCE(SUM(amount_minor) FILTER (WHERE pocket = 'clearing_deposit'), 0)::bigint           AS house_clearing_in,
				COALESCE(SUM(amount_minor) FILTER (WHERE pocket = 'clearing_withdrawal_out'), 0)::bigint    AS house_clearing_out
			FROM ledger_entries
			WHERE user_id = $1::uuid
			GROUP BY currency
		)
		SELECT
			COALESCE(p.currency, h.currency) AS currency,
			COALESCE(p.player_cash, 0),
			COALESCE(p.player_bonus, 0),
			COALESCE(p.player_pending, 0),
			COALESCE(h.house_clearing_in, 0),
			COALESCE(h.house_clearing_out, 0)
		FROM player p
		FULL OUTER JOIN house h ON h.currency = p.currency
		ORDER BY 1
	`, houseUserID)
	if err != nil {
		return FundSegregationReport{}, err
	}
	defer rows.Close()

	out := FundSegregationReport{
		GeneratedAt:    time.Now().UTC().Format(time.RFC3339),
		ToleranceMinor: tolerance,
	}
	for rows.Next() {
		var row FundSegregationRow
		if err := rows.Scan(
			&row.Currency,
			&row.PlayerCashLiability,
			&row.PlayerBonusLiability,
			&row.PlayerPendingWD,
			&row.HouseClearingDeposit,
			&row.HouseClearingOut,
		); err != nil {
			return FundSegregationReport{}, err
		}
		// House clearing nets the inbound (positive) against the outbound
		// (stored as negative in the ledger so we add it directly). A
		// well-formed ledger has player_total ~= house_net_clearing.
		row.HouseNetClearing = row.HouseClearingDeposit + row.HouseClearingOut
		playerTotal := row.PlayerCashLiability + row.PlayerBonusLiability + row.PlayerPendingWD
		row.NetImbalance = playerTotal - row.HouseNetClearing
		row.Healthy = absInt64(row.NetImbalance) <= tolerance
		out.Rows = append(out.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}

	for _, row := range out.Rows {
		if row.Healthy {
			continue
		}
		details := map[string]any{
			"currency":                    row.Currency,
			"player_cash_minor":           row.PlayerCashLiability,
			"player_bonus_minor":          row.PlayerBonusLiability,
			"player_pending_withdraw_minor": row.PlayerPendingWD,
			"house_clearing_deposit_minor":  row.HouseClearingDeposit,
			"house_clearing_out_minor":      row.HouseClearingOut,
			"house_net_clearing_minor":      row.HouseNetClearing,
			"net_imbalance_minor":           row.NetImbalance,
			"tolerance_minor":               tolerance,
		}
		detailsJSON, _ := json.Marshal(details)
		if _, err := h.Pool.Exec(ctx, `
			INSERT INTO reconciliation_alerts (kind, reference_type, reference_id, details)
			VALUES ('fund_segregation_imbalance', 'currency', $1, COALESCE($2::jsonb, '{}'::jsonb))
		`, row.Currency, detailsJSON); err != nil {
			slog.ErrorContext(ctx, "fund_segregation_alert_insert_failed",
				"currency", row.Currency,
				"net_imbalance", row.NetImbalance,
				"err", err,
			)
			continue
		}
		out.AlertsRaised++
	}
	return out, nil
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
