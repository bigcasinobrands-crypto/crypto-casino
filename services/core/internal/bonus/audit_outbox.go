package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type bonusAuditActor string

const (
	bonusAuditActorSystem bonusAuditActor = "system"
	bonusAuditActorPlayer bonusAuditActor = "player"
	bonusAuditActorAdmin  bonusAuditActor = "admin"
)

type bonusDB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// insertBonusAuditLog writes one append-only audit row (must run inside the same transaction as the state change when possible).
func insertBonusAuditLog(ctx context.Context, q bonusDB, eventType string, actor bonusAuditActor, actorID, userID, bonusInstanceID string, promotionVersionID int64, amountDelta int64, currency string, meta map[string]any) error {
	var metaJSON []byte
	var err error
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return err
		}
	} else {
		metaJSON = []byte("{}")
	}
	var actorArg any
	if strings.TrimSpace(actorID) != "" {
		actorArg = strings.TrimSpace(actorID)
	} else {
		actorArg = nil
	}
	var instArg any
	if strings.TrimSpace(bonusInstanceID) != "" {
		instArg = strings.TrimSpace(bonusInstanceID)
	} else {
		instArg = nil
	}
	var pvid any
	if promotionVersionID > 0 {
		pvid = promotionVersionID
	} else {
		pvid = nil
	}
	_, err = q.Exec(ctx, `
		INSERT INTO bonus_audit_log (
			event_type, actor_type, actor_id, user_id, bonus_instance_id, promotion_version_id,
			amount_delta_minor, currency, metadata
		) VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7, $8, COALESCE($9::jsonb, '{}'::jsonb))
	`, eventType, string(actor), actorArg, userID, instArg, pvid, amountDelta, strings.TrimSpace(currency), metaJSON)
	return err
}

func insertBonusOutbox(ctx context.Context, q bonusDB, eventType string, payload map[string]any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO bonus_outbox (event_type, payload) VALUES ($1, $2::jsonb)`, eventType, b)
	return err
}

func forfeitAuditActor(actorStaffID, reason string) (bonusAuditActor, string) {
	if strings.TrimSpace(actorStaffID) != "" {
		return bonusAuditActorAdmin, strings.TrimSpace(actorStaffID)
	}
	r := strings.TrimSpace(reason)
	if r == "expired" || r == "max_bet_violations" {
		return bonusAuditActorSystem, ""
	}
	return bonusAuditActorPlayer, ""
}

const outboxPayloadVersion = 1

// BonusOutboxMaxAttempts is the delivery attempt cap before a row is moved to DLQ (dlq_at set, no longer retried).
const BonusOutboxMaxAttempts = 25

func outboxPayloadGrant(userID string, promotionVersionID int64, bonusInstanceID, currency, idem string, grantMinor int64) map[string]any {
	return map[string]any{
		"v": outboxPayloadVersion, "user_id": userID, "promotion_version_id": promotionVersionID,
		"bonus_instance_id": bonusInstanceID, "grant_amount_minor": grantMinor, "currency": currency,
		"idempotency_key": idem,
	}
}

func outboxPayloadForfeit(userID, bonusInstanceID, reason, currency string, grantedMinor int64) map[string]any {
	return map[string]any{
		"v": outboxPayloadVersion, "user_id": userID, "bonus_instance_id": bonusInstanceID,
		"reason": reason, "granted_amount_minor": grantedMinor, "currency": currency,
	}
}

// ProcessBonusOutbox delivers pending rows (BonusGranted → outbound + notification; BonusForfeited → outbound only).
// Rows are locked with FOR UPDATE SKIP LOCKED for the duration of delivery attempts.
func ProcessBonusOutbox(ctx context.Context, pool *pgxpool.Pool, limit int) (n int, err error) {
	if pool == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = 50
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, event_type, payload, attempts
		FROM bonus_outbox
		WHERE processed_at IS NULL AND dlq_at IS NULL
		ORDER BY id
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return 0, err
	}
	type row struct {
		id        int64
		eventType string
		payload   []byte
		attempts  int32
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.eventType, &r.payload, &r.attempts); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, r := range batch {
		deliverErr := deliverBonusOutboxRow(ctx, pool, r.eventType, r.payload)
		if deliverErr != nil {
			msg := deliverErr.Error()
			if len(msg) > 500 {
				msg = msg[:500]
			}
			obs.IncBonusOutboxDeliveryAttemptFailed()
			nextAttempts := int(r.attempts) + 1
			if nextAttempts >= BonusOutboxMaxAttempts {
				obs.IncBonusOutboxDLQ()
			}
			if _, err := tx.Exec(ctx, `
				UPDATE bonus_outbox SET
					attempts = attempts + 1,
					last_error = $2,
					dlq_at = CASE WHEN bonus_outbox.attempts + 1 >= $3 THEN COALESCE(bonus_outbox.dlq_at, now()) ELSE bonus_outbox.dlq_at END
				WHERE id = $1
			`, r.id, msg, BonusOutboxMaxAttempts); err != nil {
				return n, err
			}
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE bonus_outbox SET processed_at = now(), last_error = NULL WHERE id = $1`, r.id); err != nil {
			return n, err
		}
		obs.IncBonusOutboxDelivered()
		n++
	}
	if err := tx.Commit(ctx); err != nil {
		return n, err
	}
	return n, nil
}

func deliverBonusOutboxRow(ctx context.Context, pool *pgxpool.Pool, eventType string, payload []byte) error {
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return fmt.Errorf("outbox payload: %w", err)
	}
	switch eventType {
	case "BonusGranted":
		userID, _ := m["user_id"].(string)
		if userID == "" {
			return fmt.Errorf("outbox: missing user_id")
		}
		pvid, _ := toInt64(m["promotion_version_id"])
		instID, _ := m["bonus_instance_id"].(string)
		grantMinor, _ := toInt64(m["grant_amount_minor"])
		ccy, _ := m["currency"].(string)
		idem, _ := m["idempotency_key"].(string)
		if err := EmitOutbound(ctx, pool, "BonusGranted", map[string]any{
			"user_id": userID, "promotion_version_id": pvid,
			"bonus_instance_id": instID, "grant_amount_minor": grantMinor, "currency": ccy,
			"idempotency_key": idem,
		}); err != nil {
			return err
		}
		return insertNotification(ctx, pool, userID, "bonus_granted", "Bonus credited",
			fmt.Sprintf("You received a bonus of %d minor units.", grantMinor),
			map[string]any{"bonus_instance_id": instID, "promotion_version_id": pvid})
	case "BonusForfeited":
		userID, _ := m["user_id"].(string)
		instID, _ := m["bonus_instance_id"].(string)
		reason, _ := m["reason"].(string)
		granted, _ := toInt64(m["granted_amount_minor"])
		ccy, _ := m["currency"].(string)
		return EmitOutbound(ctx, pool, "BonusForfeited", map[string]any{
			"user_id": userID, "bonus_instance_id": instID, "reason": reason,
			"granted_amount_minor": granted, "currency": ccy,
		})
	default:
		return fmt.Errorf("outbox: unknown event_type %q", eventType)
	}
}

func toInt64(v any) (int64, bool) {
	switch x := v.(type) {
	case float64:
		return int64(x), true
	case int64:
		return x, true
	case int:
		return int64(x), true
	case json.Number:
		i, err := x.Int64()
		return i, err == nil
	default:
		return 0, false
	}
}
