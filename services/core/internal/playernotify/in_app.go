package playernotify

import (
	"context"
	"strings"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/jackc/pgx/v5/pgxpool"
)

func ctxOrBg(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

// InAppDepositCredited inserts a player_notifications row (always — not gated on email prefs).
func InAppDepositCredited(ctx context.Context, pool *pgxpool.Pool, userID, orderID, currency string, amountMinor int64) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return
	}
	cc := strings.ToUpper(strings.TrimSpace(currency))
	amt := FormatMinorAmount(cc, amountMinor)
	title := "Deposit received"
	body := "We credited " + amt + " to your playable balance."
	_ = bonus.SendPlayerNotification(ctxOrBg(ctx), pool, userID, "wallet.deposit_credited", title, body, map[string]any{
		"order_id":     strings.TrimSpace(orderID),
		"currency":     cc,
		"amount_minor": amountMinor,
	})
}

// InAppWithdrawalSubmitted notifies when a withdrawal request is queued (treasury review / initial receipt).
func InAppWithdrawalSubmitted(ctx context.Context, pool *pgxpool.Pool, userID, withdrawalID, currency string, amountMinor int64, statusLine string) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return
	}
	cc := strings.ToUpper(strings.TrimSpace(currency))
	amt := FormatMinorAmount(cc, amountMinor)
	title := "Withdrawal received"
	body := "We recorded your withdrawal of " + amt + "."
	s := strings.TrimSpace(statusLine)
	if s != "" {
		body += " " + s
	}
	_ = bonus.SendPlayerNotification(ctxOrBg(ctx), pool, userID, "wallet.withdrawal_submitted", title, body, map[string]any{
		"withdrawal_id": strings.TrimSpace(withdrawalID),
		"currency":      cc,
		"amount_minor":  amountMinor,
	})
}

// InAppWithdrawalProcessing notifies when funds are sent to the payment partner (in flight).
func InAppWithdrawalProcessing(ctx context.Context, pool *pgxpool.Pool, userID, withdrawalID, currency string, amountMinor int64) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return
	}
	cc := strings.ToUpper(strings.TrimSpace(currency))
	amt := FormatMinorAmount(cc, amountMinor)
	title := "Withdrawal processing"
	body := "Your withdrawal of " + amt + " was submitted to our payment partner and is being processed."
	_ = bonus.SendPlayerNotification(ctxOrBg(ctx), pool, userID, "wallet.withdrawal_processing", title, body, map[string]any{
		"withdrawal_id": strings.TrimSpace(withdrawalID),
		"currency":      cc,
		"amount_minor":  amountMinor,
	})
}

// InAppWithdrawalCompleted notifies when an on-chain payout completed successfully.
func InAppWithdrawalCompleted(ctx context.Context, pool *pgxpool.Pool, userID, withdrawalID, currency string, amountMinor int64) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return
	}
	cc := strings.ToUpper(strings.TrimSpace(currency))
	amt := FormatMinorAmount(cc, amountMinor)
	title := "Withdrawal completed"
	body := "Your withdrawal of " + amt + " has completed."
	_ = bonus.SendPlayerNotification(ctxOrBg(ctx), pool, userID, "wallet.withdrawal_completed", title, body, map[string]any{
		"withdrawal_id": strings.TrimSpace(withdrawalID),
		"currency":      cc,
		"amount_minor":  amountMinor,
	})
}

// InAppWithdrawalFailed notifies when the provider reports a terminal payout failure (funds handled per policy).
func InAppWithdrawalFailed(ctx context.Context, pool *pgxpool.Pool, userID, withdrawalID, currency string, amountMinor int64) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return
	}
	cc := strings.ToUpper(strings.TrimSpace(currency))
	amt := FormatMinorAmount(cc, amountMinor)
	title := "Withdrawal could not complete"
	body := "Your withdrawal of " + amt + " could not be completed by our payment partner. If funds were returned, you'll see them in your wallet."
	_ = bonus.SendPlayerNotification(ctxOrBg(ctx), pool, userID, "wallet.withdrawal_failed", title, body, map[string]any{
		"withdrawal_id": strings.TrimSpace(withdrawalID),
		"currency":      cc,
		"amount_minor":  amountMinor,
	})
}

// InAppWithdrawalRejected notifies when staff cancels a withdrawal before payout.
func InAppWithdrawalRejected(ctx context.Context, pool *pgxpool.Pool, userID, withdrawalID, currency string, amountMinor int64) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return
	}
	cc := strings.ToUpper(strings.TrimSpace(currency))
	amt := FormatMinorAmount(cc, amountMinor)
	title := "Withdrawal cancelled"
	body := "Your withdrawal of " + amt + " was cancelled before payout. Funds should return to your playable balance."
	_ = bonus.SendPlayerNotification(ctxOrBg(ctx), pool, userID, "wallet.withdrawal_rejected", title, body, map[string]any{
		"withdrawal_id": strings.TrimSpace(withdrawalID),
		"currency":      cc,
		"amount_minor":  amountMinor,
	})
}
