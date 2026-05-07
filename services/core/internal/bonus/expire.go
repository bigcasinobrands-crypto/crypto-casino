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
		// ExpireInstance debits remaining bonus_locked under the canonical
		// `promo.expire` ledger entry type and flips status to 'expired'
		// inside one transaction. The previous code routed through
		// ForfeitInstance, which posted `promo.forfeit` rows that polluted
		// every "voluntary forfeit" report and made TTL expirations
		// invisible in financial analytics.
		if err := ExpireInstance(ctx, pool, id, "expired"); err != nil {
			continue
		}
		n++
	}
	return n, nil
}
