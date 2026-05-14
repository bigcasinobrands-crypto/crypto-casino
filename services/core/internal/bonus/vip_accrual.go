package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AccrueVIPFromGameDebit records VIP lifetime/points idempotently from a ledger stake line
// (game.debit, game.bet, sportsbook.debit). Matching rollbacks are resolved via vipLedgerStakeNetTx.
// If no rollbacks exist yet, we credit **gross** stake (later game.rollback / sportsbook.rollback lines
// still trigger ReverseVIPAccrual* so VIP stays aligned with settled wallet activity). If rollbacks
// already exist before first VIP credit, we credit **net** only because ReverseVIP already ran when
// those rollback rows were written (avoids double-counting with Blue Ocean’s rollback path).
// The ledger row is re-read to verify user_id; wagerMinor/pocket from callers are cross-checked only.
//
// Audit: vip_point_ledger — positive deltas use reason `game_wager`; zero deltas use
// `stake_net_zero_after_rollbacks`, `stake_zero_amount`, or `vip_ineligible_pocket` so rows are not retried forever.
func AccrueVIPFromGameDebit(ctx context.Context, pool *pgxpool.Pool, userID string, entryID int64, wagerMinor int64, pocket string) error {
	idem := fmt.Sprintf("vip:accrual:%d", entryID)
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var dup int
	err = tx.QueryRow(ctx, `SELECT 1 FROM vip_point_ledger WHERE idempotency_key = $1`, idem).Scan(&dup)
	if err == nil {
		return tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return err
	}

	dbUser, entryType, dbPocket, gross, rolledBack, net, err := vipLedgerStakeNetTx(ctx, tx, entryID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("vip accrual: ledger entry %d not found", entryID)
		}
		return err
	}
	if err := validateStakeEntryType(entryType); err != nil {
		return err
	}
	if dbUser != userID {
		return fmt.Errorf("vip accrual: user mismatch for ledger %d (ledger user %s, caller %s)", entryID, dbUser, userID)
	}

	normPocket := ledger.NormalizePocket(dbPocket)
	switch normPocket {
	case ledger.PocketCash, ledger.PocketBonusLocked:
	default:
		if _, insErr := tx.Exec(ctx, `
			INSERT INTO vip_point_ledger (user_id, delta, reason, idempotency_key)
			VALUES ($1::uuid, 0, 'vip_ineligible_pocket', $2)
		`, dbUser, idem); insErr != nil {
			return insErr
		}
		return tx.Commit(ctx)
	}

	if wagerMinor > 0 && wagerMinor != gross {
		slog.WarnContext(ctx, "vip_accrual_gross_mismatch",
			"ledger_entry_id", entryID,
			"caller_amount_minor", wagerMinor,
			"ledger_gross_minor", gross)
	}
	if pocket != "" && ledger.NormalizePocket(pocket) != normPocket {
		slog.WarnContext(ctx, "vip_accrual_pocket_mismatch",
			"ledger_entry_id", entryID,
			"caller_pocket", pocket,
			"ledger_pocket", dbPocket)
	}

	if net <= 0 {
		reason := "stake_net_zero_after_rollbacks"
		if rolledBack == 0 && gross == 0 {
			reason = "stake_zero_amount"
		}
		if _, insErr := tx.Exec(ctx, `
			INSERT INTO vip_point_ledger (user_id, delta, reason, idempotency_key)
			VALUES ($1::uuid, 0, $2, $3)
		`, dbUser, reason, idem); insErr != nil {
			return insErr
		}
		return tx.Commit(ctx)
	}

	// If rollbacks already posted before this accrual, Blue Ocean applies ReverseVIP when each
	// rollback commits — so we credit **net** only. If no rollbacks yet, we credit **gross** and
	// later rollbacks continue to reverse VIP the same way (no double-count).
	accrueAmt := gross
	if rolledBack > 0 {
		accrueAmt = net
	}

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

	_, err = tx.Exec(ctx, `
		INSERT INTO vip_point_ledger (user_id, delta, reason, idempotency_key)
		VALUES ($1::uuid, $2, 'game_wager', $3)
	`, userID, accrueAmt, idem)
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
	`, userID, accrueAmt)
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
		if !hadVIPRow && newSO == 0 {
			return nil
		}
		ApplyVIPTierUpgrade(ctx, pool, userID, oldTierID, newTierID, lifeWager)
	}
	return nil
}

// AccrueVIPFromLedgerIdempotencyKey applies VIP lifetime/points for the ledger row with this
// idempotency key when it is a qualifying stake (game.debit, game.bet, sportsbook.debit).
// Safe to call right after the outer transaction commits; duplicates are ignored via vip_point_ledger.
func AccrueVIPFromLedgerIdempotencyKey(ctx context.Context, pool *pgxpool.Pool, idempotencyKey string) error {
	key := strings.TrimSpace(idempotencyKey)
	if key == "" {
		return nil
	}
	var entryID int64
	var uid string
	var amt int64
	var pocket string
	err := pool.QueryRow(ctx, `
		SELECT le.id, le.user_id::text, ABS(le.amount_minor), COALESCE(NULLIF(trim(both from le.pocket), ''), 'cash')
		FROM ledger_entries le
		WHERE le.idempotency_key = $1
		  AND le.entry_type IN ('game.debit', 'game.bet', 'sportsbook.debit')
	`, key).Scan(&entryID, &uid, &amt, &pocket)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return AccrueVIPFromGameDebit(ctx, pool, uid, entryID, amt, pocket)
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

// ReverseVIPAccrualForBonusRollbackTx subtracts bonus_locked rollback stake from VIP lifetime/points (idempotent).
func ReverseVIPAccrualForBonusRollbackTx(ctx context.Context, tx pgx.Tx, userID string, bonusRollbackMinor int64, idempotencyKey string) error {
	if bonusRollbackMinor <= 0 || strings.TrimSpace(idempotencyKey) == "" {
		return nil
	}
	var has bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM player_vip_state WHERE user_id = $1::uuid)`, userID).Scan(&has); err != nil {
		return err
	}
	if !has {
		return nil
	}
	vipIdem := "vip:rollback:bonus:" + strings.TrimSpace(idempotencyKey)
	var dup int
	switch err := tx.QueryRow(ctx, `SELECT 1 FROM vip_point_ledger WHERE idempotency_key = $1`, vipIdem).Scan(&dup); err {
	case nil:
		return nil
	case pgx.ErrNoRows:
	default:
		return err
	}
	negDelta := -bonusRollbackMinor
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
//
// Per-row errors are no longer silently `continue`d — VIP accrual gaps were
// previously invisible because the worker quietly skipped failing rows and
// then advanced the idempotency cursor (vip_point_ledger NOT EXISTS) past
// them on the next tick. Now we log every failure with structured context and
// record the row in worker_failed_jobs so a stuck row is observable in admin.
//
// We deliberately keep "skip and continue" behaviour for the batch — one bad
// row should not block the rest. The change is making the skip noisy so it
// can be alerted on.
func ProcessRecentVIPAccruals(ctx context.Context, pool *pgxpool.Pool, limit int) (int, error) {
	if limit <= 0 {
		limit = 500
	}
	// Accrue from casino (game.debit / game.bet) and sportsbook (sportsbook.debit)
	// stake lines. game.bet is included so any legacy or alternate provider path
	// that posts bet-only stake lines still counts toward VIP (dashboard KPIs
	// already sum game.bet stakes).
	// vip_point_ledger.idempotency_key is keyed off the ledger row id so each
	// stake line accrues exactly once regardless of product.
	rows, err := pool.Query(ctx, `
		SELECT le.id, le.user_id::text, ABS(le.amount_minor), le.pocket
		FROM ledger_entries le
		WHERE le.entry_type IN ('game.debit', 'game.bet', 'sportsbook.debit')
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
	type pending struct {
		ID     int64
		UID    string
		Amt    int64
		Pocket string
	}
	var batch []pending
	for rows.Next() {
		var p pending
		if scanErr := rows.Scan(&p.ID, &p.UID, &p.Amt, &p.Pocket); scanErr != nil {
			slog.ErrorContext(ctx, "vip_accrual_scan_failed", "err", scanErr)
			continue
		}
		batch = append(batch, p)
	}
	rows.Close()

	n := 0
	failed := 0
	for _, p := range batch {
		if accErr := AccrueVIPFromGameDebit(ctx, pool, p.UID, p.ID, p.Amt, p.Pocket); accErr != nil {
			failed++
			slog.ErrorContext(ctx, "vip_accrual_row_failed",
				"ledger_entry_id", p.ID,
				"user_id", p.UID,
				"amount_minor", p.Amt,
				"pocket", p.Pocket,
				"err", accErr)
			recordVIPAccrualFailedRow(ctx, pool, p.ID, p.UID, p.Amt, p.Pocket, accErr.Error())
			continue
		}
		n++
	}
	if failed > 0 {
		slog.WarnContext(ctx, "vip_accrual_batch_partial",
			"processed", n, "failed", failed, "scanned", len(batch))
	}
	return n, nil
}

// recordVIPAccrualFailedRow upserts a single failed-row record into
// worker_failed_jobs so ops can see exactly which ledger row failed VIP accrual
// and why. Matched rows are deduplicated by ledger_entry_id, so a row that
// keeps failing each cycle does not flood the table.
func recordVIPAccrualFailedRow(ctx context.Context, pool *pgxpool.Pool, ledgerID int64, userID string, amt int64, pocket, errText string) {
	payload, _ := json.Marshal(map[string]any{
		"ledger_entry_id": ledgerID,
		"user_id":         userID,
		"amount_minor":    amt,
		"pocket":          pocket,
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO worker_failed_jobs (job_type, payload, error_text, attempts)
		VALUES ('vip_accrual_row', $1::jsonb, $2, 1)
		ON CONFLICT DO NOTHING
	`, payload, errText); err != nil {
		slog.ErrorContext(ctx, "vip_accrual_dlq_insert_failed", "err", err, "ledger_entry_id", ledgerID)
	}
}
