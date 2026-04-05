package market

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/crypto-casino/core/internal/config"
)

// LogoDevSymbolRe limits path segments for img.logo.dev/crypto/{symbol}
var logoDevSymbolRe = regexp.MustCompile(`(?i)^[a-z0-9-]{1,24}$`)

// CryptoLogoURLsHandler returns CDN URLs for Logo.dev crypto logos (publishable key stays server-side in the URL).
// GET /v1/market/crypto-logo-urls?symbols=usdt,usdc,eth,bnb,trx
func CryptoLogoURLsHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimSpace(r.URL.Query().Get("symbols"))
		if raw == "" {
			writeLogoDevJSON(w, map[string]any{"urls": map[string]string{}, "configured": false})
			return
		}
		pk := ""
		if cfg != nil {
			pk = strings.TrimSpace(cfg.LogoDevPublishableKey)
		}
		if pk == "" {
			w.Header().Set("Cache-Control", "public, max-age=120")
			writeLogoDevJSON(w, map[string]any{"urls": map[string]string{}, "configured": false})
			return
		}

		seen := make(map[string]bool)
		out := make(map[string]string)
		for _, p := range strings.Split(raw, ",") {
			s := strings.ToLower(strings.TrimSpace(p))
			if s == "" || seen[s] {
				continue
			}
			if !logoDevSymbolRe.MatchString(s) {
				continue
			}
			seen[s] = true
			u := "https://img.logo.dev/crypto/" + url.PathEscape(s) + "?token=" + url.QueryEscape(pk)
			out[s] = u
		}

		w.Header().Set("Cache-Control", "public, max-age=3600")
		writeLogoDevJSON(w, map[string]any{"urls": out, "configured": true})
	}
}

func writeLogoDevJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
