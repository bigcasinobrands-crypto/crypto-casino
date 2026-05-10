package compliance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SiteSettingWithdrawKYCPolicy is the site_settings key for withdrawal identity-risk knobs.
const SiteSettingWithdrawKYCPolicy = "withdraw_kyc_policy"

// WithdrawKYCRiskPolicy controls when withdrawals require approved identity (kyc_status=approved)
// beyond the env-driven large-withdrawal threshold.
type WithdrawKYCRiskPolicy struct {
	RiskRulesEnabled bool `json:"risk_rules_enabled"`
	// First withdrawal within this many hours after signup with amount >= FirstWithdrawRiskAmountMinCents triggers KYC.
	FirstWithdrawRiskWithinHours int `json:"first_withdraw_risk_within_hours"`
	FirstWithdrawRiskAmountMinCents int64 `json:"first_withdraw_risk_amount_min_cents"`
	// CountPassimpayWithdrawals24h >= threshold triggers KYC (rolling 24h).
	DailyWithdrawCountThreshold int `json:"daily_withdraw_count_threshold"`
	// SumPassimpayWithdrawals24h + current amount >= trigger requires KYC.
	DailyWithdrawTotalTriggerCents int64 `json:"daily_withdraw_total_trigger_cents"`
}

func defaultWithdrawKYCRiskPolicy() WithdrawKYCRiskPolicy {
	return WithdrawKYCRiskPolicy{
		RiskRulesEnabled:                true,
		FirstWithdrawRiskWithinHours:    72,
		FirstWithdrawRiskAmountMinCents: 25_000,
		DailyWithdrawCountThreshold:     5,
		DailyWithdrawTotalTriggerCents:  50_000,
	}
}

// JSON patch with pointers so omitted keys keep compiled defaults (avoid zero-value overrides).
type withdrawKYCRiskPolicyPatch struct {
	RiskRulesEnabled                *bool   `json:"risk_rules_enabled"`
	FirstWithdrawRiskWithinHours    *int    `json:"first_withdraw_risk_within_hours"`
	FirstWithdrawRiskAmountMinCents *int64  `json:"first_withdraw_risk_amount_min_cents"`
	DailyWithdrawCountThreshold     *int    `json:"daily_withdraw_count_threshold"`
	DailyWithdrawTotalTriggerCents  *int64  `json:"daily_withdraw_total_trigger_cents"`
}

// LoadWithdrawKYCRiskPolicy reads merged policy from site_settings.
func LoadWithdrawKYCRiskPolicy(ctx context.Context, pool *pgxpool.Pool) (WithdrawKYCRiskPolicy, error) {
	p := defaultWithdrawKYCRiskPolicy()
	if pool == nil {
		return p, errors.New("pool nil")
	}
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, SiteSettingWithdrawKYCPolicy).Scan(&raw)
	if err != nil {
		return p, nil
	}
	var patch withdrawKYCRiskPolicyPatch
	if err := json.Unmarshal(raw, &patch); err != nil {
		return p, nil
	}
	if patch.RiskRulesEnabled != nil {
		p.RiskRulesEnabled = *patch.RiskRulesEnabled
	}
	if patch.FirstWithdrawRiskWithinHours != nil && *patch.FirstWithdrawRiskWithinHours > 0 {
		p.FirstWithdrawRiskWithinHours = *patch.FirstWithdrawRiskWithinHours
	}
	if patch.FirstWithdrawRiskAmountMinCents != nil && *patch.FirstWithdrawRiskAmountMinCents > 0 {
		p.FirstWithdrawRiskAmountMinCents = *patch.FirstWithdrawRiskAmountMinCents
	}
	if patch.DailyWithdrawCountThreshold != nil && *patch.DailyWithdrawCountThreshold > 0 {
		p.DailyWithdrawCountThreshold = *patch.DailyWithdrawCountThreshold
	}
	if patch.DailyWithdrawTotalTriggerCents != nil && *patch.DailyWithdrawTotalTriggerCents > 0 {
		p.DailyWithdrawTotalTriggerCents = *patch.DailyWithdrawTotalTriggerCents
	}
	return p, nil
}

// WithdrawRiskSignalsTriggered returns true when internal velocity / tenure signals say identity must be approved.
func WithdrawRiskSignalsTriggered(ctx context.Context, pool *pgxpool.Pool, userID string, amountUSDMinor int64, policy WithdrawKYCRiskPolicy) (bool, string, error) {
	if pool == nil || !policy.RiskRulesEnabled {
		return false, "", nil
	}
	var createdAt time.Time
	err := pool.QueryRow(ctx, `SELECT created_at FROM players WHERE id = $1::uuid`, userID).Scan(&createdAt)
	if err != nil {
		return false, "", err
	}
	var wdLifetime int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM payment_withdrawals
		WHERE provider = 'passimpay' AND user_id = $1::uuid AND status NOT IN ('FAILED')
	`, userID).Scan(&wdLifetime)

	hoursSince := time.Since(createdAt).Hours()
	if policy.FirstWithdrawRiskWithinHours > 0 && hoursSince < float64(policy.FirstWithdrawRiskWithinHours) && wdLifetime == 0 {
		if amountUSDMinor >= policy.FirstWithdrawRiskAmountMinCents {
			return true, "recent_account_large_first_withdraw", nil
		}
	}
	var count24 int
	var sum24 int64
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int, COALESCE(SUM(amount_minor), 0)::bigint
		FROM payment_withdrawals
		WHERE provider = 'passimpay' AND user_id = $1::uuid
		  AND created_at > NOW() - INTERVAL '24 hours'
		  AND status NOT IN ('FAILED')
	`, userID).Scan(&count24, &sum24)
	if err != nil {
		return false, "", err
	}
	if policy.DailyWithdrawCountThreshold > 0 && count24 >= policy.DailyWithdrawCountThreshold {
		return true, "daily_withdraw_count", nil
	}
	if policy.DailyWithdrawTotalTriggerCents > 0 && sum24+amountUSDMinor >= policy.DailyWithdrawTotalTriggerCents {
		return true, "daily_withdraw_volume", nil
	}
	return false, "", nil
}

// RequireApprovedIdentityForWithdraw combines large-withdrawal threshold (config) and optional DB-backed risk rules.
func RequireApprovedIdentityForWithdraw(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID string, amountUSDMinor int64) error {
	if pool == nil {
		return errors.New("pool nil")
	}
	var needLarge bool
	if cfg != nil && cfg.KYCLargeWithdrawalThresholdCents > 0 && amountUSDMinor >= cfg.KYCLargeWithdrawalThresholdCents {
		needLarge = true
	}
	policy, err := LoadWithdrawKYCRiskPolicy(ctx, pool)
	if err != nil {
		return err
	}
	riskHit, reason, err := WithdrawRiskSignalsTriggered(ctx, pool, userID, amountUSDMinor, policy)
	if err != nil {
		return err
	}
	if cfg != nil && cfg.WithdrawKYCGateDryRun && (needLarge || riskHit) {
		log.Printf("withdraw_kyc_gate_dry_run user=%s amount_usd_minor=%d need_large=%v risk_hit=%v risk_reason=%q",
			userID, amountUSDMinor, needLarge, riskHit, reason)
		return nil
	}
	if !needLarge && !riskHit {
		return nil
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT COALESCE(kyc_status, 'none') FROM users WHERE id = $1::uuid`, userID).Scan(&status); err != nil {
		return err
	}
	if strings.EqualFold(status, "approved") {
		return nil
	}
	// Record why (best-effort) for support UX.
	if riskHit && reason != "" {
		_, _ = pool.Exec(ctx, `
			UPDATE users SET kyc_required_reason = $2, kyc_required_at = now(), updated_at = now()
			WHERE id = $1::uuid AND (kyc_required_reason IS NULL OR kyc_required_reason = '')
		`, userID, reason)
	}
	if needLarge && !riskHit {
		return fmt.Errorf("%w: status=%s threshold_usd_minor=%d amount_usd_minor=%d",
			ErrKYCRequired, status, cfg.KYCLargeWithdrawalThresholdCents, amountUSDMinor)
	}
	if riskHit {
		return fmt.Errorf("%w: status=%s risk=%s amount_usd_minor=%d",
			ErrKYCRequired, status, reason, amountUSDMinor)
	}
	return nil
}
