package ledger

// Canonical ledger entry_type values. Use these constants in BOTH write paths
// and analytics SQL so the two cannot drift. If you find an entry_type string
// elsewhere in the codebase that is NOT here, either it is wrong, or this file
// must be updated.
const (
	// Deposits
	EntryTypeDepositCredit           = "deposit.credit"
	EntryTypeDepositReversal         = "deposit.reversal"
	EntryTypeDepositClearingInbound  = "deposit.clearing.inbound"

	// Withdrawals (PassimPay lock/settle/compensation flow)
	EntryTypeWithdrawalLockCash         = "withdrawal.lock.cash"
	EntryTypeWithdrawalLockPending      = "withdrawal.lock.pending"
	EntryTypeWithdrawalPendingSettled   = "withdrawal.pending.settled"
	EntryTypeWithdrawalCompensationCash = "withdrawal.compensation.cash"
	EntryTypeWithdrawalCompensationPending = "withdrawal.compensation.pending"
	EntryTypeWithdrawalClearingOut      = "withdrawal.clearing.outbound"
	// Compensation when the provider reports a TERMINAL FAIL after we have
	// already settled the ledger (LEDGER_LOCKED → SUBMITTED_TO_PROVIDER → settled
	// → provider returns approve=2). Refunds the user cash and reverses the
	// house clearing.outbound line. Distinct from EntryTypeWithdrawalCompensationCash
	// (which fires when the provider rejects the withdrawal BEFORE settle).
	EntryTypeWithdrawalCompensationCashAfterSettle = "withdrawal.compensation.cash_after_settle"
	EntryTypeWithdrawalCompensationClearingOut     = "withdrawal.compensation.clearing.outbound"

	// Casino game (BlueOcean / generic seamless wallet)
	EntryTypeGameDebit    = "game.debit"
	EntryTypeGameBet      = "game.bet"
	EntryTypeGameCredit   = "game.credit"
	EntryTypeGameWin      = "game.win"
	EntryTypeGameRollback = "game.rollback"

	// Sportsbook (Oddin) — clean product split from casino
	EntryTypeSportsbookDebit    = "sportsbook.debit"
	EntryTypeSportsbookCredit   = "sportsbook.credit"
	EntryTypeSportsbookRollback = "sportsbook.rollback"

	// Bonus / promotions
	EntryTypePromoGrant          = "promo.grant"
	EntryTypePromoForfeit        = "promo.forfeit"
	EntryTypePromoExpire         = "promo.expire"
	EntryTypePromoConvert        = "promo.convert"
	EntryTypePromoActivation     = "promo.activation"
	EntryTypePromoRelinquish     = "promo.relinquish"
	EntryTypePromoRakeback       = "promo.rakeback"
	EntryTypePromoRakebackAccrued = "promo.rakeback_accrued"
	EntryTypePromoFreeSpinGrant  = "promo.free_spin_grant"
	EntryTypePromoDailyHuntCash  = "promo.daily_hunt_cash"

	// VIP
	EntryTypeVIPLevelUpCash = "vip.level_up_cash"

	// Challenges
	EntryTypeChallengePrize        = "challenge.prize"
	EntryTypeChallengePrizeNonCash = "challenge.prize_noncash"

	// Affiliate
	EntryTypeAffiliateCommission = "affiliate.commission"
	EntryTypeAffiliatePayout     = "affiliate.payout"

	// Provider fees (debit on house user)
	EntryTypeProviderFee = "provider.fee"
)

// CasinoStakeEntryTypes returns entry types that count as casino stakes.
// Used by analytics SQL for GGR and active-user calculations.
func CasinoStakeEntryTypes() []string {
	return []string{
		EntryTypeGameDebit,
		EntryTypeGameBet,
	}
}

// CasinoWinEntryTypes returns entry types that count as casino wins.
func CasinoWinEntryTypes() []string {
	return []string{
		EntryTypeGameCredit,
		EntryTypeGameWin,
	}
}

// SportsbookStakeEntryTypes returns entry types that count as sportsbook stakes.
func SportsbookStakeEntryTypes() []string {
	return []string{
		EntryTypeSportsbookDebit,
	}
}

// SportsbookWinEntryTypes returns entry types that count as sportsbook wins.
func SportsbookWinEntryTypes() []string {
	return []string{
		EntryTypeSportsbookCredit,
	}
}

// AllStakeEntryTypes returns all entry types that count as wagers (casino + sportsbook).
// Used for unified GGR/wager metrics and VIP/rakeback accrual.
func AllStakeEntryTypes() []string {
	return []string{
		EntryTypeGameDebit,
		EntryTypeGameBet,
		EntryTypeSportsbookDebit,
	}
}

// AllWinEntryTypes returns all entry types that count as wins (casino + sportsbook).
func AllWinEntryTypes() []string {
	return []string{
		EntryTypeGameCredit,
		EntryTypeGameWin,
		EntryTypeSportsbookCredit,
	}
}

// AllRollbackEntryTypes returns all rollback entry types.
func AllRollbackEntryTypes() []string {
	return []string{
		EntryTypeGameRollback,
		EntryTypeSportsbookRollback,
	}
}
