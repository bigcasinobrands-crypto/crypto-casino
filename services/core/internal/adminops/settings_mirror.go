package adminops

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func truthyJSON(value any) (bool, bool) {
	switch v := value.(type) {
	case bool:
		return v, true
	case float64:
		return v != 0, true
	case json.Number:
		i, err := v.Int64()
		if err == nil {
			return i != 0, true
		}
		f, err := v.Float64()
		if err == nil {
			return f != 0, true
		}
		return false, false
	case string:
		s := strings.TrimSpace(strings.ToLower(v))
		if s == "" {
			return false, false
		}
		return s == "true" || s == "1" || s == "yes", true
	case nil:
		return false, false
	default:
		return false, false
	}
}

// mirrorKillSwitchSetting pushes kill-switch rows written into site_settings to runtime tables
// (payment_ops_flags, chat_settings) so gameplay routes honour admin toggles.
func mirrorKillSwitchSetting(ctx context.Context, pool *pgxpool.Pool, key string, value any) error {
	key = strings.TrimSpace(key)
	b, ok := truthyJSON(value)
	if !ok {
		return nil
	}
	switch key {
	case "payments.deposits_enabled":
		_, err := pool.Exec(ctx, `UPDATE payment_ops_flags SET deposits_enabled = $1, updated_at = now() WHERE id = 1`, b)
		return err
	case "payments.withdrawals_enabled":
		_, err := pool.Exec(ctx, `UPDATE payment_ops_flags SET withdrawals_enabled = $1, updated_at = now() WHERE id = 1`, b)
		return err
	case "games.real_play_enabled":
		_, err := pool.Exec(ctx, `UPDATE payment_ops_flags SET real_play_enabled = $1, updated_at = now() WHERE id = 1`, b)
		return err
	case "bonuses.bonuses_enabled":
		_, err := pool.Exec(ctx, `UPDATE payment_ops_flags SET bonuses_enabled = $1, updated_at = now() WHERE id = 1`, b)
		return err
	case "bonuses.automated_grants_enabled":
		_, err := pool.Exec(ctx, `UPDATE payment_ops_flags SET automated_grants_enabled = $1, updated_at = now() WHERE id = 1`, b)
		return err
	case "chat.chat_enabled":
		_, err := pool.Exec(ctx, `UPDATE chat_settings SET chat_enabled = $1, updated_at = now() WHERE id = 1`, b)
		return err
	default:
		return nil
	}
}

func parseBoolSettingRaw(raw json.RawMessage) (bool, bool) {
	if len(raw) == 0 {
		return false, false
	}
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return b, true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.TrimSpace(strings.ToLower(s))
		return s == "true" || s == "1" || s == "yes", true
	}
	if n, err := strconv.ParseBool(strings.TrimSpace(string(raw))); err == nil {
		return n, true
	}
	return false, false
}
