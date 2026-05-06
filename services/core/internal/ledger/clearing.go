package ledger

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// PostDepositInboundClearingTx credits the house clearing_deposit pocket — companion to player deposit.credit (PassimPay settlement rail).
func PostDepositInboundClearingTx(ctx context.Context, tx pgx.Tx, houseUserID, currency string, amountMinor int64, fundKey string, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("clearing: amount must be positive")
	}
	idem := fmt.Sprintf("deposit.clearing.inbound:%s", fundKey)
	return ApplyCreditWithPocketTx(ctx, tx, houseUserID, currency, "deposit.clearing.inbound", idem, amountMinor, PocketClearingDeposit, meta)
}

// PostWithdrawalOutboundClearingTx credits the house clearing_withdrawal_out pocket when player pending_withdrawal is released on-chain settlement.
func PostWithdrawalOutboundClearingTx(ctx context.Context, tx pgx.Tx, houseUserID, currency string, amountMinor int64, providerOrderID string, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("clearing: amount must be positive")
	}
	idem := fmt.Sprintf("withdrawal.clearing.out:%s", providerOrderID)
	return ApplyCreditWithPocketTx(ctx, tx, houseUserID, currency, "withdrawal.clearing.outbound", idem, amountMinor, PocketClearingWithdrawalOut, meta)
}
