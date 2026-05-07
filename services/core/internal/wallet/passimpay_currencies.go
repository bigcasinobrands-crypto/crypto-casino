package wallet

import (
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// passimpayCurrency is the subset of payment_currencies needed to validate a
// deposit/withdrawal request before it touches the provider.
type passimpayCurrency struct {
	ProviderPaymentID string
	Symbol            string
	Network           string
	MinDepositMinor   *int64
	MinWithdrawMinor  *int64
	WithdrawEnabled   bool
	DepositEnabled    bool
}

// loadPassimpayCurrency loads the row for (provider='passimpay', provider_payment_id, symbol, network).
// Returns pgx.ErrNoRows when the combination does not exist.
//
// P9: Both deposit and withdrawal flows must validate that the requested
// payment_id matches a known, enabled currency in payment_currencies. Without
// this, a malicious caller can pass any integer and the rail will happily call
// the provider — bypassing per-currency disable flags and minimums.
func loadPassimpayCurrency(ctx context.Context, pool *pgxpool.Pool, paymentID int, symbol, network string) (*passimpayCurrency, error) {
	row := pool.QueryRow(ctx, `
		SELECT provider_payment_id, symbol, COALESCE(network, ''),
			min_deposit_minor, min_withdraw_minor,
			withdraw_enabled, deposit_enabled
		FROM payment_currencies
		WHERE provider = 'passimpay'
		  AND provider_payment_id = $1
		  AND symbol = $2
		  AND COALESCE(network, '') = $3
	`, strconv.Itoa(paymentID), strings.ToUpper(strings.TrimSpace(symbol)), strings.ToUpper(strings.TrimSpace(network)))
	var c passimpayCurrency
	if err := row.Scan(
		&c.ProviderPaymentID, &c.Symbol, &c.Network,
		&c.MinDepositMinor, &c.MinWithdrawMinor,
		&c.WithdrawEnabled, &c.DepositEnabled,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, err
	}
	return &c, nil
}
