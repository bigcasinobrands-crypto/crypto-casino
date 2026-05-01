// Package privacy resolves user-facing privacy preferences (e.g. public name anonymisation).
package privacy

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const PrefAnonymisePublicName = "anonymise_public_name"

// UserWantsPublicAnonymity reads users.preferences JSON and returns true when the player
// asked to hide their public name from other customers (leaderboard, live chat, etc.).
func UserWantsPublicAnonymity(ctx context.Context, pool *pgxpool.Pool, userID string) bool {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT COALESCE(preferences, '{}'::jsonb) FROM users WHERE id = $1::uuid`, userID).Scan(&raw)
	if err != nil {
		return false
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return false
	}
	return boolFromPref(m[PrefAnonymisePublicName])
}

func boolFromPref(v any) bool {
	if v == nil {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		return s == "true" || s == "1" || s == "yes"
	default:
		return false
	}
}

// MaskMiddlePublicHandle blanks the centre of a handle so it is not easily read as a whole
// while leaving the ends visible (e.g. "driomalik" → "dr****ik"). Avatar can stay unchanged server-side.
func MaskMiddlePublicHandle(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "****"
	}
	runes := []rune(s)
	n := len(runes)
	if n <= 2 {
		return strings.Repeat("*", n)
	}
	if n == 3 {
		return string(runes[0]) + "*" + string(runes[2])
	}
	if n == 4 {
		return string(runes[0]) + "**" + string(runes[3])
	}
	// n >= 5: first two, fixed middle block, last two
	return string(runes[:2]) + "****" + string(runes[n-2:])
}
