package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidateCoreAuthSchema ensures migrations required for player auth sessions are applied.
// Call after goose.RunMigrations so login/register never hit obscure INSERT failures.
func ValidateCoreAuthSchema(ctx context.Context, pool *pgxpool.Pool) error {
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = 'player_sessions'
			  AND column_name = 'client_ip'
		)
	`).Scan(&ok)
	if err != nil {
		return fmt.Errorf("schema check player_sessions: %w", err)
	}
	if !ok {
		return fmt.Errorf("missing column public.player_sessions.client_ip — run goose migrations through 00063_player_sessions_client_meta (npm run migrate:core)")
	}
	return nil
}
