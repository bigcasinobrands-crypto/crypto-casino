package bonus

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrClaimOfferNotEligible is returned when the version is not in the player's available-offer list.
var ErrClaimOfferNotEligible = errors.New("bonus: offer not eligible for claim")

// ErrClaimOfferBlocked is returned when eligibility passed but grant did not complete (risk, slot full, etc.).
var ErrClaimOfferBlocked = errors.New("bonus: offer could not be activated right now")

// ClaimPlayerOfferResult describes POST /v1/bonuses/claim-offer outcome.
type ClaimPlayerOfferResult struct {
	Mode            string `json:"mode"` // granted | activated (activated = registered; credit on qualifying deposit if match promo)
	BonusInstanceID string `json:"bonus_instance_id,omitempty"`
}

func promotionVersionIDFromOfferMapLocal(o map[string]any) (int64, bool) {
	v, ok := o["promotion_version_id"]
	if !ok {
		return 0, false
	}
	switch x := v.(type) {
	case int64:
		return x, true
	case int:
		return int64(x), true
	case float64:
		return int64(x), true
	default:
		return 0, false
	}
}

func instantGrantMinor(rules promoRules, bonusType string, hubBoost bool) int64 {
	if hubBoost && rules.PlayerOptInGrantMinor > 0 {
		return rules.PlayerOptInGrantMinor
	}
	g := rules.computeGrantAmount(0)
	if g <= 0 && rules.Reward.FixedMinor > 0 {
		g = rules.Reward.FixedMinor
	}
	if g <= 0 {
		return 0
	}
	bt := strings.ToLower(strings.TrimSpace(bonusType))
	if bt == "no_deposit" {
		return g
	}
	tt := strings.ToLower(strings.TrimSpace(rules.Trigger.Type))
	if tt != "deposit" {
		return 0
	}
	if rules.Trigger.MinMinor > 0 {
		return 0
	}
	if rules.Trigger.FirstDepositOnly {
		return 0
	}
	if rules.Trigger.NthDeposit > 0 {
		return 0
	}
	rt := strings.ToLower(strings.TrimSpace(rules.Reward.Type))
	if rt == "fixed" || rt == "fixed_amount" {
		return g
	}
	// fixed_minor with empty reward type still yields g>0 from compute path when percent is 0
	if rules.Reward.FixedMinor > 0 && rules.Reward.Percent <= 0 {
		return g
	}
	return 0
}

// ClaimPlayerOffer grants a no-deposit / fixed-zero-minor offer, or records deposit intent for match promos.
func ClaimPlayerOffer(ctx context.Context, pool *pgxpool.Pool, userID, country string, promotionVersionID int64) (*ClaimPlayerOfferResult, error) {
	if promotionVersionID <= 0 {
		return nil, fmt.Errorf("bonus: invalid promotion version")
	}
	offers, err := ListAvailableOffersForPlayer(ctx, pool, userID, country)
	if err != nil {
		return nil, err
	}
	found := false
	for _, o := range offers {
		vid, ok := promotionVersionIDFromOfferMapLocal(o)
		if ok && vid == promotionVersionID {
			found = true
			break
		}
	}
	if !found {
		return nil, ErrClaimOfferNotEligible
	}

	var rulesJSON []byte
	var currency string
	var bonusType string
	var hubBoost bool
	err = pool.QueryRow(ctx, `
		SELECT pv.rules,
			'USDT',
			COALESCE(NULLIF(TRIM(pv.bonus_type), ''), ''),
			COALESCE(p.player_hub_force_visible, false)
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE pv.id = $1 AND p.status != 'archived' AND pv.published_at IS NOT NULL
		  AND COALESCE(p.grants_paused, false) = false
	`, promotionVersionID).Scan(&rulesJSON, &currency, &bonusType, &hubBoost)
	if err != nil {
		return nil, ErrClaimOfferNotEligible
	}

	rules, err := parseRules(rulesJSON)
	if err != nil {
		return nil, err
	}

	grantMinor := instantGrantMinor(rules, bonusType, hubBoost)
	if grantMinor > 0 {
		idem := fmt.Sprintf("bonus:player_claim:%s:%d", userID, promotionVersionID)
		inserted, err := GrantFromPromotionVersion(ctx, pool, GrantArgs{
			UserID:                userID,
			PromotionVersionID:   promotionVersionID,
			IdempotencyKey:        idem,
			GrantAmountMinor:      grantMinor,
			Currency:              currency,
			DepositAmountMinor:    0,
			ExemptFromPrimarySlot: false,
		})
		if err != nil {
			return nil, err
		}
		var bid string
		err = pool.QueryRow(ctx, `SELECT id::text FROM user_bonus_instances WHERE idempotency_key = $1`, idem).Scan(&bid)
		if err == nil && bid != "" {
			return &ClaimPlayerOfferResult{Mode: "granted", BonusInstanceID: bid}, nil
		}
		if inserted {
			return &ClaimPlayerOfferResult{Mode: "granted"}, nil
		}
		return nil, ErrClaimOfferBlocked
	}

	// free_spins_only (or composite FS leg) with non-deposit trigger: no up-front cash — queue provider free rounds.
	// Deposit-scoped FS must use hub intent + successful payment (EvaluatePaymentSettled), not claim.
	if r, b, g, fok := rules.freeSpinFromRules(); fok && !isDepositTrigger(rules) {
		idem := fmt.Sprintf("bonus:fs:claim:%s:%d", userID, promotionVersionID)
		ins, err2 := EnqueueFreeSpinFromPromotionVersion(ctx, pool, FreeSpinEnqueueArgs{
			UserID:             userID,
			PromotionVersionID: promotionVersionID,
			IdempotencyKey:     idem,
			Rounds:             r,
			GameID:             g,
			BetPerRoundMinor:   b,
			Source:             "claim_offer",
		})
		if err2 != nil {
			return nil, err2
		}
		if ins {
			return &ClaimPlayerOfferResult{Mode: "granted"}, nil
		}
		return nil, ErrClaimOfferBlocked
	}

	if err := UpsertPlayerDepositIntent(ctx, pool, userID, country, promotionVersionID); err != nil {
		return nil, err
	}
	return &ClaimPlayerOfferResult{Mode: "activated"}, nil
}
