package wallet

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
)

func playerEmailVerified(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, error) {
	var nt sql.NullTime
	err := pool.QueryRow(ctx, `SELECT email_verified_at FROM users WHERE id = $1::uuid`, userID).Scan(&nt)
	if err != nil {
		return false, err
	}
	return nt.Valid, nil
}
