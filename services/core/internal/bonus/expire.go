package bonus

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SweepExpiredForfeits zeros bonus_locked for expired instances and marks them expired.
func SweepExpiredForfeits(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text FROM user_bonus_instances
		WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	n := 0
	for _, id := range ids {
		if err := ForfeitInstance(ctx, pool, id, "", "expired"); err != nil {
			continue
		}
		if _, err := pool.Exec(ctx, `UPDATE user_bonus_instances SET status = 'expired', updated_at = now() WHERE id = $1::uuid`, id); err != nil {
			continue
		}
		n++
	}
	return n, nil
}
