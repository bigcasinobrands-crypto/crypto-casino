package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type automationAction struct {
	PromotionVersionID int64 `json:"promotion_version_id"`
}

// EvaluateAutomationForPayment runs after no promotion auto-grant matched this payment.
// Rules are ordered by priority DESC; the first rule that yields a grant wins.
// The bool is true if a new bonus instance was inserted for this payment.
func EvaluateAutomationForPayment(ctx context.Context, pool *pgxpool.Pool, ev PaymentSettled) (bool, error) {
	if ev.UserID == "" || ev.ProviderResourceID == "" || ev.AmountMinor <= 0 {
		return false, nil
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return false, err
	}
	if !bf.BonusesEnabled || !bf.AutomatedGrantsEnabled {
		return false, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, segment_filter, action
		FROM bonus_automation_rules
		WHERE enabled = true AND trigger_type = 'payment_settled'
		ORDER BY priority DESC, id ASC
	`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var ruleID int64
		var segJSON, actJSON []byte
		if err := rows.Scan(&ruleID, &segJSON, &actJSON); err != nil {
			continue
		}
		if !automationSegmentMatches(segJSON, ev) {
			continue
		}
		var act automationAction
		if err := json.Unmarshal(actJSON, &act); err != nil || act.PromotionVersionID <= 0 {
			continue
		}
		var rulesJSON []byte
		err = pool.QueryRow(ctx, `
			SELECT pv.rules
			FROM promotion_versions pv
			JOIN promotions p ON p.id = pv.promotion_id
			WHERE pv.id = $1 AND p.status != 'archived' AND pv.published_at IS NOT NULL
			  AND COALESCE(p.grants_paused, false) = false
		`, act.PromotionVersionID).Scan(&rulesJSON)
		if err != nil {
			continue
		}
		rules, err := parseRules(rulesJSON)
		if err != nil || !rules.matchesDeposit(ev) {
			continue
		}
		grant := rules.computeGrantAmount(ev.AmountMinor)
		fsR, fsBet, fsG, fsOK := rules.freeSpinFromRules()
		if grant <= 0 && !fsOK {
			continue
		}
		prefix := fmt.Sprintf("bonus:auto:%d:%s:%s", ruleID, ev.UserID, ev.ProviderResourceID)
		cashIn := false
		if grant > 0 {
			inserted, err2 := GrantFromPromotionVersion(ctx, pool, GrantArgs{
				UserID:             ev.UserID,
				PromotionVersionID: act.PromotionVersionID,
				IdempotencyKey:     prefix + ":cash",
				GrantAmountMinor:   grant,
				Currency:           ev.Currency,
				DepositAmountMinor: ev.AmountMinor,
			})
			if err2 != nil {
				if errors.Is(err2, ErrBonusesDisabled) {
					return false, nil
				}
				return false, err2
			}
			cashIn = inserted
			if !cashIn {
				break
			}
		}
		fsIn := false
		if fsOK {
			var ptitle string
			_ = pool.QueryRow(ctx, `SELECT COALESCE(NULLIF(TRIM(player_title), ''), '') FROM promotion_versions WHERE id = $1`, act.PromotionVersionID).Scan(&ptitle)
			fsIn, err = EnqueueFreeSpinFromPromotionVersion(ctx, pool, FreeSpinEnqueueArgs{
				UserID:             ev.UserID,
				PromotionVersionID: act.PromotionVersionID,
				IdempotencyKey:     prefix + ":fs",
				Rounds:             fsR,
				GameID:             fsG,
				BetPerRoundMinor:   fsBet,
				Title:              ptitle,
				Source:             "automation",
			})
			if err != nil {
				return false, err
			}
		}
		if (grant > 0 && cashIn) || (fsOK && fsIn) {
			return true, nil
		}
		// Matched this rule but duplicate / blocked — do not try another automation on same payment.
		break
	}
	return false, nil
}

func automationSegmentMatches(segJSON []byte, ev PaymentSettled) bool {
	if len(segJSON) == 0 || string(segJSON) == "{}" || string(segJSON) == "null" {
		return true
	}
	var seg struct {
		Channels []string `json:"channels"`
	}
	if err := json.Unmarshal(segJSON, &seg); err != nil {
		return true
	}
	if len(seg.Channels) == 0 {
		return true
	}
	ch := strings.TrimSpace(strings.ToLower(ev.Channel))
	for _, c := range seg.Channels {
		if strings.TrimSpace(strings.ToLower(c)) == ch {
			return true
		}
	}
	return false
}
