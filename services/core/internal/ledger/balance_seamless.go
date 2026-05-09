package ledger

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const seamlessBalanceSQL = `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked')
		AND (
			upper(trim(currency)) = $2
			OR (NOT $3::bool AND (currency IS NULL OR btrim(currency) = ''))
			OR ($3::bool AND $2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)`

const seamlessCashSQL = `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash'
		AND (
			upper(trim(currency)) = $2
			OR (NOT $3::bool AND (currency IS NULL OR btrim(currency) = ''))
			OR ($3::bool AND $2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)`

const seamlessBonusLockedSQL = `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'bonus_locked'
		AND (
			upper(trim(currency)) = $2
			OR (NOT $3::bool AND (currency IS NULL OR btrim(currency) = ''))
			OR ($3::bool AND $2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
		)`

// BalancePlayableSeamless sums cash + bonus_locked for seamless-wallet settlement in walletCCY.
// multiCurrency: when false (typical single-fiat deployment), rows with NULL/blank currency match any walletCCY.
// When true, only explicit currency matches except legacy NULL/blank rows still attach to EUR only.
func BalancePlayableSeamless(ctx context.Context, pool *pgxpool.Pool, userID, walletCCY string, multiCurrency bool) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := pool.QueryRow(ctx, seamlessBalanceSQL, userID, ccy, multiCurrency).Scan(&sum)
	return sum, err
}

// BalancePlayableSeamlessTx is like BalancePlayableSeamless inside an existing transaction.
func BalancePlayableSeamlessTx(ctx context.Context, tx pgx.Tx, userID, walletCCY string, multiCurrency bool) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := tx.QueryRow(ctx, seamlessBalanceSQL, userID, ccy, multiCurrency).Scan(&sum)
	return sum, err
}

// BalanceCashSeamlessTx is cash-pocket balance for the same currency filter as BalancePlayableSeamlessTx.
func BalanceCashSeamlessTx(ctx context.Context, tx pgx.Tx, userID, walletCCY string, multiCurrency bool) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := tx.QueryRow(ctx, seamlessCashSQL, userID, ccy, multiCurrency).Scan(&sum)
	return sum, err
}

// BalanceBonusLockedSeamlessTx is bonus_locked balance for the same currency filter.
func BalanceBonusLockedSeamlessTx(ctx context.Context, tx pgx.Tx, userID, walletCCY string, multiCurrency bool) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := tx.QueryRow(ctx, seamlessBonusLockedSQL, userID, ccy, multiCurrency).Scan(&sum)
	return sum, err
}
