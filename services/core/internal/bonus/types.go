package bonus

// PaymentSettled is emitted after a deposit ledger credit succeeds (PassimPay / ledger path).
type PaymentSettled struct {
	UserID             string `json:"user_id"`
	AmountMinor        int64  `json:"amount_minor"`
	Currency           string `json:"currency"`
	Channel            string `json:"channel"` // on_chain_deposit, hosted_checkout
	ProviderResourceID string `json:"provider_resource_id"`
	// Country optional ISO-3166 alpha-2 for segment.country_allow / country_deny (simulate, future KYC).
	Country string `json:"country,omitempty"`
	// DepositIndex is 1-based count of successful deposit ledger credits for this user (includes this payment).
	DepositIndex int64 `json:"deposit_index"`
	FirstDeposit bool  `json:"first_deposit"`
}
