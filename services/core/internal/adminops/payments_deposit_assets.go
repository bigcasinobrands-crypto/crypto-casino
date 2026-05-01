package adminops

import (
	"net/http"
	"os"
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

func (h *Handler) fystackAPICanQuery() bool {
	if h.Fystack == nil {
		return false
	}
	fs := h.Fystack
	return strings.TrimSpace(fs.BaseURL) != "" &&
		strings.TrimSpace(fs.APIKey) != "" &&
		strings.TrimSpace(fs.APISecret) != "" &&
		strings.TrimSpace(fs.WorkspaceID) != ""
}

func appendCheckoutToken(add func(keyRaw, sym, net, label, fystackAssetID string), tok string) {
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

// ListDepositAssets returns payment / chain options for admin (e.g. challenge payout selector).
// Sources: FYSTACK_DEPOSIT_ASSETS_JSON, FYSTACK_CHECKOUT_SUPPORTED_ASSETS, live Fystack GET /api/v1/assets
// (whitelisted), then hardcoded defaults so the UI is never empty in dev.
func (h *Handler) ListDepositAssets(w http.ResponseWriter, r *http.Request) {
	seen := make(map[string]struct{})
	list := make([]map[string]any, 0, 64)

	add := func(keyRaw, sym, net, label, fystackAssetID string) {
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
		if strings.TrimSpace(fystackAssetID) != "" {
			row["fystack_asset_id"] = strings.TrimSpace(fystackAssetID)
		}
		list = append(list, row)
	}

	c := h.Cfg
	if c != nil {
		for _, key := range sortedMapKeys(c.FystackDepositAssets) {
			sym, net := splitSymbolNetworkKey(key)
			label := sym
			if net != "" {
				label = sym + " · " + net
			}
			add(key, sym, net, label, "")
		}

		for _, tok := range c.FystackCheckoutAssetList() {
			appendCheckoutToken(add, tok)
		}

		if strings.TrimSpace(c.FystackDepositAssetID) != "" && len(c.FystackDepositAssets) == 0 {
			key := strings.TrimSpace(os.Getenv("FYSTACK_DEPOSIT_ASSET_KEY"))
			if key == "" {
				key = "USDT_ERC20"
			}
			key = strings.ToUpper(key)
			if _, dup := seen[key]; !dup {
				sym, net := splitSymbolNetworkKey(key)
				label := sym + " (deposit asset)"
				if net != "" {
					label = sym + " · " + net + " (deposit asset)"
				}
				add(key, sym, net, label, "")
			}
		}
	} else {
		for _, tok := range defaultCheckoutAssetTokens() {
			appendCheckoutToken(add, tok)
		}
	}

	if h.fystackAPICanQuery() {
		if assets, err := h.Fystack.ListWhitelistedAssets(r.Context(), 400); err == nil {
			for _, a := range assets {
				sym := strings.ToUpper(strings.TrimSpace(a.Symbol))
				if sym == "" {
					continue
				}
				ch := strconv.FormatInt(a.ChainID, 10)
				key := sym + "_" + ch
				label := sym + " · " + chainIDToNetworkLabel(ch)
				if a.NetworkName != "" {
					label = sym + " · " + a.NetworkName
				}
				add(key, sym, ch, label, a.ID)
			}
		}
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

func sortedMapKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
