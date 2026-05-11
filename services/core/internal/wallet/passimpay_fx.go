package wallet

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PassimSettlementFX is a fixed rational rate: internal_minor = floor(crypto_minor * Num / Den).
type PassimSettlementFX struct {
	Num          int64
	Den          int64
	Source       string
	CryptoSymbol string
	Network      string
	InternalCCY  string
}

// LoadPassimSettlementFX resolves the active rational rate for a crypto rail into the internal ledger currency.
// It prefers a row for the exact network; otherwise falls back to network ''.
func LoadPassimSettlementFX(ctx context.Context, pool *pgxpool.Pool, cryptoSymbol, network, internalCCY string) (PassimSettlementFX, error) {
	if pool == nil {
		return PassimSettlementFX{}, fmt.Errorf("passimpay fx: nil pool")
	}
	cSym := strings.ToUpper(strings.TrimSpace(cryptoSymbol))
	net := strings.TrimSpace(network)
	ic := strings.ToUpper(strings.TrimSpace(internalCCY))
	if cSym == "" || ic == "" {
		return PassimSettlementFX{}, fmt.Errorf("passimpay fx: missing symbol or internal currency")
	}

	tryNetwork := func(n string) (PassimSettlementFX, error) {
		var fx PassimSettlementFX
		err := pool.QueryRow(ctx, `
			SELECT internal_minor_per_crypto_minor_num, internal_minor_per_crypto_minor_den, rate_source
			FROM passimpay_settlement_fx
			WHERE provider = 'passimpay' AND crypto_symbol = $1 AND network = $2 AND internal_currency = $3
			ORDER BY updated_at DESC
			LIMIT 1
		`, cSym, n, ic).Scan(&fx.Num, &fx.Den, &fx.Source)
		if err != nil {
			return PassimSettlementFX{}, err
		}
		fx.CryptoSymbol = cSym
		fx.Network = n
		fx.InternalCCY = ic
		if fx.Num <= 0 || fx.Den <= 0 {
			return PassimSettlementFX{}, fmt.Errorf("passimpay fx: invalid rate")
		}
		return fx, nil
	}

	fx, err := tryNetwork(net)
	if err == nil {
		return fx, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PassimSettlementFX{}, err
	}
	if net != "" {
		if fx2, err2 := tryNetwork(""); err2 == nil {
			return fx2, nil
		} else if !errors.Is(err2, pgx.ErrNoRows) {
			return PassimSettlementFX{}, err2
		}
	}
	return PassimSettlementFX{}, fmt.Errorf("passimpay fx: no rate for %s/%s → %s", cSym, net, ic)
}

// CryptoMinorToInternalMinor converts received crypto minor units to internal (settlement) minor units using a locked rational rate.
func CryptoMinorToInternalMinor(cryptoMinor int64, fx PassimSettlementFX) (int64, error) {
	if cryptoMinor < 1 {
		return 0, fmt.Errorf("passimpay fx: crypto amount must be positive")
	}
	if fx.Num <= 0 || fx.Den <= 0 {
		return 0, fmt.Errorf("passimpay fx: bad rational")
	}
	v := new(big.Int).Mul(big.NewInt(cryptoMinor), big.NewInt(fx.Num))
	v.Div(v, big.NewInt(fx.Den))
	if !v.IsInt64() {
		return 0, fmt.Errorf("passimpay fx: internal amount overflow")
	}
	return v.Int64(), nil
}

// InternalMinorToCryptoMinor converts internal settlement minor to crypto minor using the inverse of the deposit rate:
// crypto = floor(internal * den / num).
func InternalMinorToCryptoMinor(internalMinor int64, fx PassimSettlementFX) (int64, error) {
	if internalMinor < 1 {
		return 0, fmt.Errorf("passimpay fx: internal amount must be positive")
	}
	if fx.Num <= 0 || fx.Den <= 0 {
		return 0, fmt.Errorf("passimpay fx: bad rational")
	}
	v := new(big.Int).Mul(big.NewInt(internalMinor), big.NewInt(fx.Den))
	v.Div(v, big.NewInt(fx.Num))
	if !v.IsInt64() {
		return 0, fmt.Errorf("passimpay fx: crypto amount overflow")
	}
	out := v.Int64()
	if out < 1 {
		return 0, fmt.Errorf("passimpay fx: payout rounds to zero in crypto minor units")
	}
	return out, nil
}

// FormatCryptoMinorAsDecimal formats minor units as a fixed decimal string for provider APIs (no exponents).
func FormatCryptoMinorAsDecimal(cryptoMinor int64, decimals int) (string, error) {
	if decimals < 0 || decimals > 18 {
		return "", fmt.Errorf("passimpay fmt: bad decimals %d", decimals)
	}
	neg := cryptoMinor < 0
	n := cryptoMinor
	if neg {
		n = -n
	}
	denom := int64(1)
	for i := 0; i < decimals; i++ {
		denom *= 10
	}
	whole := n / denom
	frac := n % denom
	var s string
	if decimals == 0 {
		s = fmt.Sprintf("%d", whole)
	} else {
		s = fmt.Sprintf("%d.%s", whole, fmt.Sprintf("%0*d", decimals, frac))
	}
	if neg {
		s = "-" + s
	}
	return s, nil
}
