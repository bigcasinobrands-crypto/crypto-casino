package bonus

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidatePromotionVersionForPublish ensures free-spin promotions cannot publish without a grantable package.
func ValidatePromotionVersionForPublish(ctx context.Context, pool *pgxpool.Pool, bonusType string, rulesJSON []byte) error {
	bt := strings.TrimSpace(strings.ToLower(bonusType))
	if bt != "free_spins_only" && bt != "composite_match_and_fs" {
		return nil
	}
	rounds, _, gameID, ok, err := FreeSpinSpecFromRulesJSON(rulesJSON)
	if err != nil {
		return fmt.Errorf("invalid rules: %w", err)
	}
	if !ok || rounds <= 0 || strings.TrimSpace(gameID) == "" {
		return fmt.Errorf("free spins package incomplete: need rounds ≥ 1 and a catalog game in rules")
	}
	g := strings.TrimSpace(gameID)
	var bog int32
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(bog_game_id, 0) FROM games
		WHERE id = $1 OR id_hash = $1
		LIMIT 1
	`, g).Scan(&bog)
	if errors.Is(err, pgx.ErrNoRows) || bog <= 0 {
		return fmt.Errorf("game %q must have a Blue Ocean id — sync the catalog in Provider Ops", g)
	}
	if err != nil {
		return fmt.Errorf("game lookup failed: %w", err)
	}
	return nil
}
