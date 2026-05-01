package challenges

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrVIPNotEligible is returned when the challenge is restricted to VIP tiers the player does not meet.
var ErrVIPNotEligible = errors.New("vip tier requirement not met")

// VIPMeetsChallenge returns nil if the user may see/enter a VIP-gated challenge.
// vipOnly: from challenges.vip_only; minTierIDStr: challenges.vip_tier_minimum (tier id as string, may be empty).
func VIPMeetsChallenge(ctx context.Context, pool *pgxpool.Pool, userID string, vipOnly bool, minTierIDStr *string) error {
	if !vipOnly {
		return nil
	}
	if strings.TrimSpace(userID) == "" {
		return ErrVIPNotEligible
	}
	var playerTierID *int
	_ = pool.QueryRow(ctx, `SELECT tier_id FROM player_vip_state WHERE user_id = $1::uuid`, userID).Scan(&playerTierID)
	if playerTierID == nil {
		return ErrVIPNotEligible
	}
	mt := ""
	if minTierIDStr != nil {
		mt = strings.TrimSpace(*minTierIDStr)
	}
	if mt == "" {
		// VIP-only, no minimum tier row: any assigned tier qualifies.
		return nil
	}
	minID, err := strconv.Atoi(mt)
	if err != nil || minID <= 0 {
		return nil
	}
	var minSort int
	if err := pool.QueryRow(ctx, `SELECT sort_order FROM vip_tiers WHERE id = $1`, minID).Scan(&minSort); err != nil {
		return ErrVIPNotEligible
	}
	var pSort int
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(vt.sort_order, -1)
		FROM player_vip_state pvs
		JOIN vip_tiers vt ON vt.id = pvs.tier_id
		WHERE pvs.user_id = $1::uuid
	`, userID).Scan(&pSort)
	if err != nil || pSort < minSort {
		return ErrVIPNotEligible
	}
	return nil
}
