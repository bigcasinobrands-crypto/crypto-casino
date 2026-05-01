package bonus

import (
	"context"

	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SweepMaxBetViolationForfeits forfeits active instances whose max_bet_violations_count is at least threshold.
// threshold <= 0 disables the sweep. Processes a bounded batch per call to avoid long transactions.
func SweepMaxBetViolationForfeits(ctx context.Context, pool *pgxpool.Pool, threshold int) (int, error) {
	if pool == nil || threshold <= 0 {
		return 0, nil
	}
	const batch = 50
	rows, err := pool.Query(ctx, `
		SELECT id::text FROM user_bonus_instances
		WHERE status = 'active'
		  AND max_bet_violations_count >= $1
		ORDER BY updated_at ASC
		LIMIT $2
	`, threshold, batch)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		if err := ForfeitInstance(ctx, pool, id, "", "max_bet_violations", false); err != nil {
			continue
		}
		n++
	}
	if n > 0 {
		obs.AddBonusMaxBetViolationForfeits(uint64(n))
	}
	return n, nil
}
