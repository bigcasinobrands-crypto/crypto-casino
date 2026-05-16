package raffle

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertAudit writes a row to raffle_audit_logs (best-effort metadata JSON).
func InsertAudit(ctx context.Context, pool *pgxpool.Pool, campaignID *string, staffID *string, playerID *string, action, entityType, entityID string, before, after map[string]any, reason, ip, ua string) {
	var bj, aj []byte
	if len(before) > 0 {
		bj, _ = json.Marshal(before)
	}
	if len(after) > 0 {
		aj, _ = json.Marshal(after)
	}
	var cid, sid, pid string
	if campaignID != nil {
		cid = *campaignID
	}
	if staffID != nil {
		sid = *staffID
	}
	if playerID != nil {
		pid = *playerID
	}
	_, _ = pool.Exec(ctx, `
		INSERT INTO raffle_audit_logs (campaign_id, staff_user_id, player_user_id, action, entity_type, entity_id, before_data, after_data, reason, ip_address, user_agent)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, NULLIF(trim($9), ''), NULLIF(trim($10), ''), NULLIF(trim($11), ''))
	`, cid, sid, pid, action, entityType, entityID, bj, aj, reason, ip, ua)
}
