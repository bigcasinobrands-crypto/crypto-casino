package bonus

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PaymentMatchPreview describes a promotion that would match a deposit event (no grant performed).
type PaymentMatchPreview struct {
	PromotionID        int64  `json:"promotion_id"`
	PromotionVersionID int64  `json:"promotion_version_id"`
	WouldGrantMinor    int64  `json:"would_grant_minor"`
	FreeSpinRounds     int    `json:"free_spin_rounds,omitempty"`
	FreeSpinGameID     string `json:"free_spin_game_id,omitempty"`
}

// PreviewPaymentMatches lists published promotions that match the payment rules (ignores active-WR / idempotency).
func PreviewPaymentMatches(ctx context.Context, pool *pgxpool.Pool, ev PaymentSettled) ([]PaymentMatchPreview, error) {
	if ev.UserID == "" || ev.AmountMinor <= 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT p.id, pv.id, pv.rules
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE p.status != 'archived' AND pv.published_at IS NOT NULL
		  AND COALESCE(p.grants_paused, false) = false
		ORDER BY pv.id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PaymentMatchPreview
	for rows.Next() {
		var pid, vid int64
		var rulesJSON []byte
		if err := rows.Scan(&pid, &vid, &rulesJSON); err != nil {
			continue
		}
		rules, err := parseRules(rulesJSON)
		if err != nil || !rules.matchesDeposit(ev) {
			continue
		}
		if !SegmentTargetingMatches(ctx, pool, ev.UserID, strings.TrimSpace(ev.Country), vid, rulesJSON) {
			continue
		}
		g := rules.computeGrantAmount(ev.AmountMinor)
		fsR, _, fsG, fsOK := rules.freeSpinFromRules()
		if g <= 0 && !fsOK {
			continue
		}
		out = append(out, PaymentMatchPreview{
			PromotionID:        pid,
			PromotionVersionID: vid,
			WouldGrantMinor:    g,
			FreeSpinRounds:     fsR,
			FreeSpinGameID:     fsG,
		})
	}
	return out, nil
}
