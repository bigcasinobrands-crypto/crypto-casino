package webhooks

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HandleBlueOceanWallet handles seamless wallet GET callbacks (balance/debit/credit).
// Verifies key = SHA1(salt + canonical_query) when BLUEOCEAN_WALLET_SALT is set.
// BOG seamless docs expect HTTP 200 with JSON body; use non-200 status values inside JSON when rejecting.
func HandleBlueOceanWallet(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		salt := strings.TrimSpace(cfg.BlueOceanWalletSalt)
		if salt != "" {
			if !verifyBlueOceanQueryKey(r.URL.Query(), salt, r.URL.Query().Get("key")) {
				log.Printf("blueocean wallet: invalid key from %s", r.RemoteAddr)
				http.Error(w, "invalid key", http.StatusUnauthorized)
				return
			}
		}
		// Map remote_id → user and enforce self-exclusion / closure (when link exists).
		remote := strings.TrimSpace(r.URL.Query().Get("remote_id"))
		if remote != "" && pool != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			defer cancel()
			var userID string
			err := pool.QueryRow(ctx, `
				SELECT user_id::text FROM blueocean_player_links WHERE remote_player_id = $1
			`, remote).Scan(&userID)
			if err == nil && userID != "" {
				if ok, _ := playcheck.LaunchAllowed(ctx, pool, cfg, r, userID); !ok {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_ = json.NewEncoder(w).Encode(map[string]string{"status": "403", "balance": "0"})
					return
				}
			}
		}
		// Stub: real implementation must debit/credit ledger per action and return balance.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "200", "balance": "0"})
	}
}

func verifyBlueOceanQueryKey(q url.Values, salt, wantKey string) bool {
	wantKey = strings.TrimSpace(strings.ToLower(wantKey))
	if wantKey == "" {
		return false
	}
	v := url.Values{}
	for k, vals := range q {
		if strings.EqualFold(k, "key") {
			continue
		}
		for _, val := range vals {
			v.Add(k, val)
		}
	}
	qs := v.Encode()
	sum := sha1.Sum([]byte(salt + qs))
	got := fmt.Sprintf("%x", sum)
	return strings.EqualFold(got, wantKey)
}
