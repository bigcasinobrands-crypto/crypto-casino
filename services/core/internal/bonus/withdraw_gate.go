package bonus

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithdrawPolicyBlock returns true when withdrawals must be blocked for cash-out policy.
func WithdrawPolicyBlock(ctx context.Context, pool *pgxpool.Pool, userID string) (blocked bool, reason string, err error) {
	var snap []byte
	err = pool.QueryRow(ctx, `
		SELECT snapshot FROM user_bonus_instances
		WHERE user_id = $1::uuid AND status = 'active' AND wr_required_minor > 0 AND wr_contributed_minor < wr_required_minor
		ORDER BY created_at ASC LIMIT 1
	`, userID).Scan(&snap)
	if err == pgx.ErrNoRows {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	var obj map[string]any
	_ = json.Unmarshal(snap, &obj)
	pol := strings.ToLower(strings.TrimSpace(strVal(obj["withdraw_policy"])))
	if pol == "block" || pol == "block_withdraw" {
		return true, "active bonus: withdrawals blocked until wagering is complete", nil
	}
	return false, "", nil
}

func strVal(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
