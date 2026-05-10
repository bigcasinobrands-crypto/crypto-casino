package playerprefs

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PrefTransactionAlerts is stored in users.preferences (player UI "Transaction Alerts").
const PrefTransactionAlerts = "transaction_alerts"

// TransactionAlertsEmailReceipts reports whether the player wants optional deposit/withdrawal receipt emails.
// Missing preference defaults to true (matches player UI default).
// This must not gate verification, password reset, or compliance notices — only wallet receipt templates.
func TransactionAlertsEmailReceipts(ctx context.Context, pool *pgxpool.Pool, userID string) bool {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return true
	}
	var prefs map[string]any
	err := pool.QueryRow(ctx, `SELECT COALESCE(preferences, '{}') FROM users WHERE id = $1::uuid`, userID).Scan(&prefs)
	if err != nil || prefs == nil {
		return true
	}
	v, ok := prefs[PrefTransactionAlerts]
	if !ok {
		return true
	}
	return prefTruthy(v)
}

func prefTruthy(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		return s == "true" || s == "1" || s == "yes"
	case float64:
		return x != 0
	case int:
		return x != 0
	case int64:
		return x != 0
	default:
		return false
	}
}
