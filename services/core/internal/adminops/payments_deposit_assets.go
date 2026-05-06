package adminops

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
)

func chainIDToNetworkLabel(chainID string) string {
	switch strings.TrimSpace(chainID) {
	case "1":
		return "Ethereum"
	case "5":
		return "Goerli"
	case "11155111":
		return "Sepolia"
	case "56":
		return "BSC"
	case "97":
		return "BSC Testnet"
	case "137":
		return "Polygon"
	case "8453":
		return "Base"
	case "42161":
		return "Arbitrum One"
	case "10":
		return "Optimism"
	case "43114":
		return "Avalanche"
	case "":
		return "Unknown chain"
	default:
		return "Chain ID " + strings.TrimSpace(chainID)
	}
}

func splitSymbolNetworkKey(key string) (sym string, net string) {
	ku := strings.ToUpper(strings.TrimSpace(key))
	sym = ku
	net = ""
	if i := strings.Index(ku, "_"); i > 0 {
		sym = ku[:i]
		net = ku[i+1:]
	}
	return sym, net
}

func defaultCheckoutAssetTokens() []string {
	return []string{"USDC:1", "ETH:1", "ETH:8453"}
}

func appendCheckoutToken(add func(keyRaw, sym, net, label, providerPaymentID string), tok string) {
	tok = strings.TrimSpace(tok)
	if tok == "" {
		return
	}
	parts := strings.SplitN(tok, ":", 2)
	sym := strings.ToUpper(strings.TrimSpace(parts[0]))
	chID := ""
	if len(parts) > 1 {
		chID = strings.TrimSpace(parts[1])
	}
	key := sym + "_" + chID
	label := sym + " · " + chainIDToNetworkLabel(chID)
	add(key, sym, chID, label, "")
}

// ListDepositAssets returns payment / chain options for admin (PassimPay currencies + sensible defaults).
func (h *Handler) ListDepositAssets(w http.ResponseWriter, r *http.Request) {
	seen := make(map[string]struct{})
	list := make([]map[string]any, 0, 64)

	add := func(keyRaw, sym, net, label, providerPaymentID string) {
		k := strings.ToUpper(strings.TrimSpace(keyRaw))
		if k == "" {
			return
		}
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		row := map[string]any{
			"key":     k,
			"symbol":  strings.ToUpper(strings.TrimSpace(sym)),
			"network": net,
			"label":   label,
		}
		if strings.TrimSpace(providerPaymentID) != "" {
			row["provider_payment_id"] = strings.TrimSpace(providerPaymentID)
		}
		list = append(list, row)
	}

	rows, err := h.Pool.Query(r.Context(), `
		SELECT symbol, COALESCE(network,''), provider_payment_id::text,
		       COALESCE(metadata->>'label','')
		FROM payment_currencies
		WHERE provider = 'passimpay' AND deposit_enabled = true
		ORDER BY symbol ASC, network ASC NULLS LAST
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sym, net, payID, labelMeta string
			if err := rows.Scan(&sym, &net, &payID, &labelMeta); err != nil {
				continue
			}
			sym = strings.ToUpper(strings.TrimSpace(sym))
			net = strings.TrimSpace(net)
			key := sym + "_" + net
			if net == "" {
				key = sym
			}
			label := strings.TrimSpace(labelMeta)
			if label == "" {
				if _, err := strconv.Atoi(net); err == nil && net != "" {
					label = sym + " · " + chainIDToNetworkLabel(net)
				} else if net != "" {
					label = sym + " · " + net
				} else {
					label = sym
				}
			}
			add(key, sym, net, label, payID)
		}
	}

	for _, tok := range defaultCheckoutAssetTokens() {
		appendCheckoutToken(add, tok)
	}

	if len(list) == 0 {
		for _, tok := range defaultCheckoutAssetTokens() {
			appendCheckoutToken(add, tok)
		}
	}

	sort.Slice(list, func(i, j int) bool {
		ki, _ := list[i]["key"].(string)
		kj, _ := list[j]["key"].(string)
		return ki < kj
	})

	writeJSON(w, map[string]any{"assets": list})
}
