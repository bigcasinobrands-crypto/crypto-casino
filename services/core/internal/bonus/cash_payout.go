package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/market"
	"github.com/jackc/pgx/v5/pgxpool"
)

type cashPayoutRuntime struct {
	cfg     *config.Config
	fs      *fystack.Client
	tickers *market.CryptoTickers
}

var payoutRuntime *cashPayoutRuntime

func ConfigureCashPayoutRuntime(cfg *config.Config, fs *fystack.Client, tickers *market.CryptoTickers) {
	payoutRuntime = &cashPayoutRuntime{cfg: cfg, fs: fs, tickers: tickers}
}

func rewardCashPayoutEnabled() bool {
	return payoutRuntime != nil && payoutRuntime.cfg != nil && payoutRuntime.cfg.FystackWithdrawConfigured() && payoutRuntime.fs != nil
}

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
		return false, fmt.Errorf("reward payout: treasury rail not configured")
	}
	ccy := strings.ToUpper(strings.TrimSpace(currency))
	if ccy == "" {
		ccy = "USDT"
	}

	rt := payoutRuntime

	var userWalletID string
	if err := pool.QueryRow(ctx, `SELECT provider_wallet_id FROM fystack_wallets WHERE user_id = $1::uuid`, userID).Scan(&userWalletID); err != nil || strings.TrimSpace(userWalletID) == "" {
		return false, fmt.Errorf("reward payout: player wallet unavailable")
	}

	assetID := strings.TrimSpace(rt.cfg.FystackWithdrawAssetID)
	addrResp, st, addrErr := rt.fs.GetDepositAddress(ctx, userWalletID, assetID, "evm")
	if addrErr != nil || st < 200 || st >= 300 {
		return false, fmt.Errorf("reward payout: destination lookup failed")
	}
	recipient := extractDepositAddress(addrResp)
	if recipient == "" {
		return false, fmt.Errorf("reward payout: destination address missing")
	}

	amountDecimal, convErr := rewardMinorToTokenAmount(ccy, amountMinor, rt.tickers)
	if convErr != nil {
		return false, convErr
	}

	withdrawID := "rwd_" + strings.ReplaceAll(idempotencyKey, ":", "_")
	rawInit, _ := json.Marshal(map[string]any{
		"source":      "vip_reward_payout",
		"entry_type":  entryType,
		"destination": recipient,
	})
	_, _ = pool.Exec(ctx, `
		INSERT INTO fystack_withdrawals (id, user_id, status, amount_minor, currency, destination, idempotency_key, raw, fystack_asset_id)
		VALUES ($1, $2::uuid, 'pending', $3, $4, $5, $6, $7::jsonb, NULLIF($8,''))
		ON CONFLICT (idempotency_key) DO NOTHING
	`, withdrawID, userID, amountMinor, ccy, recipient, idempotencyKey, rawInit, assetID)

	resp, wst, werr := rt.fs.RequestWithdrawal(
		ctx,
		strings.TrimSpace(rt.cfg.FystackTreasuryWalletID),
		assetID,
		amountDecimal,
		recipient,
		idempotencyKey,
	)
	if werr != nil || wst < 200 || wst >= 300 {
		_, _ = pool.Exec(ctx, `
			UPDATE fystack_withdrawals
			SET status = 'provider_error', raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb
			WHERE idempotency_key = $1
		`, idempotencyKey, mustJSONMap(map[string]any{"provider_response": resp, "provider_status": wst}))
		return false, fmt.Errorf("reward payout: provider withdrawal failed")
	}
	providerWid := withdrawalIDFromResponse(resp)
	_, _ = pool.Exec(ctx, `
		UPDATE fystack_withdrawals
		SET status = 'submitted', provider_withdrawal_id = NULLIF($2,''), raw = COALESCE(raw, '{}'::jsonb) || $3::jsonb
		WHERE idempotency_key = $1
	`, idempotencyKey, providerWid, mustJSONMap(resp))

	ledgerKey := "reward.cash:" + idempotencyKey
	return ledger.ApplyCredit(ctx, pool, userID, ccy, entryType, ledgerKey, amountMinor, meta)
}

func extractDepositAddress(resp map[string]any) string {
	if resp == nil {
		return ""
	}
	if d, ok := resp["data"].(map[string]any); ok {
		if s, ok := d["address"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
		if s, ok := d["deposit_address"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	if s, ok := resp["address"].(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	if s, ok := resp["deposit_address"].(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return ""
}

func rewardMinorToTokenAmount(symbol string, cents int64, tickers *market.CryptoTickers) (string, error) {
	usd := float64(cents) / 100.0
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	switch sym {
	case "USDT", "USDC":
		return fmt.Sprintf("%.2f", usd), nil
	default:
		if tickers == nil {
			return "", fmt.Errorf("reward payout: price feed unavailable for %s", sym)
		}
		price := tickers.PriceUSD(sym)
		if price <= 0 {
			return "", fmt.Errorf("reward payout: no price available for %s", sym)
		}
		return fmt.Sprintf("%.8f", usd/price), nil
	}
}

func mustJSONMap(v map[string]any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func withdrawalIDFromResponse(m map[string]any) string {
	if m == nil {
		return ""
	}
	if s, ok := m["id"].(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	if d, ok := m["data"].(map[string]any); ok {
		if s, ok := d["id"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
		if s, ok := d["withdrawal_id"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}
