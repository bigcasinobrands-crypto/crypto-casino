package reconcile

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Game round reconciliation (E-7).
//
// We don't query BlueOcean's round API directly — that would require
// per-provider API tokens and rate-limit handling. Instead we run internal
// consistency checks against the ledger itself, since BlueOcean's bet/win/
// rollback callbacks already carry deterministic (remote_id, txn) keys we
// can use as a "round id".
//
// Three independent invariants are enforced:
//
//   1. No "orphan win": every `game.credit` (or `game.win`) in the last
//      `lookbackHours` MUST have at least one matching `game.debit` (or
//      `game.bet`) with the same `metadata->>'remote_id'`. A credit without
//      a debit is either a free spin (different idempotency_key prefix) or
//      a provider bug — both warrant an alert.
//   2. No "orphan rollback": every `game.rollback` MUST have a matching
//      `game.debit`. Same reasoning.
//   3. No "stale unsettled bet": a `game.debit` >7d old with no matching
//      credit AND no matching rollback is almost certainly stuck — most
//      casino games settle within minutes; only persistent multiplayer
//      tournaments take longer.
//
// All three emit `reconciliation_alerts` rows with kind=
// `game_round_unmatched`, `game_round_orphan_rollback`, or
// `game_round_stuck_bet` and never block the live wager flow.

// CheckGameRoundReconciliation runs all three invariants once. lookbackHours
// = 24 is a sensible default. Returns the number of new alerts inserted.
func CheckGameRoundReconciliation(ctx context.Context, pool *pgxpool.Pool, lookbackHours int) (int, error) {
	if pool == nil {
		return 0, nil
	}
	if lookbackHours <= 0 {
		lookbackHours = 24
	}
	since := time.Now().UTC().Add(-time.Duration(lookbackHours) * time.Hour)
	staleSince := time.Now().UTC().Add(-7 * 24 * time.Hour)

	totalAlerts := 0

	// 1. Orphan wins: game.credit/game.win with no matching game.debit/game.bet
	//    on the same remote_id. Free-spin credits use idempotency keys that
	//    don't start with `bo:game:credit:` so we exclude those.
	orphanWinRows, err := pool.Query(ctx, `
		WITH wins AS (
			SELECT id, user_id, amount_minor, currency,
			       COALESCE(metadata->>'remote_id','') AS remote_id,
			       COALESCE(metadata->>'txn','') AS txn,
			       idempotency_key, created_at
			FROM ledger_entries
			WHERE entry_type IN ('game.credit','game.win')
			  AND amount_minor > 0
			  AND created_at >= $1
			  AND (idempotency_key LIKE 'bo:game:credit:%' OR idempotency_key LIKE 'blueocean:%:credit:%')
		)
		SELECT w.id::text, w.user_id::text, w.amount_minor, w.currency,
		       w.remote_id, w.txn, w.idempotency_key
		FROM wins w
		WHERE NOT EXISTS (
			SELECT 1 FROM ledger_entries d
			WHERE d.entry_type IN ('game.debit','game.bet')
			  AND d.amount_minor < 0
			  AND d.user_id = w.user_id
			  AND COALESCE(d.metadata->>'remote_id','') = w.remote_id
			  AND w.remote_id <> ''
		)
		LIMIT 500
	`, since)
	if err != nil {
		return 0, err
	}
	for orphanWinRows.Next() {
		var leID, userID, currency, remoteID, txn, idem string
		var amount int64
		if err := orphanWinRows.Scan(&leID, &userID, &amount, &currency, &remoteID, &txn, &idem); err != nil {
			continue
		}
		details := map[string]any{
			"ledger_entry_id":  leID,
			"amount_minor":     amount,
			"currency":         currency,
			"remote_id":        remoteID,
			"txn":              txn,
			"idempotency_key":  idem,
		}
		if insertReconAlert(ctx, pool, "game_round_unmatched", userID, "ledger_entry", leID, details) {
			totalAlerts++
		}
	}
	orphanWinRows.Close()

	// 2. Orphan rollbacks: game.rollback with no matching game.debit on the
	//    same remote_id.
	rbRows, err := pool.Query(ctx, `
		WITH rbs AS (
			SELECT id, user_id, amount_minor, currency,
			       COALESCE(metadata->>'remote_id','') AS remote_id,
			       COALESCE(metadata->>'txn','') AS txn,
			       idempotency_key
			FROM ledger_entries
			WHERE entry_type = 'game.rollback'
			  AND created_at >= $1
		)
		SELECT r.id::text, r.user_id::text, r.amount_minor, r.currency,
		       r.remote_id, r.txn, r.idempotency_key
		FROM rbs r
		WHERE NOT EXISTS (
			SELECT 1 FROM ledger_entries d
			WHERE d.entry_type IN ('game.debit','game.bet')
			  AND d.user_id = r.user_id
			  AND COALESCE(d.metadata->>'remote_id','') = r.remote_id
			  AND r.remote_id <> ''
		)
		LIMIT 500
	`, since)
	if err != nil {
		return totalAlerts, err
	}
	for rbRows.Next() {
		var leID, userID, currency, remoteID, txn, idem string
		var amount int64
		if err := rbRows.Scan(&leID, &userID, &amount, &currency, &remoteID, &txn, &idem); err != nil {
			continue
		}
		details := map[string]any{
			"ledger_entry_id": leID,
			"amount_minor":    amount,
			"currency":        currency,
			"remote_id":       remoteID,
			"txn":             txn,
			"idempotency_key": idem,
		}
		if insertReconAlert(ctx, pool, "game_round_orphan_rollback", userID, "ledger_entry", leID, details) {
			totalAlerts++
		}
	}
	rbRows.Close()

	// 3. Stuck bets: game.debit older than 7d with no matching credit OR
	//    rollback. Limit to BlueOcean callbacks (idempotency_key prefix) to
	//    avoid flagging bonus debits / VIP-fee debits as "stuck rounds".
	stuckRows, err := pool.Query(ctx, `
		WITH bets AS (
			SELECT id, user_id, amount_minor, currency,
			       COALESCE(metadata->>'remote_id','') AS remote_id,
			       COALESCE(metadata->>'txn','') AS txn,
			       idempotency_key, created_at
			FROM ledger_entries
			WHERE entry_type IN ('game.debit','game.bet')
			  AND amount_minor < 0
			  AND created_at < $1
			  AND (idempotency_key LIKE 'bo:game:debit:%' OR idempotency_key LIKE 'blueocean:%:debit:%')
		)
		SELECT b.id::text, b.user_id::text, b.amount_minor, b.currency,
		       b.remote_id, b.txn, b.idempotency_key, b.created_at
		FROM bets b
		WHERE NOT EXISTS (
			SELECT 1 FROM ledger_entries x
			WHERE x.entry_type IN ('game.credit','game.win','game.rollback')
			  AND x.user_id = b.user_id
			  AND COALESCE(x.metadata->>'remote_id','') = b.remote_id
			  AND b.remote_id <> ''
		)
		LIMIT 500
	`, staleSince)
	if err != nil {
		return totalAlerts, err
	}
	for stuckRows.Next() {
		var leID, userID, currency, remoteID, txn, idem string
		var amount int64
		var createdAt time.Time
		if err := stuckRows.Scan(&leID, &userID, &amount, &currency, &remoteID, &txn, &idem, &createdAt); err != nil {
			continue
		}
		details := map[string]any{
			"ledger_entry_id": leID,
			"amount_minor":    amount,
			"currency":        currency,
			"remote_id":       remoteID,
			"txn":             txn,
			"idempotency_key": idem,
			"created_at":      createdAt.UTC().Format(time.RFC3339),
			"age_hours":       time.Since(createdAt).Hours(),
		}
		if insertReconAlert(ctx, pool, "game_round_stuck_bet", userID, "ledger_entry", leID, details) {
			totalAlerts++
		}
	}
	stuckRows.Close()

	return totalAlerts, nil
}

// insertReconAlert is intentionally idempotent on (kind, reference_type,
// reference_id) by returning false if a recent alert (last 7d) already
// exists for the same triple, so the worker re-running every hour does not
// flood the inbox.
func insertReconAlert(ctx context.Context, pool *pgxpool.Pool, kind, userID, refType, refID string, details map[string]any) bool {
	body, _ := json.Marshal(details)
	var dup bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM reconciliation_alerts
			WHERE kind = $1 AND reference_type = $2 AND reference_id = $3
			  AND created_at >= now() - INTERVAL '7 days'
		)
	`, kind, refType, refID).Scan(&dup); err == nil && dup {
		return false
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
	`, kind, userID, refType, refID, body); err != nil {
		slog.ErrorContext(ctx, "round_recon_alert_insert_failed",
			"kind", kind, "ref_id", refID, "err", err)
		return false
	}
	return true
}
