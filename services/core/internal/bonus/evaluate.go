package bonus

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EvaluatePaymentSettled matches published promotions and grants with idempotent keys.
func EvaluatePaymentSettled(ctx context.Context, pool *pgxpool.Pool, ev PaymentSettled) error {
	if ev.UserID == "" || ev.ProviderResourceID == "" || ev.AmountMinor <= 0 {
		return nil
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return err
	}
	if !bf.BonusesEnabled || !bf.AutomatedGrantsEnabled {
		return nil
	}

	rows, err := pool.Query(ctx, `
		SELECT pv.id, pv.rules, pv.valid_from, pv.valid_to
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE p.status != 'archived' AND pv.published_at IS NOT NULL
		  AND COALESCE(p.grants_paused, false) = false
		ORDER BY pv.priority DESC, pv.published_at DESC NULLS LAST, pv.id DESC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	now := time.Now().UTC()
	promoGranted := false
	for rows.Next() {
		var vid int64
		var rulesJSON []byte
		var vf, vt sql.NullTime
		if err := rows.Scan(&vid, &rulesJSON, &vf, &vt); err != nil {
			continue
		}
		sched := VersionSchedule{}
		if vf.Valid {
			t := vf.Time
			sched.ValidFrom = &t
		}
		if vt.Valid {
			t := vt.Time
			sched.ValidTo = &t
		}
		if !OfferScheduleOpen(now, sched) {
			continue
		}
		rules, err := parseRules(rulesJSON)
		if err != nil || !rules.matchesDeposit(ev) {
			continue
		}
		if !SegmentTargetingMatches(ctx, pool, ev.UserID, strings.TrimSpace(ev.Country), vid, rulesJSON) {
			continue
		}
		grant := rules.computeGrantAmount(ev.AmountMinor)
		if grant <= 0 {
			continue
		}
		idemKey := fmt.Sprintf("bonus:grant:deposit:%s:%d", ev.ProviderResourceID, vid)
		inserted, err := GrantFromPromotionVersion(ctx, pool, GrantArgs{
			UserID:             ev.UserID,
			PromotionVersionID: vid,
			IdempotencyKey:     idemKey,
			GrantAmountMinor:   grant,
			Currency:           ev.Currency,
			DepositAmountMinor: ev.AmountMinor,
		})
		if err != nil {
			if errors.Is(err, ErrBonusesDisabled) {
				return nil
			}
			obs.IncBonusEvalError()
			return err
		}
		if inserted {
			promoGranted = true
			break
		}
		// No insert (risk gate, active WR elsewhere, idempotent duplicate, etc.) — try next published version by priority.
		continue
	}
	if promoGranted {
		return nil
	}
	return EvaluateAutomationForPayment(ctx, pool, ev)
}
