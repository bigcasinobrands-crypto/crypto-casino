package webhooks

import (
	"context"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5"
)

func boS2SCompatEnabled(cfg *config.Config) bool {
	if cfg == nil {
		return false
	}
	return cfg.BlueOceanWalletS2SCompatibility
}

// boMaxCompatDebitMinor returns the cap in minor units for S2S compatibility debits (negative startbalance / two-player).
func boMaxCompatDebitMinor(cfg *config.Config) int64 {
	maj := int64(10)
	if cfg != nil && cfg.BlueOceanWalletCompatibilityMaxDebitMajor > 0 {
		maj = cfg.BlueOceanWalletCompatibilityMaxDebitMajor
	}
	return maj * 100
}

// isBlueOceanResetDebit is true when BlueOcean clears an exact negative playable balance with a matching negative debit amount.
// Signature is verified in the HTTP handler before apply; transaction id uniqueness is enforced by boWalletTxAcquire.
func isBlueOceanResetDebit(cfg *config.Config, action string, amountMinor, currentPlayableMinor int64, txnWire string) bool {
	if !boS2SCompatEnabled(cfg) {
		return false
	}
	action = strings.ToLower(strings.TrimSpace(action))
	txnWire = strings.TrimSpace(txnWire)
	if action != "debit" || txnWire == "" || txnWire == "na" {
		return false
	}
	if amountMinor >= 0 || currentPlayableMinor >= 0 {
		return false
	}
	return amountMinor == currentPlayableMinor
}

// boOtherPlayerDebitSameTxnRound reports whether another user already has a debit row for the same transaction_id and round_id.
func boOtherPlayerDebitSameTxnRound(ctx context.Context, tx pgx.Tx, currentUserID, txnWire, roundID string) (bool, error) {
	txnWire = strings.TrimSpace(txnWire)
	if txnWire == "" || txnWire == "na" {
		return false, nil
	}
	currentUserID = strings.TrimSpace(currentUserID)
	roundNorm := strings.TrimSpace(roundID)
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM blueocean_wallet_transactions o
			WHERE o.provider = 'blueocean'
			  AND o.user_id <> $1::uuid
			  AND o.action = 'debit'
			  AND o.transaction_id = $2
			  AND COALESCE(trim(both from o.round_id), '') = $3
		)
	`, currentUserID, txnWire, roundNorm).Scan(&exists)
	return exists, err
}

// isAllowedBlueOceanCompatibilityDebit decides whether a positive debit may proceed when playable balance is below the stake.
func isAllowedBlueOceanCompatibilityDebit(ctx context.Context, tx pgx.Tx, cfg *config.Config, userID, keyRemote, txnWire, roundID string, currentPlayableMinor, amountMinor int64) (bool, error) {
	if !boS2SCompatEnabled(cfg) {
		return false, nil
	}
	if amountMinor <= 0 {
		return false, nil
	}
	maxMinor := boMaxCompatDebitMinor(cfg)
	if amountMinor > maxMinor {
		return false, nil
	}
	if currentPlayableMinor < 0 {
		return true, nil
	}
	if currentPlayableMinor == 0 {
		ok, err := boOtherPlayerDebitSameTxnRound(ctx, tx, userID, txnWire, roundID)
		if err != nil {
			return false, err
		}
		return ok, nil
	}
	return false, nil
}
