package ledger

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BalancePlayableSeamless sums cash + bonus_locked for a single settlement currency (Blue Ocean / seamless wallet).
// Rows with NULL or blank currency are included only when walletCCY is EUR — historical migrations often omitted currency.
func BalancePlayableSeamless(ctx context.Context, pool *pgxpool.Pool, userID, walletCCY string) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked')
		AND (
			upper(trim(currency)) = $2
			OR ($2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)
	`, userID, ccy).Scan(&sum)
	return sum, err
}

// BalancePlayableSeamlessTx is like BalancePlayableSeamless inside an existing transaction.
func BalancePlayableSeamlessTx(ctx context.Context, tx pgx.Tx, userID, walletCCY string) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked')
		AND (
			upper(trim(currency)) = $2
			OR ($2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)
	`, userID, ccy).Scan(&sum)
	return sum, err
}

// BalanceCashSeamlessTx is cash-pocket balance for the same currency filter as BalancePlayableSeamlessTx.
func BalanceCashSeamlessTx(ctx context.Context, tx pgx.Tx, userID, walletCCY string) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash'
		AND (
			upper(trim(currency)) = $2
			OR ($2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)
	`, userID, ccy).Scan(&sum)
	return sum, err
}

// BalanceBonusLockedSeamlessTx is bonus_locked balance for the same currency filter.
func BalanceBonusLockedSeamlessTx(ctx context.Context, tx pgx.Tx, userID, walletCCY string) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'bonus_locked'
		AND (
			upper(trim(currency)) = $2
			OR ($2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)
	`, userID, ccy).Scan(&sum)
	return sum, err
}
