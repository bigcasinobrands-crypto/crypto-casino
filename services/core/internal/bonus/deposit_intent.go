package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrDepositIntentNotEligible is returned when the version is not in the player's available-offer list.
var ErrDepositIntentNotEligible = errors.New("bonus: promotion not eligible for deposit intent")

func promotionVersionIDFromOfferMap(o map[string]any) (int64, bool) {
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
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

// MapPromotionVersionID returns promotion_version_id from a map (int64, float64/JSON, etc.).
func MapPromotionVersionID(m map[string]any) (int64, bool) {
	return promotionVersionIDFromOfferMap(m)
}

// InstanceStatusBlocksHubIntentSynthetic is true when an existing user_bonus_instances row
// for the same promotion already belongs in the "Active" hub list, so a synthetic
// "awaiting_deposit" card from player_bonus_deposit_intents is unnecessary.
// Terminal rows (forfeited, completed, etc.) must not count — a new Get bonus can leave
// only a deposit intent row, and the hub would otherwise show nothing under Active.
func InstanceStatusBlocksHubIntentSynthetic(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "pending", "pending_review", "awaiting_deposit":
		return true
	default:
		return false
	}
}

// UpsertPlayerDepositIntent records the promotion the player chose from "Get bonus" (deposit path).
// Eligibility matches GET /v1/bonuses/available.
func UpsertPlayerDepositIntent(ctx context.Context, pool *pgxpool.Pool, userID, country string, promotionVersionID int64) error {
	if promotionVersionID <= 0 {
		return fmt.Errorf("bonus: invalid promotion version")
	}
	existing, hasIntent, err := GetPlayerDepositIntentPromotionVersionID(ctx, pool, userID)
	if err != nil {
		return err
	}
	if hasIntent && existing == promotionVersionID {
		return nil
	}
	offers, err := ListAvailableOffersForPlayer(ctx, pool, userID, country)
	if err != nil {
		return err
	}
	found := false
	for _, o := range offers {
		vid, ok := promotionVersionIDFromOfferMap(o)
		if ok && vid == promotionVersionID {
			found = true
			break
		}
	}
	if !found {
		return ErrDepositIntentNotEligible
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO player_bonus_deposit_intents (user_id, promotion_version_id, updated_at)
		VALUES ($1::uuid, $2, now())
		ON CONFLICT (user_id) DO UPDATE SET
			promotion_version_id = EXCLUDED.promotion_version_id,
			updated_at = EXCLUDED.updated_at
	`, userID, promotionVersionID)
	if err != nil {
		return err
	}
	idem := fmt.Sprintf("promo.activation:deposit_intent:%s:%d", userID, promotionVersionID)
	_, _ = ledger.RecordNonBalanceEvent(ctx, pool, userID, "USDT", "promo.activation", idem, map[string]any{
		"promotion_version_id": promotionVersionID,
	})
	return nil
}

// ClearPlayerDepositIntent removes the player's chosen deposit promo (after a deposit is evaluated).
func ClearPlayerDepositIntent(ctx context.Context, pool *pgxpool.Pool, userID string) {
	if userID == "" {
		return
	}
	_, _ = pool.Exec(ctx, `DELETE FROM player_bonus_deposit_intents WHERE user_id = $1::uuid`, userID)
}

// GetPlayerDepositIntentPromotionVersionID returns the version id if the player has an intent row.
func GetPlayerDepositIntentPromotionVersionID(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, bool, error) {
	var vid int64
	err := pool.QueryRow(ctx, `
		SELECT promotion_version_id FROM player_bonus_deposit_intents WHERE user_id = $1::uuid
	`, userID).Scan(&vid)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return vid, true, nil
}
