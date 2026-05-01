package ports

import "context"

// IntegrationKind identifies a replaceable integration slot (registry key).
type IntegrationKind string

const (
	KindSeamlessWallet   IntegrationKind = "seamless_wallet"
	KindDepositRail      IntegrationKind = "deposit_checkout"
	KindWithdrawalRail   IntegrationKind = "withdrawal_rail"
	KindGameLaunch       IntegrationKind = "game_launch"
	KindSportsbookLaunch IntegrationKind = "sportsbook_launch"
	KindCaptcha          IntegrationKind = "captcha"
	KindEmail            IntegrationKind = "email"
)

// SeamlessWalletPort abstracts aggregator seamless wallet callbacks (debit/credit/rollback).
// Implementations live under internal/integrations/<provider>/.
type SeamlessWalletPort interface {
	ProviderKey() string
	ParseRemoteUser(ctx context.Context, remoteID string) (userID string, err error)
}

// DepositCheckoutPort creates hosted checkout sessions (fiat/crypto rails).
type DepositCheckoutPort interface {
	ProviderKey() string
}

// WithdrawalRailPort executes provider-side withdrawals from treasury.
type WithdrawalRailPort interface {
	ProviderKey() string
}
