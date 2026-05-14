package wallet

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Currency filter mirrors ledger seamless balance rules so header "playable" and
// wagering remaining stay in the same unit as BLUEOCEAN_CURRENCY / multicurrency.
const activeWageringRemainingSQL = `
SELECT COALESCE(SUM(GREATEST(0, wr_required_minor - wr_contributed_minor)), 0)::bigint
FROM user_bonus_instances
WHERE user_id = $1::uuid
  AND status = 'active'
  AND (
    upper(trim(currency)) = $2
    OR (NOT $3::bool AND (currency IS NULL OR btrim(currency) = ''))
    OR ($3::bool AND $2 = 'EUR' AND (currency IS NULL OR btrim(currency) = ''))
  )`

// ActiveWageringRemainingMinor sums outstanding playthrough on active bonus instances
// (amount still to be staked before WR completes), in minor units for walletCCY.
func ActiveWageringRemainingMinor(ctx context.Context, pool *pgxpool.Pool, userID, walletCCY string, multiCurrency bool) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(walletCCY))
	if ccy == "" {
		ccy = "EUR"
	}
	var sum int64
	err := pool.QueryRow(ctx, activeWageringRemainingSQL, userID, ccy, multiCurrency).Scan(&sum)
	return sum, err
}
