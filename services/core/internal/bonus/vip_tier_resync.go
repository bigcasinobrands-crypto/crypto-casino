package bonus

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EffectiveTierIDForLifetimeWager returns the vip_tiers.id for the highest tier whose minimum
// lifetime wager the player satisfies, or nil when wager is strictly below every threshold.
func EffectiveTierIDForLifetimeWager(ctx context.Context, pool *pgxpool.Pool, lifetimeWagerMinor int64) (*int, error) {
	var id int
	err := pool.QueryRow(ctx, `
		SELECT id FROM vip_tiers
		WHERE min_lifetime_wager_minor <= $1
		ORDER BY min_lifetime_wager_minor DESC, id DESC
		LIMIT 1
	`, lifetimeWagerMinor).Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func vipTierPtrEqual(a, b *int) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// SyncPlayerVIPTierToWager sets player_vip_state.tier_id from lifetime wager vs tier thresholds.
// Idempotent when already correct; used to fix drift (e.g. after raising a tier minimum) without blocking on batch resync.
func SyncPlayerVIPTierToWager(ctx context.Context, pool *pgxpool.Pool, userID string) (*int, error) {
	var stored *int
	var life int64
	err := pool.QueryRow(ctx, `
		SELECT tier_id, COALESCE(lifetime_wager_minor, 0)
		FROM player_vip_state WHERE user_id = $1::uuid
	`, userID).Scan(&stored, &life)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	want, err := EffectiveTierIDForLifetimeWager(ctx, pool, life)
	if err != nil {
		return nil, err
	}
	if vipTierPtrEqual(stored, want) {
		return want, nil
	}
	var arg any
	if want != nil {
		arg = *want
	}
	if _, err := pool.Exec(ctx, `
		UPDATE player_vip_state SET tier_id = $2, updated_at = now()
		WHERE user_id = $1::uuid
	`, userID, arg); err != nil {
		return nil, err
	}
	return want, nil
}

// ResyncAllPlayerVIPTiers recomputes tier_id from lifetime_wager_minor for every row.
// Players whose wager is below every tier's minimum get tier_id NULL (not the lowest tier).
func ResyncAllPlayerVIPTiers(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE player_vip_state AS pvs
		SET tier_id = (
			SELECT vt.id FROM vip_tiers vt
			WHERE vt.min_lifetime_wager_minor <= pvs.lifetime_wager_minor
			ORDER BY vt.min_lifetime_wager_minor DESC, vt.id DESC
			LIMIT 1
		),
		updated_at = now()
	`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
