package playerauth

import (
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// sessionPersistFromPg unwraps pgx postgres errors for actionable login/register messages.
func sessionPersistFromPg(err error) string {
	var pe *pgconn.PgError
	if err == nil || !errors.As(err, &pe) || pe == nil {
		return ""
	}
	msg := strings.TrimSpace(pe.Message)
	switch pe.Code {
	case "42703": // undefined_column
		return "Postgres: missing column on player_sessions (42703). Apply migration 00063 — run `npm run migrate:core` with the same DATABASE_URL as Render, or execute services/core/scripts/supabase-player-sessions-fix.sql in Supabase SQL."
	case "42P01": // undefined_table
		return "Postgres: table not found (42P01). DATABASE_URL may point at the wrong database, or migrations never ran on this instance."
	case "42501": // insufficient_privilege
		return "Postgres: permission denied (42501). The DB user cannot INSERT into player_sessions — use the Supabase direct connection URI role (often postgres + db.*.supabase.co:5432), not a restricted pooler role."
	case "23505": // unique_violation
		return "Postgres: unique constraint violation (23505) on session insert — retry sign-in. If it persists, check deploy logs."
	case "23502": // not_null_violation (often NULL passed where NOT NULL '' expected)
		return "Postgres: NOT NULL violation (23502). Usually fixed by deploying latest Core — empty fingerprint/geo fields must insert '' not NULL."
	default:
		if msg != "" {
			return fmt.Sprintf("Postgres error %s: %s", pe.Code, msg)
		}
		return fmt.Sprintf("Postgres error %s (see deploy logs: playerauth: login session persist)", pe.Code)
	}
}
