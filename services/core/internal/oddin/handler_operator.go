package oddin

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OperatorHandler serves Oddin operator (S2S) callbacks. `userDetails` validates Bifrost session
// tokens issued by `POST /v1/sportsbook/oddin/session-token`; `debitUser` / `creditUser` are
// stubs until the wallet → ledger contract is wired (responses use Oddin-style `errorCode`).
type OperatorHandler struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config
}

type operatorLog struct {
	Endpoint   string
	Status     string
	ErrCode    *int
	BodyIn     map[string]any
	BodyOut    map[string]any
	HTTPStatus int
}

func (h *OperatorHandler) logRequest(ctx context.Context, ep string, body map[string]any, log operatorLog) {
	if h.Pool == nil {
		return
	}
	var txID, ticket, uid any
	if body != nil {
		if v, ok := body["transactionId"].(string); ok {
			txID = v
		}
		if v, ok := body["ticketId"].(string); ok {
			ticket = v
		}
		if v, ok := body["userId"].(string); ok {
			if parsed, err := uuid.Parse(strings.TrimSpace(v)); err == nil {
				uid = parsed
			}
		}
	}
	inRaw, _ := json.Marshal(body)
	outRaw, _ := json.Marshal(log.BodyOut)
	st := log.Status
	var ec *int
	if log.ErrCode != nil {
		ec = log.ErrCode
	}
	_, _ = h.Pool.Exec(ctx, `
INSERT INTO sportsbook_provider_requests (provider, endpoint, provider_transaction_id, ticket_id, user_id, request_body, response_body, status, error_code)
VALUES ('ODDIN', $1, $2, $3, $4::uuid, $5::jsonb, $6::jsonb, $7, $8)
`, ep, txID, ticket, uid, inRaw, outRaw, st, ec)
}

// ClientIP returns best-effort remote IP (X-Forwarded-For first hop when present).
func ClientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// writeOperatorJSON returns HTTP 200 + JSON body. Operator callbacks always return 200; outcome
// is signaled in the body via `errorCode` so Oddin's authenticator can parse the response.
func writeOperatorJSON(w http.ResponseWriter, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}

// hashOperatorToken mirrors hashOpaqueToken in handler_player.go (SHA-256 hex of the plain token).
func hashOperatorToken(plain string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(plain)))
	return hex.EncodeToString(sum[:])
}

// operatorTokenFromBody picks the token from the most common field names Oddin/SDKs use.
// Empty string when none present.
func operatorTokenFromBody(body map[string]any) string {
	if body == nil {
		return ""
	}
	for _, key := range []string{"token", "userToken", "playerToken", "accessToken", "session_token", "sessionToken"} {
		if v, ok := body[key].(string); ok {
			s := strings.TrimSpace(v)
			if s != "" {
				return s
			}
		}
	}
	return ""
}

// UserDetails validates a Bifrost session token and returns the user's wallet snapshot. Oddin
// calls this each time it needs to identify the player behind a token (auth, balance refresh).
// Returns Oddin-style `errorCode` on failure so the authenticator can parse without falling back
// to a transport-error path.
func (h *OperatorHandler) UserDetails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	token := operatorTokenFromBody(body)
	if token == "" {
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  map[string]any{"errorCode": "INVALID_TOKEN"},
		})
		writeOperatorJSON(w, map[string]any{
			"errorCode": "INVALID_TOKEN",
			"message":   "missing token in request body",
		})
		return
	}

	if h.Pool == nil {
		writeOperatorJSON(w, map[string]any{
			"errorCode": "OPERATOR_UNAVAILABLE",
			"message":   "database unavailable",
		})
		return
	}

	tokHash := hashOperatorToken(token)

	var (
		userID    string
		currency  string
		language  string
		expiresAt time.Time
		status    string
	)
	err := h.Pool.QueryRow(ctx, `
SELECT user_id::text, currency, language, expires_at, status
FROM sportsbook_sessions
WHERE token_hash = $1 AND provider = 'ODDIN'
ORDER BY created_at DESC
LIMIT 1
`, tokHash).Scan(&userID, &currency, &language, &expiresAt, &status)
	if err != nil || strings.TrimSpace(userID) == "" {
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  map[string]any{"errorCode": "INVALID_TOKEN"},
		})
		writeOperatorJSON(w, map[string]any{
			"errorCode": "INVALID_TOKEN",
			"message":   "token not recognized",
		})
		return
	}

	if !strings.EqualFold(status, "ACTIVE") {
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  map[string]any{"errorCode": "TOKEN_REVOKED"},
		})
		writeOperatorJSON(w, map[string]any{
			"errorCode": "TOKEN_REVOKED",
			"message":   "session is not active",
		})
		return
	}
	if !expiresAt.IsZero() && time.Now().UTC().After(expiresAt.UTC()) {
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  map[string]any{"errorCode": "TOKEN_EXPIRED"},
		})
		writeOperatorJSON(w, map[string]any{
			"errorCode": "TOKEN_EXPIRED",
			"message":   "session expired",
		})
		return
	}

	balanceMinor, balErr := ledger.BalanceMinor(ctx, h.Pool, userID)
	if balErr != nil {
		balanceMinor = 0
	}
	_, _ = h.Pool.Exec(ctx, `
UPDATE sportsbook_sessions SET last_used_at = now() WHERE token_hash = $1 AND provider = 'ODDIN'
`, tokHash)

	currency = strings.TrimSpace(strings.ToUpper(currency))
	if currency == "" {
		currency = "USD"
	}
	language = strings.TrimSpace(language)
	if language == "" {
		language = "en"
	}

	out := map[string]any{
		"errorCode":    "OK",
		"userId":       userID,
		"currency":     currency,
		"language":     language,
		"country":      "",
		"balance":      float64(balanceMinor) / 100.0,
		"balanceMinor": balanceMinor,
	}
	h.logRequest(ctx, "userDetails", body, operatorLog{
		Endpoint: "userDetails",
		Status:   "OK",
		BodyOut:  out,
	})
	writeOperatorJSON(w, out)
}

// DebitUserStub — placeholder; must not debit real balances. Returns `OPERATOR_NOT_READY` so
// Oddin's authenticator parses the response and reports a clear "wallet not ready" error to
// the player rather than retrying a transport failure.
func (h *OperatorHandler) DebitUserStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	out := map[string]any{
		"errorCode": "OPERATOR_NOT_READY",
		"message":   "operator wallet (debit) not enabled",
	}
	h.logRequest(ctx, "debitUser", body, operatorLog{
		Endpoint: "debitUser",
		Status:   "STUB_REJECT",
		BodyOut:  out,
	})
	writeOperatorJSON(w, out)
}

// CreditUserStub — placeholder. Returns `OPERATOR_NOT_READY`.
func (h *OperatorHandler) CreditUserStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	out := map[string]any{
		"errorCode": "OPERATOR_NOT_READY",
		"message":   "operator wallet (credit) not enabled",
	}
	h.logRequest(ctx, "creditUser", body, operatorLog{
		Endpoint: "creditUser",
		Status:   "STUB",
		BodyOut:  out,
	})
	writeOperatorJSON(w, out)
}

// UserDetailsStub is kept as a name alias so older route registrations compile. Prefer UserDetails.
//
// Deprecated: UserDetailsStub is the legacy entry name; use UserDetails which performs real token
// validation against `sportsbook_sessions`.
func (h *OperatorHandler) UserDetailsStub(w http.ResponseWriter, r *http.Request) {
	h.UserDetails(w, r)
}

func readJSONBody(r *http.Request) map[string]any {
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil || len(b) == 0 {
		return map[string]any{}
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return map[string]any{"raw": string(b)}
	}
	return m
}

// OperatorSecurityMiddleware validates optional IP allowlist, API key, and HMAC body signature.
func OperatorSecurityMiddleware(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cfg == nil {
				next.ServeHTTP(w, r)
				return
			}
			host := ClientIP(r)
			if !cfg.OddinOperatorIPAllowed(host) && len(cfg.OddinOperatorIPAllowlist) > 0 {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if k := strings.TrimSpace(cfg.OddinAPISecurityKey); k != "" {
				if strings.TrimSpace(r.Header.Get("X-API-Key")) != k {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
			}
			if sec := strings.TrimSpace(cfg.OddinHashSecret); sec != "" && r.Body != nil {
				sig := strings.TrimSpace(r.Header.Get("X-Signature"))
				if sig == "" {
					http.Error(w, "signature required", http.StatusUnauthorized)
					return
				}
				raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
				if err != nil {
					http.Error(w, "bad body", http.StatusBadRequest)
					return
				}
				mac := hmac.New(sha256.New, []byte(sec))
				mac.Write(raw)
				expect := hex.EncodeToString(mac.Sum(nil))
				if !hmac.Equal([]byte(strings.ToLower(sig)), []byte(expect)) && sig != expect {
					http.Error(w, "invalid signature", http.StatusUnauthorized)
					return
				}
				r.Body = io.NopCloser(strings.NewReader(string(raw)))
			}
			next.ServeHTTP(w, r)
		})
	}
}
