package ledger

// SettledStakeAmountCaseSQL is a SQL CASE expression (minor units) for stake lines used in GGR:
// debits/bets increase the stake total (ABS amount), rollbacks decrease it (negative of ABS).
// Restrict the outer query to entry types in ('game.debit','game.bet','sportsbook.debit','game.rollback','sportsbook.rollback').
func SettledStakeAmountCaseSQL(leAlias string) string {
	return `(CASE WHEN ` + leAlias + `.entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(` + leAlias + `.amount_minor) WHEN ` + leAlias + `.entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(` + leAlias + `.amount_minor) ELSE 0 END)`
}
