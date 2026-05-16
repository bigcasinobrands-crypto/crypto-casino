package bonus

import (
	"database/sql"
	"encoding/json"
	"time"
)

// MergePlayerDetailsSchedule adds promotion version schedule fields (from DB join) into the player details map.
func MergePlayerDetailsSchedule(d map[string]any, publishedAt, validFrom, validTo sql.NullTime) {
	if d == nil {
		return
	}
	if publishedAt.Valid {
		d["promotion_published_at"] = publishedAt.Time.UTC().Format(time.RFC3339)
	}
	if validFrom.Valid {
		d["promotion_valid_from"] = validFrom.Time.UTC().Format(time.RFC3339)
	}
	if validTo.Valid {
		d["promotion_valid_to"] = validTo.Time.UTC().Format(time.RFC3339)
	}
}

// PlayerSnapshotDetails returns a player-safe subset of the grant snapshot for UI (no full rules blob).
func PlayerSnapshotDetails(snapshot []byte) map[string]any {
	out := map[string]any{}
	if len(snapshot) == 0 {
		return out
	}
	var obj map[string]any
	if json.Unmarshal(snapshot, &obj) != nil {
		return out
	}
	for _, k := range []string{
		"excluded_game_ids", "allowed_game_ids", "max_bet_minor", "game_weight_pct",
		"withdraw_policy", "deposit_minor", "grant_minor",
		"challenge_title", "challenge_id", "challenge_entry_id", "source",
	} {
		if v, ok := obj[k]; ok {
			out[k] = v
		}
	}
	rulesRaw, ok := obj["rules"]
	if !ok || rulesRaw == nil {
		return out
	}
	var rulesObj map[string]any
	switch r := rulesRaw.(type) {
	case map[string]any:
		rulesObj = r
	case string:
		if json.Unmarshal([]byte(r), &rulesObj) != nil {
			return out
		}
	default:
		b, err := json.Marshal(rulesRaw)
		if err != nil || json.Unmarshal(b, &rulesObj) != nil {
			return out
		}
	}
	if w, ok := rulesObj["wagering"].(map[string]any); ok {
		if m, ok := w["multiplier"]; ok {
			switch x := m.(type) {
			case float64:
				if x > 0 {
					out["wagering_multiplier"] = int(x)
				}
			case int:
				if x > 0 {
					out["wagering_multiplier"] = x
				}
			case int64:
				if x > 0 {
					out["wagering_multiplier"] = int(x)
				}
			}
		}
	}
	return out
}
