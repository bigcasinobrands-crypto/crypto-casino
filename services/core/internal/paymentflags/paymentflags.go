package paymentflags

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Flags struct {
	DepositsEnabled        bool
	WithdrawalsEnabled     bool
	RealPlayEnabled        bool
	BonusesEnabled         bool
	AutomatedGrantsEnabled bool
}

// OperationalFallback matches operationalHandler defaults in cmd/api/main.go when Load fails.
func OperationalFallback() Flags {
	return Flags{
		DepositsEnabled:        true,
		WithdrawalsEnabled:     true,
		RealPlayEnabled:        false,
		BonusesEnabled:         true,
		AutomatedGrantsEnabled: true,
	}
}

func Load(ctx context.Context, pool *pgxpool.Pool) (Flags, error) {
	var f Flags
	q := `
		SELECT deposits_enabled, withdrawals_enabled, real_play_enabled,
		       COALESCE(bonuses_enabled, true), COALESCE(automated_grants_enabled, true)
		FROM payment_ops_flags WHERE id = 1`
	err := pool.QueryRow(ctx, q).Scan(
		&f.DepositsEnabled, &f.WithdrawalsEnabled, &f.RealPlayEnabled, &f.BonusesEnabled, &f.AutomatedGrantsEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, execErr := pool.Exec(ctx, `INSERT INTO payment_ops_flags (id) VALUES (1) ON CONFLICT (id) DO NOTHING`); execErr != nil {
			return Flags{}, err
		}
		err = pool.QueryRow(ctx, q).Scan(
			&f.DepositsEnabled, &f.WithdrawalsEnabled, &f.RealPlayEnabled, &f.BonusesEnabled, &f.AutomatedGrantsEnabled)
	}
	return f, err
}
