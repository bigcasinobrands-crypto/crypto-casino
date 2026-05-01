package chat

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/redis/go-redis/v9"
)

const wsTicketKeyPrefix = "chat:ws:ticket:"
const wsTicketTTL = 60 * time.Second

// luaConsumeTicket atomically reads and deletes the ticket key (one-time redeem).
var luaConsumeTicket = redis.NewScript(`
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v
`)

// IssueWSTicketHandler issues a short-lived one-time WebSocket ticket (requires Redis).
func IssueWSTicketHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if rdb == nil {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "unavailable", "ws tickets require redis")
			return
		}
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok || uid == "" {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var b [32]byte
		if _, err := rand.Read(b[:]); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "random failed")
			return
		}
		ticket := base64.RawURLEncoding.EncodeToString(b[:])
		key := wsTicketKeyPrefix + ticket
		if err := rdb.Set(r.Context(), key, uid, wsTicketTTL).Err(); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "ticket store failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ticket":      ticket,
			"expires_in":  int(wsTicketTTL.Seconds()),
		})
	}
}

func redeemWSTicket(ctx context.Context, rdb *redis.Client, ticket string) (userID string, ok bool) {
	if rdb == nil || ticket == "" {
		return "", false
	}
	key := wsTicketKeyPrefix + ticket
	v, err := luaConsumeTicket.Run(ctx, rdb, []string{key}).Result()
	if err != nil || v == nil {
		return "", false
	}
	s, _ := v.(string)
	if s == "" {
		return "", false
	}
	return s, true
}
