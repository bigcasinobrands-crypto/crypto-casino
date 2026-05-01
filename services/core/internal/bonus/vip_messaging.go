package bonus

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PreviewVIPTierAudience returns count of players currently in a tier.
func PreviewVIPTierAudience(ctx context.Context, pool *pgxpool.Pool, tierID int) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM player_vip_state WHERE tier_id = $1`, tierID).Scan(&n)
	return n, err
}

// BroadcastVIPTierMessage sends in-app notifications and emits outbound event rows for email workers.
func BroadcastVIPTierMessage(ctx context.Context, pool *pgxpool.Pool, tierID int, title, body string, dryRun bool) (sent int64, err error) {
	rows, err := pool.Query(ctx, `
		SELECT pvs.user_id::text
		FROM player_vip_state pvs
		JOIN users u ON u.id = pvs.user_id
		WHERE pvs.tier_id = $1
		  AND (u.self_excluded_until IS NULL OR u.self_excluded_until <= now())
		  AND u.account_closed_at IS NULL
	`, tierID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			continue
		}
		if dryRun {
			sent++
			continue
		}
		_ = SendPlayerNotification(ctx, pool, uid, "vip.broadcast", title, body, map[string]any{"tier_id": tierID})
		_ = EmitOutbound(ctx, pool, "VIPTierMessage", map[string]any{
			"user_id": uid, "tier_id": tierID, "title": title, "body": body,
			"channel": "email",
		})
		sent++
	}
	return sent, rows.Err()
}

func vipTierMessageTitle(tierID int) string {
	return fmt.Sprintf("VIP Tier %d update", tierID)
}
