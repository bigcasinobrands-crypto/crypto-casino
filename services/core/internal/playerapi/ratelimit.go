package playerapi

import (
	"net/http"
	"time"

	"github.com/go-chi/httprate"
)

// LimitByUserID rate limits requests by the authenticated player's user id.
// Falls back to the request's remote IP if no user id is in context (defensive
// — in practice this middleware should be installed AFTER BearerMiddleware so
// every request has a user id).
//
// Use this for per-user financial rate limits (withdrawals, deposit-address)
// instead of LimitByIP, which throttles unrelated users sharing a NAT or proxy.
func LimitByUserID(requestLimit int, windowLength time.Duration) func(http.Handler) http.Handler {
	keyFunc := func(r *http.Request) (string, error) {
		if uid, ok := UserIDFromContext(r.Context()); ok && uid != "" {
			return "user:" + uid, nil
		}
		ip, err := httprate.KeyByIP(r)
		if err != nil {
			return "", err
		}
		return "ip:" + ip, nil
	}
	return httprate.Limit(requestLimit, windowLength, httprate.WithKeyFuncs(keyFunc))
}
