package compliance

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// KYC gate for large withdrawals (E-4).
//
// `users.kyc_status` is one of: 'none' | 'pending' | 'approved' | 'rejected'.
// Withdrawals up to and including KYC threshold (default 1000 USD-equivalent
// minor = 100000 cents) are allowed without KYC. Above the threshold the user
// must be 'approved'. 'pending' or 'rejected' both bounce; the wallet UI then
// surfaces a "complete KYC to withdraw" CTA so the player knows what to do.
//
// We pin the threshold per-currency to "USD-equivalent minor" rather than a
// raw amount because crypto withdrawals can come in many currencies and
// applying the same nominal cap across BTC and DOGE would be nonsensical. For
// today's implementation we accept the threshold as a parameter from the
// caller (the withdraw handler resolves USD value via the existing FX/ticker
// path); the helper itself just enforces approved-vs-not.

// ErrKYCRequired is returned when the withdrawal exceeds the KYC threshold
// and the user's kyc_status is not 'approved'.
var ErrKYCRequired = errors.New("compliance: KYC approval required for large withdrawal")

// CheckKYCForLargeWithdrawal blocks withdrawals over thresholdUSDMinor when
// the user has not completed KYC. usdEquivMinor is the withdrawal amount
// translated to USD minor units (e.g. 25000 = $250.00). If the threshold is
// non-positive the check is a no-op (KYC gate disabled).
func CheckKYCForLargeWithdrawal(ctx context.Context, pool *pgxpool.Pool, userID string, usdEquivMinor, thresholdUSDMinor int64) error {
	if pool == nil || thresholdUSDMinor <= 0 || usdEquivMinor < thresholdUSDMinor {
		return nil
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT COALESCE(kyc_status, 'none') FROM users WHERE id = $1::uuid`, userID).Scan(&status); err != nil {
		return err
	}
	if strings.EqualFold(status, "approved") {
		return nil
	}
	return fmt.Errorf("%w: status=%s threshold_usd_minor=%d amount_usd_minor=%d",
		ErrKYCRequired, status, thresholdUSDMinor, usdEquivMinor)
}
