package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TopUpActiveInstanceArgs credits additional funds into an existing active bonus instance
// (bonus_locked ledger) and extends wagering by the incremental WR implied by the promo rules.
type TopUpActiveInstanceArgs struct {
	UserID         string
	InstanceID     string
	AddAmountMinor int64
	IdempotencyKey string
	ActorStaffID   string
}

func rulesJSONFromInstanceSnapshot(snap []byte) ([]byte, error) {
	if len(snap) == 0 || string(snap) == "null" {
		return nil, fmt.Errorf("bonus: empty instance snapshot")
	}
	var m map[string]any
	if err := json.Unmarshal(snap, &m); err != nil {
		return nil, fmt.Errorf("bonus: snapshot: %w", err)
	}
	rv, ok := m["rules"]
	if !ok || rv == nil {
		return nil, fmt.Errorf("bonus: snapshot missing rules")
	}
	return json.Marshal(rv)
}

func bumpSnapshotGrantMinor(snap []byte, add int64) ([]byte, error) {
	if add <= 0 {
		return nil, fmt.Errorf("bonus: top-up amount must be positive")
	}
	var m map[string]any
	if len(snap) == 0 || string(snap) == "null" {
		return nil, fmt.Errorf("bonus: empty snapshot")
	}
	if err := json.Unmarshal(snap, &m); err != nil {
		return nil, err
	}
	var cur int64
	switch v := m["grant_minor"].(type) {
	case float64:
		cur = int64(v)
	case int:
		cur = int64(v)
	case int64:
		cur = v
	case json.Number:
		x, err := v.Int64()
		if err != nil {
			return nil, fmt.Errorf("bonus: grant_minor in snapshot")
		}
		cur = x
	default:
		cur = 0
	}
	m["grant_minor"] = cur + add
	return json.Marshal(m)
}

// TopUpActiveInstance applies a play-only bonus_locked credit to an already-active instance.
// Idempotency is enforced via the ledger line key (promo.grant_topup:…).
func TopUpActiveInstance(ctx context.Context, pool *pgxpool.Pool, a TopUpActiveInstanceArgs) (inserted bool, err error) {
	if a.AddAmountMinor <= 0 {
		return false, fmt.Errorf("bonus: top-up amount must be positive")
	}
	uid := strings.TrimSpace(a.UserID)
	instID := strings.TrimSpace(a.InstanceID)
	if uid == "" || instID == "" {
		return false, fmt.Errorf("bonus: user_id and instance_id required")
	}
	idem := strings.TrimSpace(a.IdempotencyKey)
	if idem == "" {
		return false, fmt.Errorf("bonus: idempotency key required")
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return false, err
	}
	if !bf.BonusesEnabled {
		return false, ErrBonusesDisabled
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, uid); err != nil {
		return false, err
	}

	var owner, ccy, status string
	var granted, wrReq int64
	var snap []byte
	var pvid int64
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, currency, status, granted_amount_minor, wr_required_minor,
		       snapshot, promotion_version_id
		FROM user_bonus_instances WHERE id = $1::uuid FOR UPDATE
	`, instID).Scan(&owner, &ccy, &status, &granted, &wrReq, &snap, &pvid)
	if err != nil {
		return false, err
	}
	if owner != uid {
		return false, ErrBonusInstanceForbidden
	}
	if status != "active" {
		return false, fmt.Errorf("bonus: instance must be active for top-up (status=%s)", status)
	}

	rulesRaw, err := rulesJSONFromInstanceSnapshot(snap)
	if err != nil {
		return false, err
	}
	rules, err := parseRules(rulesRaw)
	if err != nil {
		return false, err
	}
	deltaWR := rules.wrRequired(a.AddAmountMinor)

	newSnap, err := bumpSnapshotGrantMinor(snap, a.AddAmountMinor)
	if err != nil {
		return false, err
	}

	meta := map[string]any{
		"promotion_version_id": pvid,
		"bonus_instance_id":    instID,
		"top_up":               true,
	}
	if err := fingerprint.MergeTrafficAttributionTx(ctx, tx, uid, time.Now().UTC(), meta); err != nil {
		return false, err
	}

	ledgerIdem := "promo.grant_topup:" + idem
	ins, err := ledger.ApplyCreditTxWithPocket(ctx, tx, uid, ccy, ledger.EntryTypePromoGrantTopUp,
		ledgerIdem, a.AddAmountMinor, ledger.PocketBonusLocked, meta)
	if err != nil {
		return false, err
	}
	if !ins {
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, nil
	}

	newGranted := granted + a.AddAmountMinor
	newWR := wrReq + deltaWR
	if _, err := tx.Exec(ctx, `
		UPDATE user_bonus_instances
		SET granted_amount_minor = $2, wr_required_minor = $3, snapshot = $4::jsonb, updated_at = now()
		WHERE id = $1::uuid
	`, instID, newGranted, newWR, newSnap); err != nil {
		return false, err
	}

	grantActor := bonusAuditActorAdmin
	grantActorID := strings.TrimSpace(a.ActorStaffID)
	if grantActorID == "" {
		grantActor = bonusAuditActorSystem
	}
	if err := insertBonusAuditLog(ctx, tx, "bonus_topped_up", grantActor, grantActorID, uid, instID, pvid, a.AddAmountMinor, ccy,
		map[string]any{"idempotency_key": idem, "wr_delta_minor": deltaWR}); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
