package ledger

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Provider fees (E-6).
//
// Payment-rail fees (PassimPay) and game-provider fees (BlueOcean / Oddin)
// are real costs to the house. To compute true NGR (= GGR − bonus cost −
// provider fees) we need each fee posting to land in the central ledger so
// analytics can deduct them in one place. We model fees as a debit on the
// configured house user using entry_type='provider.fee', pocket='cash'.
//
// Fees come from two places today:
//
//   1. Per-transaction fee fields on payment-rail webhooks (e.g. PassimPay
//      includes a commission field on inbound deposits). These are recorded
//      synchronously inside the same DB transaction as the deposit credit so
//      a fee can never exist without its parent deposit.
//   2. Periodic operator-posted invoices (e.g. BlueOcean monthly RTP-tax,
//      Oddin platform fee). These come in via an admin endpoint that calls
//      RecordProviderFee directly with an idempotency key derived from the
//      invoice id.
//
// The function is idempotent — if the same idempotency key is already used,
// no row is inserted and `inserted=false` is returned. This makes the helper
// safe to call from retry loops.

// RecordProviderFee posts a debit (negative amount) to the house user's cash
// pocket for the given fee. amountMinor MUST be positive (it represents the
// fee owed to the provider). currency is the symbol whose deposit/wager
// generated the fee. providerKey is a short identifier ('passimpay',
// 'blueocean', 'oddin'). meta is merged into the ledger row's JSON metadata
// for downstream auditing.
func RecordProviderFee(ctx context.Context, pool *pgxpool.Pool, houseUserID, currency, providerKey, idempotencyKey string, amountMinor int64, meta map[string]any) (bool, error) {
	if pool == nil || amountMinor <= 0 {
		return false, nil
	}
	if meta == nil {
		meta = map[string]any{}
	}
	meta["provider"] = strings.ToLower(strings.TrimSpace(providerKey))
	return ApplyCreditWithPocket(ctx, pool, houseUserID, strings.ToUpper(currency),
		EntryTypeProviderFee, idempotencyKey, -amountMinor, PocketCash, meta)
}

// RecordProviderFeeTx is the transactional variant of RecordProviderFee.
// Use it when the fee posting must commit atomically with another ledger
// write (e.g. recording the deposit credit and the deposit fee in one
// transaction so the fee cannot exist without the deposit).
func RecordProviderFeeTx(ctx context.Context, tx pgx.Tx, houseUserID, currency, providerKey, idempotencyKey string, amountMinor int64, meta map[string]any) (bool, error) {
	if tx == nil || amountMinor <= 0 {
		return false, nil
	}
	if meta == nil {
		meta = map[string]any{}
	}
	meta["provider"] = strings.ToLower(strings.TrimSpace(providerKey))
	return ApplyCreditWithPocketTx(ctx, tx, houseUserID, strings.ToUpper(currency),
		EntryTypeProviderFee, idempotencyKey, -amountMinor, PocketCash, meta)
}
