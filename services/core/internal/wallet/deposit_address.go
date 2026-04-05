package wallet

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type depositCacheEntry struct {
	data      map[string]any
	expiresAt time.Time
}

// DepositAddressHandler returns a normalized on-chain deposit address (symbol + network or asset_id / legacy config).
func DepositAddressHandler(pool *pgxpool.Pool, cfg *config.Config, fs *fystack.Client) http.HandlerFunc {
	var mu sync.Mutex
	cache := make(map[string]depositCacheEntry)
	const cacheTTL = 5 * time.Minute

	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		if cfg == nil || !cfg.FystackConfigured() || fs == nil {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "fystack_unconfigured", "Deposit wallets are not configured. Staff: set FYSTACK_API_KEY and FYSTACK_API_SECRET in .env and restart the API.")
			return
		}
		q := r.URL.Query()
		symbol := strings.TrimSpace(q.Get("symbol"))
		network := config.NormalizeDepositNetwork(q.Get("network"))
		queryAssetID := strings.TrimSpace(q.Get("asset_id"))
		assetID, ok := resolveDepositAssetID(cfg, queryAssetID, symbol, network)
		if !ok || assetID == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "missing_asset", "pass asset_id, or symbol+network with FYSTACK_DEPOSIT_ASSETS_JSON, or set FYSTACK_DEPOSIT_ASSET_ID")
			return
		}
		var walletID string
		err := pool.QueryRow(r.Context(), `SELECT provider_wallet_id FROM fystack_wallets WHERE user_id = $1::uuid`, uid).Scan(&walletID)
		if err != nil || walletID == "" {
			playerapi.WriteError(w, http.StatusConflict, "wallet_pending", "wallet provisioning pending; try again shortly")
			return
		}

		cacheKey := walletID + "|" + assetID + "|" + network
		mu.Lock()
		if entry, found := cache[cacheKey]; found && time.Now().Before(entry.expiresAt) {
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(entry.data)
			return
		}
		mu.Unlock()

		addressType := networkToAddressType(network)
		resp, st, rerr := fs.GetDepositAddress(r.Context(), walletID, assetID, addressType)
		if rerr != nil || st < 200 || st >= 300 {
			log.Printf("fystack deposit-address: wallet=%s asset=%s type=%s status=%d err=%v resp=%v", walletID, assetID, addressType, st, rerr, resp)
			playerapi.WriteError(w, http.StatusBadGateway, "fystack_error", "could not load deposit address")
			return
		}
		if symbol == "" {
			symbol = "USDT"
		}
		if network == "" {
			network = "ERC20"
		}
		out := normalizeDepositAddressResponse(resp, strings.ToUpper(symbol), network)
		out["qr_url"] = safeDepositQRURL(out["qr_url"], cfg)

		mu.Lock()
		cache[cacheKey] = depositCacheEntry{data: out, expiresAt: time.Now().Add(cacheTTL)}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func normalizeDepositAddressResponse(resp map[string]any, symbol, network string) map[string]any {
	inner := resp
	if d, ok := resp["data"].(map[string]any); ok && len(d) > 0 {
		inner = d
	}
	addr := stringFromAny(
		inner["address"],
		inner["deposit_address"],
		inner["wallet_address"],
	)
	qr := stringFromAny(inner["qr_url"], inner["qrUrl"], inner["qr_code_url"])
	if addr == "" {
		addr = stringFromAny(resp["address"], resp["deposit_address"])
	}
	if qr == "" {
		qr = stringFromAny(resp["qr_url"], resp["qrUrl"])
	}
	return map[string]any{
		"address":  addr,
		"qr_url":   qr,
		"symbol":   strings.ToUpper(strings.TrimSpace(symbol)),
		"network":  network,
		"provider": resp,
	}
}

func stringFromAny(vals ...any) string {
	for _, v := range vals {
		switch t := v.(type) {
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		}
	}
	return ""
}

func resolveDepositAssetID(cfg *config.Config, queryAssetID, symbol, network string) (string, bool) {
	if cfg == nil {
		return "", false
	}
	if queryAssetID != "" {
		return queryAssetID, true
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	network = config.NormalizeDepositNetwork(network)
	if symbol != "" && network != "" && cfg.FystackDepositAssets != nil {
		key := symbol + "_" + network
		if id := strings.TrimSpace(cfg.FystackDepositAssets[key]); id != "" {
			return id, true
		}
	}
	if id := strings.TrimSpace(cfg.FystackDepositAssetID); id != "" {
		return id, true
	}
	return "", false
}

func networkToAddressType(network string) string {
	switch strings.ToUpper(network) {
	case "TRC20":
		return "tron"
	case "BEP20":
		return "evm"
	default:
		return "evm"
	}
}

func safeDepositQRURL(v any, cfg *config.Config) string {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return ""
	}
	host := strings.ToLower(u.Host)
	if strings.HasSuffix(host, ".fystack.io") || host == "fystack.io" ||
		host == "quickchart.io" || strings.HasSuffix(host, ".quickchart.io") {
		return s
	}
	if cfg != nil && cfg.FystackBaseURL != "" {
		if bu, err := url.Parse(cfg.FystackBaseURL); err == nil && bu.Host != "" && strings.EqualFold(host, bu.Host) {
			return s
		}
	}
	return ""
}
