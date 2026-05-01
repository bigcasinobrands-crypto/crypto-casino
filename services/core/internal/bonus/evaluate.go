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

type paymentEvalCandidate struct {
	vid       int64
	rulesJSON []byte
	vf, vt    sql.NullTime
}

// EvaluatePaymentSettled matches published promotions and grants with idempotent keys.
//
// Product policy:
//   - Deposit matching is driven by each promotion’s rules (min/max deposit, first/nth deposit,
//     channel, and segment/location) — not by the player’s wallet balance, unless a rule field encodes that.
//   - If the player has chosen a promo in the hub (Get bonus) / player_bonus_deposit_intents, that
//     version is the only one evaluated for this payment — the engine does not “fall through” to
//     another high-priority welcome offer. If the deposit or segment does not satisfy that promo, no
//     grant; the intent row stays for a later qualifying deposit.
//   - automated_grants_enabled=false suppresses the generic priority sweep and automation (no
//     claim-first opt-in) but a hub deposit intent is still processed when bonuses_enabled is true.
func EvaluatePaymentSettled(ctx context.Context, pool *pgxpool.Pool, ev PaymentSettled) error {
	if ev.UserID == "" || ev.ProviderResourceID == "" || ev.AmountMinor <= 0 {
		return nil
	}

	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return err
	}
	if !bf.BonusesEnabled {
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
	var candidates []paymentEvalCandidate
	for rows.Next() {
		var c paymentEvalCandidate
		if err := rows.Scan(&c.vid, &c.rulesJSON, &c.vf, &c.vt); err != nil {
			continue
		}
		candidates = append(candidates, c)
	}

	prefVID, hasPref, err := GetPlayerDepositIntentPromotionVersionID(ctx, pool, ev.UserID)
	if err != nil {
		return err
	}

	// Pinned opt-in: only the claimed promotion version is considered (if present in catalog).
	// If automated_grants is off, do not run the open catalog; hub intent alone is still allowed.
	var evalList []paymentEvalCandidate
	if hasPref && prefVID > 0 {
		for i := range candidates {
			if candidates[i].vid == prefVID {
				evalList = []paymentEvalCandidate{candidates[i]}
				break
			}
		}
	} else if bf.AutomatedGrantsEnabled {
		evalList = candidates
	}

	now := time.Now().UTC()
	promoGranted := false
	for _, c := range evalList {
		vid := c.vid
		rulesJSON := c.rulesJSON
		sched := VersionSchedule{}
		if c.vf.Valid {
			t := c.vf.Time
			sched.ValidFrom = &t
		}
		if c.vt.Valid {
			t := c.vt.Time
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
		fsRounds, fsBet, fsGame, fsOK := rules.freeSpinFromRules()
		if grant <= 0 && !fsOK {
			continue
		}
		cashIn := false
		if grant > 0 {
			idemKey := fmt.Sprintf("bonus:grant:deposit:%s:%d", ev.ProviderResourceID, vid)
			inserted, err2 := GrantFromPromotionVersion(ctx, pool, GrantArgs{
				UserID:             ev.UserID,
				PromotionVersionID: vid,
				IdempotencyKey:     idemKey,
				GrantAmountMinor:   grant,
				Currency:           ev.Currency,
				DepositAmountMinor: ev.AmountMinor,
			})
			if err2 != nil {
				if errors.Is(err2, ErrBonusesDisabled) {
					return nil
				}
				obs.IncBonusEvalError()
				return err2
			}
			cashIn = inserted
			if !cashIn {
				// e.g. primary slot full, risk manual_review — do not add free spins on a failed match leg
				continue
			}
		}
		fsIn := false
		if fsOK {
			var ptitle string
			_ = pool.QueryRow(ctx, `SELECT COALESCE(NULLIF(TRIM(player_title), ''), '') FROM promotion_versions WHERE id = $1`, vid).Scan(&ptitle)
			fsidem := fmt.Sprintf("bonus:fs:deposit:%s:%d", ev.ProviderResourceID, vid)
			fsIn, err = EnqueueFreeSpinFromPromotionVersion(ctx, pool, FreeSpinEnqueueArgs{
				UserID:             ev.UserID,
				PromotionVersionID: vid,
				IdempotencyKey:     fsidem,
				Rounds:             fsRounds,
				GameID:             fsGame,
				BetPerRoundMinor:   fsBet,
				Title:              ptitle,
				Source:             "payment_settled",
			})
			if err != nil {
				obs.IncBonusEvalError()
				return err
			}
		}
		if (grant > 0 && cashIn) || (fsOK && fsIn) {
			promoGranted = true
			break
		}
	}
	if promoGranted {
		ClearPlayerDepositIntent(ctx, pool, ev.UserID)
		return nil
	}
	// A hub claim is exclusive: if it did not grant (amount/segment/WR slot, etc.),
	// do not grant a different promotion on the same payment; intent is kept for a later deposit.
	if hasPref {
		return nil
	}
	if !bf.AutomatedGrantsEnabled {
		return nil
	}
	autoGranted, err := EvaluateAutomationForPayment(ctx, pool, ev)
	if err != nil {
		return err
	}
	if autoGranted {
		ClearPlayerDepositIntent(ctx, pool, ev.UserID)
	}
	return nil
}
