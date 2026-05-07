package wallet

import (
	"regexp"
	"strings"
)

// SEC-4: Withdrawal address format validation per network. Catches typos before
// anything is sent to the payment provider so funds do not end up at an
// unrecoverable address.
//
// We deliberately validate format only (length, character set, address prefix).
// On-chain checksum verification happens at the provider; users sending funds
// from a wallet that does not produce checksum-correct addresses will still
// experience a provider-side reject without losing money.

var (
	evmAddressRe   = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	tronAddressRe  = regexp.MustCompile(`^T[1-9A-HJ-NP-Za-km-z]{33}$`) // base58, no 0/O/I/l
	btcLegacyRe    = regexp.MustCompile(`^[13][1-9A-HJ-NP-Za-km-z]{25,34}$`)
	btcBech32Re    = regexp.MustCompile(`^bc1[02-9ac-hj-np-z]{6,87}$`)
	solanaRe       = regexp.MustCompile(`^[1-9A-HJ-NP-Za-km-z]{32,44}$`)
	litecoinRe     = regexp.MustCompile(`^(L|M|3)[1-9A-HJ-NP-Za-km-z]{25,34}$`)
	litecoinBech32 = regexp.MustCompile(`^ltc1[02-9ac-hj-np-z]{6,87}$`)
)

// ValidateWithdrawalAddress returns an empty string when the address looks
// well-formed for the given network, or a short reason code otherwise.
// network is the canonical form produced by config.NormalizeDepositNetwork
// (e.g. ERC20, TRC20, BEP20). Unknown networks pass through without rejection
// so the rail does not break when a new currency is added; provider validation
// is still authoritative.
func ValidateWithdrawalAddress(network, addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "address_empty"
	}
	if len(addr) < 10 || len(addr) > 128 {
		return "address_length"
	}
	switch strings.ToUpper(strings.TrimSpace(network)) {
	case "ERC20", "BEP20", "POLYGON", "MATIC", "ARBITRUM", "OPTIMISM", "AVAX", "AVAXC":
		if !evmAddressRe.MatchString(addr) {
			return "address_evm_format"
		}
	case "TRC20":
		if !tronAddressRe.MatchString(addr) {
			return "address_tron_format"
		}
	case "BTC", "BITCOIN":
		if !btcLegacyRe.MatchString(addr) && !btcBech32Re.MatchString(strings.ToLower(addr)) {
			return "address_btc_format"
		}
	case "SOL", "SOLANA":
		if !solanaRe.MatchString(addr) {
			return "address_solana_format"
		}
	case "LTC", "LITECOIN":
		if !litecoinRe.MatchString(addr) && !litecoinBech32.MatchString(strings.ToLower(addr)) {
			return "address_litecoin_format"
		}
	default:
		// Permit unknown networks (provider does its own validation).
	}
	return ""
}
