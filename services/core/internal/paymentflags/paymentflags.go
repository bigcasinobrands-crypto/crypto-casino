package paymentflags

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Flags struct {
	DepositsEnabled   bool
	WithdrawalsEnabled bool
	RealPlayEnabled    bool
}

func Load(ctx context.Context, pool *pgxpool.Pool) (Flags, error) {
	var f Flags
	err := pool.QueryRow(ctx, `
		SELECT deposits_enabled, withdrawals_enabled, real_play_enabled
		FROM payment_ops_flags WHERE id = 1
	`).Scan(&f.DepositsEnabled, &f.WithdrawalsEnabled, &f.RealPlayEnabled)
	return f, err
}
