package bonus

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// vipLedgerStakeNetTx returns the stake line's gross amount, matching rollback sum, and net
// (gross − rollbacks, floored at 0) as visible inside tx. Rollbacks are correlated the same way
// finance nets turnover in ledger.SumSuccessfulCashStakeForWindow: same user, pocket, and
// provider metadata keys (Blue Ocean remote_id + optional txn; Oddin sportsbook transaction_id
// and optional stake_transaction_id on rollbacks linking to the original debit).
//
// If a stake row has no remote_id / transaction_id correlation keys, rollback sum is treated as 0
// (cannot safely attribute rollbacks — full gross remains at risk of later ReverseVIP on rollback).
func vipLedgerStakeNetTx(ctx context.Context, tx pgx.Tx, ledgerEntryID int64) (
	dbUser string,
	entryType string,
	pocket string,
	gross int64,
	rolledBack int64,
	net int64,
	err error,
) {
	err = tx.QueryRow(ctx, `
WITH stake AS (
	SELECT user_id,
	       entry_type,
	       pocket,
	       ABS(amount_minor)::bigint AS stake,
	       COALESCE(metadata, '{}'::jsonb) AS md,
	       created_at
	FROM ledger_entries
	WHERE id = $1
),
rb AS (
	SELECT COALESCE(SUM(ABS(r.amount_minor)), 0)::bigint AS roll
	FROM ledger_entries r
	JOIN stake s ON r.user_id = s.user_id
		AND r.pocket = s.pocket
		AND r.created_at >= s.created_at
		AND (
			(s.entry_type IN ('game.debit', 'game.bet') AND r.entry_type = 'game.rollback')
			OR (s.entry_type = 'sportsbook.debit' AND r.entry_type = 'sportsbook.rollback')
		)
		AND (
			(
				NULLIF(trim(both from COALESCE(s.md->>'remote_id', '')), '') IS NOT NULL
				AND trim(both from COALESCE(r.metadata, '{}'::jsonb)->>'remote_id') = trim(both from COALESCE(s.md->>'remote_id', ''))
				AND (
					NULLIF(trim(both from COALESCE(s.md->>'txn', '')), '') IS NULL
					OR trim(both from COALESCE(r.metadata, '{}'::jsonb)->>'txn') = trim(both from COALESCE(s.md->>'txn', ''))
				)
			)
			OR (
				s.entry_type = 'sportsbook.debit'
				AND NULLIF(trim(both from COALESCE(s.md->>'transaction_id', '')), '') IS NOT NULL
				AND (
					trim(both from COALESCE(r.metadata, '{}'::jsonb)->>'transaction_id') = trim(both from COALESCE(s.md->>'transaction_id', ''))
					OR trim(both from COALESCE(r.metadata, '{}'::jsonb)->>'stake_transaction_id') = trim(both from COALESCE(s.md->>'transaction_id', ''))
				)
			)
		)
)
SELECT s.user_id::text, s.entry_type, s.pocket, s.stake, rb.roll,
       (GREATEST(0, s.stake - rb.roll))::bigint
FROM stake s CROSS JOIN rb
`, ledgerEntryID).Scan(&dbUser, &entryType, &pocket, &gross, &rolledBack, &net)
	return
}

// VIPLedgerStakeNetForEntry is a pool-scoped read helper for admin/debug (same semantics as vipLedgerStakeNetTx).
func VIPLedgerStakeNetForEntry(ctx context.Context, pool *pgxpool.Pool, ledgerEntryID int64) (dbUser, entryType, pocket string, gross, rolledBack, net int64, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", "", "", 0, 0, 0, err
	}
	defer tx.Rollback(ctx)
	dbUser, entryType, pocket, gross, rolledBack, net, err = vipLedgerStakeNetTx(ctx, tx, ledgerEntryID)
	return
}

func validateStakeEntryType(entryType string) error {
	switch entryType {
	case "game.debit", "game.bet", "sportsbook.debit":
		return nil
	default:
		return fmt.Errorf("vip accrual: ledger entry type %q is not a stake line", entryType)
	}
}
