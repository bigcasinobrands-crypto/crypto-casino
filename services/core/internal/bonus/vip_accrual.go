package bonus

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AccrueVIPFromGameDebit records VIP wager accrual idempotently from a ledger entry (game.debit).
func AccrueVIPFromGameDebit(ctx context.Context, pool *pgxpool.Pool, userID string, entryID int64, wagerMinor int64, pocket string) error {
	if wagerMinor <= 0 || pocket != "cash" {
		return nil
	}
	idem := fmt.Sprintf("vip:accrual:%d", entryID)
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var oldTierID *int
	hadVIPRow := true
	switch err := tx.QueryRow(ctx, `SELECT tier_id FROM player_vip_state WHERE user_id = $1::uuid`, userID).Scan(&oldTierID); err {
	case pgx.ErrNoRows:
		oldTierID = nil
		hadVIPRow = false
	case nil:
	default:
		return err
	}

	var dup int
	err = tx.QueryRow(ctx, `SELECT 1 FROM vip_point_ledger WHERE idempotency_key = $1`, idem).Scan(&dup)
	if err == nil {
		return tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO vip_point_ledger (user_id, delta, reason, idempotency_key)
		VALUES ($1::uuid, $2, 'game_wager', $3)
	`, userID, wagerMinor, idem)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
		VALUES ($1::uuid, NULL, $2, $2, now())
		ON CONFLICT (user_id) DO UPDATE SET
			points_balance = player_vip_state.points_balance + EXCLUDED.points_balance,
			lifetime_wager_minor = player_vip_state.lifetime_wager_minor + EXCLUDED.lifetime_wager_minor,
			last_accrual_at = now(),
			updated_at = now()
	`, userID, wagerMinor)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE player_vip_state AS pvs
		SET tier_id = (
			SELECT vt.id FROM vip_tiers vt
			WHERE vt.min_lifetime_wager_minor <= pvs.lifetime_wager_minor
			ORDER BY vt.min_lifetime_wager_minor DESC, vt.id DESC
			LIMIT 1
		),
		updated_at = now()
		WHERE pvs.user_id = $1::uuid
	`, userID)
	if err != nil {
		return err
	}

	var newTierID *int
	var lifeWager int64
	err = tx.QueryRow(ctx, `
		SELECT tier_id, lifetime_wager_minor FROM player_vip_state WHERE user_id = $1::uuid
	`, userID).Scan(&newTierID, &lifeWager)
	if err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	oldSO := -1
	if hadVIPRow && oldTierID != nil {
		if s, ok := TierSortOrder(ctx, pool, oldTierID); ok {
			oldSO = s
		}
	}
	newSO, newOk := TierSortOrder(ctx, pool, newTierID)
	if newOk && newSO > oldSO {
		// First-ever accrual that lands only on entry tier (sort 0): skip unlock noise
		if !hadVIPRow && newSO == 0 {
			return nil
		}
		ApplyVIPTierUpgrade(ctx, pool, userID, oldTierID, newTierID, lifeWager)
	}
	return nil
}

// ReverseVIPAccrualForCashRollbackTx subtracts cash rollback stake from VIP lifetime/points (idempotent).
// idempotencyKey should match the ledger rollback idempotency key (e.g. bo:game:rollback:cash:...).
func ReverseVIPAccrualForCashRollbackTx(ctx context.Context, tx pgx.Tx, userID string, cashRollbackMinor int64, idempotencyKey string) error {
	if cashRollbackMinor <= 0 || strings.TrimSpace(idempotencyKey) == "" {
		return nil
	}
	var has bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM player_vip_state WHERE user_id = $1::uuid)`, userID).Scan(&has); err != nil {
		return err
	}
	if !has {
		return nil
	}
	vipIdem := "vip:rollback:cash:" + strings.TrimSpace(idempotencyKey)
	var dup int
	switch err := tx.QueryRow(ctx, `SELECT 1 FROM vip_point_ledger WHERE idempotency_key = $1`, vipIdem).Scan(&dup); err {
	case nil:
		return nil
	case pgx.ErrNoRows:
	default:
		return err
	}
	negDelta := -cashRollbackMinor
	if _, err := tx.Exec(ctx, `
		INSERT INTO vip_point_ledger (user_id, delta, reason, idempotency_key)
		VALUES ($1::uuid, $2, 'game_wager_rollback', $3)
	`, userID, negDelta, vipIdem); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE player_vip_state
		SET
			lifetime_wager_minor = GREATEST(0, lifetime_wager_minor + $2),
			points_balance = GREATEST(0, points_balance + $2),
			last_accrual_at = now(),
			updated_at = now()
		WHERE user_id = $1::uuid
	`, userID, negDelta); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE player_vip_state AS pvs
		SET tier_id = (
			SELECT vt.id FROM vip_tiers vt
			WHERE vt.min_lifetime_wager_minor <= pvs.lifetime_wager_minor
			ORDER BY vt.min_lifetime_wager_minor DESC, vt.id DESC
			LIMIT 1
		),
		updated_at = now()
		WHERE pvs.user_id = $1::uuid
	`, userID)
	return err
}

// ProcessRecentVIPAccruals scans recent game.debit rows and accrues (worker batch).
func ProcessRecentVIPAccruals(ctx context.Context, pool *pgxpool.Pool, limit int) (int, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := pool.Query(ctx, `
		SELECT le.id, le.user_id::text, ABS(le.amount_minor), le.pocket
		FROM ledger_entries le
		WHERE le.entry_type = 'game.debit'
		  AND NOT EXISTS (
			SELECT 1 FROM vip_point_ledger v
			WHERE v.idempotency_key = 'vip:accrual:' || le.id::text
		  )
		ORDER BY le.id ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id int64
		var uid string
		var amt int64
		var pocket string
		if err := rows.Scan(&id, &uid, &amt, &pocket); err != nil {
			continue
		}
		if err := AccrueVIPFromGameDebit(ctx, pool, uid, id, amt, pocket); err != nil {
			continue
		}
		n++
	}
	return n, nil
}
