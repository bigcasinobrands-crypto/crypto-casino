package paymentflags

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Flags struct {
	DepositsEnabled          bool
	WithdrawalsEnabled       bool
	RealPlayEnabled          bool
	BonusesEnabled           bool
	AutomatedGrantsEnabled   bool
}

func Load(ctx context.Context, pool *pgxpool.Pool) (Flags, error) {
	var f Flags
	err := pool.QueryRow(ctx, `
		SELECT deposits_enabled, withdrawals_enabled, real_play_enabled,
		       COALESCE(bonuses_enabled, true), COALESCE(automated_grants_enabled, true)
		FROM payment_ops_flags WHERE id = 1
	`).Scan(&f.DepositsEnabled, &f.WithdrawalsEnabled, &f.RealPlayEnabled, &f.BonusesEnabled, &f.AutomatedGrantsEnabled)
	return f, err
}
