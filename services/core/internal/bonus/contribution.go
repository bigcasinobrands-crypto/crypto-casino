package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// contributionCategoryWeightPct returns an extra 0–100 factor from the global
// `game_contribution_profiles` row named "default", keyed by the game's lobby category.
// If the profile or category key is missing, returns 100 (full contribution vs promo snapshot weight).
func contributionCategoryWeightPct(ctx context.Context, tx pgx.Tx, gameID string) (int, error) {
	cat := "other"
	g := strings.TrimSpace(gameID)
	if g != "" {
		var category *string
		err := tx.QueryRow(ctx, `
			SELECT category FROM games
			WHERE lower(trim(id)) = lower(trim($1))
			   OR (nullif(trim(id_hash), '') IS NOT NULL AND lower(trim(id_hash)) = lower(trim($1)))
			LIMIT 1
		`, g).Scan(&category)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, err
		}
		if category != nil {
			s := strings.ToLower(strings.TrimSpace(*category))
			if s != "" {
				cat = s
			}
		}
	}

	var raw []byte
	err := tx.QueryRow(ctx, `SELECT weights FROM game_contribution_profiles WHERE name = 'default' LIMIT 1`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || len(raw) == 0 {
		return 100, nil
	}
	if err != nil {
		return 0, err
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || len(m) == 0 {
		return 100, nil
	}
	if w, ok := contributionWeightFromWeightsMap(m, g, cat); ok {
		return w, nil
	}
	return 100, nil
}

// contributionWeightFromWeightsMap resolves game_contribution_profiles JSON weights:
// per_game (game id, case-insensitive) → category key (lowercase) → "default".
// Returns (pct, true) when a branch matched with a coercible value; otherwise (0, false) and callers use 100%.
func contributionWeightFromWeightsMap(m map[string]any, gameID, category string) (int, bool) {
	if len(m) == 0 {
		return 0, false
	}
	gTrim := strings.TrimSpace(gameID)
	if gTrim != "" {
		if pm, ok := m["per_game"].(map[string]any); ok && len(pm) > 0 {
			gl := strings.ToLower(gTrim)
			for k, v := range pm {
				if strings.ToLower(strings.TrimSpace(k)) == gl {
					if p := coerceContributionPct(v); p >= 0 {
						return clampPct(p), true
					}
				}
			}
		}
	}
	if v, ok := m[category]; ok {
		if p := coerceContributionPct(v); p >= 0 {
			return clampPct(p), true
		}
	}
	if v, ok := m["default"]; ok {
		if p := coerceContributionPct(v); p >= 0 {
			return clampPct(p), true
		}
	}
	return 0, false
}

func coerceContributionPct(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int32:
		return int(x)
	case int64:
		return int(x)
	case json.Number:
		i, err := x.Int64()
		if err == nil {
			return int(i)
		}
		f, err2 := x.Float64()
		if err2 == nil {
			return int(f)
		}
		return -1
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return -1
		}
		i, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return -1
		}
		return int(i)
	default:
		return -1
	}
}

func clampPct(p int) int {
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}
