package playernotify

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/emailpolicy"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/playerprefs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PlayerEmail returns the user's login email (lowercased).
func PlayerEmail(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	var em string
	err := pool.QueryRow(ctx, `SELECT lower(trim(email)) FROM users WHERE id = $1::uuid`, userID).Scan(&em)
	if err != nil {
		return "", err
	}
	em = strings.TrimSpace(em)
	if em == "" {
		return "", fmt.Errorf("empty email")
	}
	return em, nil
}

func sendAsync(sender mail.Sender, fn func(context.Context) error) {
	if sender == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := fn(ctx); err != nil {
			log.Printf("playernotify: send failed: %v", err)
		}
	}()
}

func fmtMinor(ccy string, minor int64) string {
	c := strings.ToUpper(strings.TrimSpace(ccy))
	if c == "USD" || c == "" {
		if minor%100 == 0 {
			return fmt.Sprintf("$%d.00", minor/100)
		}
		s := fmt.Sprintf("%.2f", float64(minor)/100)
		return "$" + s
	}
	return fmt.Sprintf("%d %s (minor units)", minor, c)
}

// FormatMinorAmount formats minor currency amounts for player-visible notifications (email + in-app).
func FormatMinorAmount(ccy string, minor int64) string {
	return fmtMinor(ccy, minor)
}

// walletReceiptMailAllowed gates optional PassimPay receipt templates on the player's "transaction_alerts" preference.
func walletReceiptMailAllowed(ctx context.Context, pool *pgxpool.Pool, userID string) bool {
	return playerprefs.TransactionAlertsEmailReceipts(ctx, pool, userID)
}

// WithdrawalSubmitted informs the player their payout request was recorded (includes treasury-review holds).
func WithdrawalSubmitted(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID, withdrawalID, currency string, amountMinor int64, statusLine string) {
	if pool == nil || sender == nil || cfg == nil {
		return
	}
	pol, err := emailpolicy.LoadTransactional(context.Background(), pool)
	if err != nil || !pol.WalletNotifications.WithdrawalSubmitted {
		return
	}
	if !walletReceiptMailAllowed(context.Background(), pool, userID) {
		return
	}
	sendAsync(sender, func(ctx context.Context) error {
		em, err := PlayerEmail(ctx, pool, userID)
		if err != nil {
			return err
		}
		base := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		subj := "Withdrawal request received"
		body := fmt.Sprintf(
			"We received your withdrawal request.\n\n"+
				"Withdrawal ID: %s\n"+
				"Amount: %s\n"+
				"Status: %s\n\n"+
				"You can check progress in your wallet in the player app:\n%s/casino/games?walletTab=withdraw\n",
			withdrawalID, fmtMinor(currency, amountMinor), statusLine, base,
		)
		return sender.Send(ctx, em, subj, body)
	})
}

// WithdrawalSentToProvider informs the player PassimPay accepted the payout (funds in flight).
func WithdrawalSentToProvider(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID, withdrawalID, currency string, amountMinor int64) {
	WithdrawalSubmitted(pool, sender, cfg, userID, withdrawalID, currency, amountMinor, "Submitted to payment provider — awaiting blockchain confirmation")
}

// WithdrawalCompleted informs the player the payout completed on-chain.
func WithdrawalCompleted(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID, withdrawalID, currency string, amountMinor int64) {
	if pool == nil || sender == nil || cfg == nil {
		return
	}
	pol, err := emailpolicy.LoadTransactional(context.Background(), pool)
	if err != nil || !pol.WalletNotifications.WithdrawalCompleted {
		return
	}
	if !walletReceiptMailAllowed(context.Background(), pool, userID) {
		return
	}
	sendAsync(sender, func(ctx context.Context) error {
		em, err := PlayerEmail(ctx, pool, userID)
		if err != nil {
			return err
		}
		base := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		subj := "Withdrawal completed"
		body := fmt.Sprintf(
			"Your withdrawal has completed.\n\n"+
				"Withdrawal ID: %s\n"+
				"Amount: %s\n\n"+
				"Wallet: %s/casino/games?walletTab=withdraw\n",
			withdrawalID, fmtMinor(currency, amountMinor), base,
		)
		return sender.Send(ctx, em, subj, body)
	})
}

// WithdrawalProviderFailed informs the player PassimPay reported a terminal failure (funds returned per policy).
func WithdrawalProviderFailed(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID, withdrawalID, currency string, amountMinor int64, reason string) {
	if pool == nil || sender == nil || cfg == nil {
		return
	}
	pol, err := emailpolicy.LoadTransactional(context.Background(), pool)
	if err != nil || !pol.WalletNotifications.WithdrawalProviderFailed {
		return
	}
	if !walletReceiptMailAllowed(context.Background(), pool, userID) {
		return
	}
	sendAsync(sender, func(ctx context.Context) error {
		em, err := PlayerEmail(ctx, pool, userID)
		if err != nil {
			return err
		}
		base := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		subj := "Withdrawal could not be completed"
		r := strings.TrimSpace(reason)
		if r == "" {
			r = "Payment provider reported a failure."
		}
		body := fmt.Sprintf(
			"Your withdrawal could not be completed by our payment partner.\n\n"+
				"Withdrawal ID: %s\n"+
				"Amount: %s\n"+
				"Details: %s\n\n"+
				"If funds were returned to your playable balance, you will see them in the wallet.\n"+
				"%s/casino/games?walletTab=withdraw\n",
			withdrawalID, fmtMinor(currency, amountMinor), r, base,
		)
		return sender.Send(ctx, em, subj, body)
	})
}

// WithdrawalRejected informs the player staff cancelled a pre-provider withdrawal.
func WithdrawalRejected(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID, withdrawalID, currency string, amountMinor int64, staffReason string) {
	if pool == nil || sender == nil || cfg == nil {
		return
	}
	pol, err := emailpolicy.LoadTransactional(context.Background(), pool)
	if err != nil || !pol.WalletNotifications.WithdrawalRejected {
		return
	}
	if !walletReceiptMailAllowed(context.Background(), pool, userID) {
		return
	}
	sendAsync(sender, func(ctx context.Context) error {
		em, err := PlayerEmail(ctx, pool, userID)
		if err != nil {
			return err
		}
		base := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		subj := "Withdrawal cancelled"
		r := strings.TrimSpace(staffReason)
		if r == "" {
			r = "Review the note from support in your account area."
		}
		body := fmt.Sprintf(
			"Your withdrawal was cancelled before payout.\n\n"+
				"Withdrawal ID: %s\n"+
				"Amount: %s\n"+
				"Reason: %s\n\n"+
				"Funds should return to your playable balance.\n"+
				"%s/casino/games?walletTab=withdraw\n",
			withdrawalID, fmtMinor(currency, amountMinor), r, base,
		)
		return sender.Send(ctx, em, subj, body)
	})
}

// DepositCredited informs the player an on-chain deposit credited (fires once per webhook credit batch).
func DepositCredited(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID, orderID, currency string, amountMinor int64) {
	if pool == nil || sender == nil || cfg == nil {
		return
	}
	pol, err := emailpolicy.LoadTransactional(context.Background(), pool)
	if err != nil || !pol.WalletNotifications.DepositCredited {
		return
	}
	if !walletReceiptMailAllowed(context.Background(), pool, userID) {
		return
	}
	sendAsync(sender, func(ctx context.Context) error {
		em, err := PlayerEmail(ctx, pool, userID)
		if err != nil {
			return err
		}
		base := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		subj := "Deposit received"
		body := fmt.Sprintf(
			"We credited a deposit to your account.\n\n"+
				"Reference: %s\n"+
				"Amount: %s\n\n"+
				"Wallet: %s/casino/games?walletTab=deposit\n",
			orderID, fmtMinor(currency, amountMinor), base,
		)
		return sender.Send(ctx, em, subj, body)
	})
}

// AccountRestricted informs the player when self-exclusion or account closure is applied via compliance tools.
func AccountRestricted(pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config, userID string, detailLine string) {
	if pool == nil || sender == nil || cfg == nil {
		return
	}
	pol, err := emailpolicy.LoadTransactional(context.Background(), pool)
	if err != nil || !pol.ComplianceNotifications.AccountRestricted {
		return
	}
	sendAsync(sender, func(ctx context.Context) error {
		em, err := PlayerEmail(ctx, pool, userID)
		if err != nil {
			return err
		}
		base := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		subj := "Important: account notice"
		d := strings.TrimSpace(detailLine)
		if d == "" {
			d = "Your account access has been updated in line with our policies."
		}
		body := fmt.Sprintf(
			"%s\n\n"+
				"If you believe this is a mistake, contact support through the player site.\n"+
				"%s\n",
			d, base,
		)
		return sender.Send(ctx, em, subj, body)
	})
}
