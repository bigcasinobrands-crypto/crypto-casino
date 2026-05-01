package challenges

import (
	"context"
	"strings"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/games"
	"github.com/jackc/pgx/v5/pgxpool"
)

// enrichChallengeHeroURL returns a display-ready hero URL: normalizes stored values and,
// when empty, uses the first linked game with a catalog thumbnail.
func enrichChallengeHeroURL(
	ctx context.Context,
	pool *pgxpool.Pool,
	imageBase string,
	existing *string,
	gameIDs []string,
) string {
	if existing != nil {
		if t := strings.TrimSpace(*existing); t != "" {
			return strings.TrimSpace(blueocean.NormalizeCatalogImageURL(t, imageBase))
		}
	}
	for _, gid := range gameIDs {
		gid = strings.TrimSpace(gid)
		if gid == "" || pool == nil {
			continue
		}
		var thumb string
		if err := pool.QueryRow(ctx, `SELECT COALESCE(`+games.EffectiveThumbnailSQL+`, '') FROM games WHERE id = $1`, gid).Scan(&thumb); err != nil {
			continue
		}
		if t := strings.TrimSpace(blueocean.NormalizeCatalogImageURL(thumb, imageBase)); t != "" {
			return t
		}
	}
	return ""
}

func applyChallengeHeroToMap(ctx context.Context, pool *pgxpool.Pool, imageBase string, c map[string]any) {
	if c == nil {
		return
	}
	var heroPtr *string
	if s, ok := c["hero_image_url"].(string); ok && strings.TrimSpace(s) != "" {
		t := strings.TrimSpace(s)
		heroPtr = &t
	}
	var gids []string
	if arr, ok := c["game_ids"].([]string); ok {
		gids = arr
	}
	out := enrichChallengeHeroURL(ctx, pool, imageBase, heroPtr, gids)
	if out != "" {
		c["hero_image_url"] = out
	}
}
