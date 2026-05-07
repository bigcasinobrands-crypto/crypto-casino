package bonus

import (
	"context"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type cashPayoutRuntime struct {
	cfg *config.Config
}

var payoutRuntime *cashPayoutRuntime

// ConfigureCashPayoutRuntime wires VIP / promotion cash credits to the ledger (no external treasury rail).
func ConfigureCashPayoutRuntime(cfg *config.Config) {
	payoutRuntime = &cashPayoutRuntime{cfg: cfg}
}

func rewardCashPayoutEnabled() bool {
	return payoutRuntime != nil && payoutRuntime.cfg != nil
}

// PayoutAndCreditCash credits playable cash on the ledger for rewards (idempotent via ledger keys).
func PayoutAndCreditCash(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID, currency, entryType, idempotencyKey string,
	amountMinor int64,
	meta map[string]any,
) (bool, error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("reward payout: amount must be positive")
	}
	if !rewardCashPayoutEnabled() {
		return false, fmt.Errorf("reward payout: runtime not configured")
	}
	ccy := strings.ToUpper(strings.TrimSpace(currency))
	if ccy == "" {
		ccy = "USDT"
	}
	ledgerKey := "reward.cash:" + idempotencyKey
	return ledger.ApplyCredit(ctx, pool, userID, ccy, entryType, ledgerKey, amountMinor, meta)
}

// PayoutAndCreditCashTx is the transactional sibling of PayoutAndCreditCash.
// It is mandatory for any reward flow that has companion bookkeeping rows
// (e.g. progress / claim tables) which must commit atomically with the cash
// credit. Callers MUST commit/rollback the tx themselves.
func PayoutAndCreditCashTx(
	ctx context.Context,
	tx pgx.Tx,
	userID, currency, entryType, idempotencyKey string,
	amountMinor int64,
	meta map[string]any,
) (bool, error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("reward payout: amount must be positive")
	}
	if !rewardCashPayoutEnabled() {
		return false, fmt.Errorf("reward payout: runtime not configured")
	}
	ccy := strings.ToUpper(strings.TrimSpace(currency))
	if ccy == "" {
		ccy = "USDT"
	}
	ledgerKey := "reward.cash:" + idempotencyKey
	return ledger.ApplyCreditTx(ctx, tx, userID, ccy, entryType, ledgerKey, amountMinor, meta)
}
