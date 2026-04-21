package bonus

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Flags mirrors payment_ops_flags bonus columns.
type Flags struct {
	BonusesEnabled         bool
	AutomatedGrantsEnabled bool
}

func LoadFlags(ctx context.Context, pool *pgxpool.Pool) (Flags, error) {
	var f Flags
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(bonuses_enabled, true), COALESCE(automated_grants_enabled, true)
		FROM payment_ops_flags WHERE id = 1
	`).Scan(&f.BonusesEnabled, &f.AutomatedGrantsEnabled)
	return f, err
}
