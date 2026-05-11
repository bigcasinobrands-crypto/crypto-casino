package challenges

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResolveBlueOceanRound reads ledger lines for a Blue Ocean seamless round (remote + txn).
// Stake is the sum of absolute game.debit amounts (bonus + cash) for the round.
// Win is the game.credit line matching bo:game:credit:{remote}:{txn} or blueocean:{remote}:credit:{txn}.
func ResolveBlueOceanRound(ctx context.Context, pool *pgxpool.Pool, userID, remoteID, txnID string) (stakeMinor, winMinor int64, err error) {
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ABS(le.amount_minor)), 0)::bigint
		FROM ledger_entries le
		WHERE le.user_id = $1::uuid
		  AND le.entry_type = 'game.debit'
		  AND COALESCE(le.metadata->>'txn', '') = $3
		  AND COALESCE(le.metadata->>'remote_id', '') = $2
	`, userID, remoteID, txnID).Scan(&stakeMinor)
	if err != nil {
		return 0, 0, err
	}
	creditLegacy := fmt.Sprintf("bo:game:credit:%s:%s", remoteID, txnID)
	creditNeo := fmt.Sprintf("blueocean:%s:credit:%s", remoteID, txnID)
	creditNeoU := fmt.Sprintf("blueocean:%s:%s:credit:%s", userID, remoteID, txnID)
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(le.amount_minor, 0)::bigint
		FROM ledger_entries le
		WHERE le.user_id = $1::uuid
		  AND le.entry_type = 'game.credit'
		  AND le.idempotency_key IN ($2, $3, $4)
		LIMIT 1
	`, userID, creditLegacy, creditNeo, creditNeoU).Scan(&winMinor)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return stakeMinor, 0, nil
		}
		return stakeMinor, 0, err
	}
	return stakeMinor, winMinor, nil
}

func roundResult(winMinor int64) string {
	if winMinor > 0 {
		return "win"
	}
	return "loss"
}
