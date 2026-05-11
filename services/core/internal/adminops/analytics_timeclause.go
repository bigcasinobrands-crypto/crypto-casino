package adminops

import "time"

// financeWithdrawalWindowClause returns a time filter for PassimPay rows in payment_withdrawals
// that should feed finance KPIs: status must be COMPLETED separately; time axis is provider
// terminal success (updated_at when the success webhook marks COMPLETED / PAID).
func financeWithdrawalWindowClause(all bool, tableAlias string, _ time.Time, _ time.Time) string {
	if all {
		return tableAlias + ".updated_at <= $1"
	}
	return tableAlias + ".updated_at >= $1 AND " + tableAlias + ".updated_at <= $2"
}
