package oddin

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OperatorHandler serves Oddin operator (S2S) callbacks. `userDetails` validates Bifrost session
// tokens issued by `POST /v1/sportsbook/oddin/session-token`; `debitUser` / `creditUser` are
// stubs until the wallet → ledger contract is wired.
//
// Response shape — seamless wallet convention used by Oddin / EvenBet / similar providers:
//   - HTTP **200** always.
//   - Body always carries integer `errorCode` (0 = success).
//   - Errors include only `errorCode` + `errorDescription`.
//   - Success (`errorCode: 0`) returns the user/wallet snapshot (no error fields).
type OperatorHandler struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config
}

// Operator error codes — small ints per the seamless wallet protocol Oddin uses.
// Reference: standard mapping shared by EvenBet/Oddin/similar providers (codes 0–7).
// Keep stable — providers map these to internal failure modes; arbitrary high codes
// (e.g. 100/200/900) are unrecognized and cause the iframe to surface a generic
// "Sportsbook reported an error" instead of the specific failure.
const (
	ErrCodeOK                int = 0 // completed successfully
	ErrCodeInvalidSignature  int = 1
	ErrCodePlayerNotFound    int = 2
	ErrCodeInsufficientFunds int = 3
	ErrCodeInvalidParams     int = 4 // also used for "operator can't process right now"
	ErrCodeRefNotFound       int = 5
	ErrCodeRefIncompatible   int = 6
	ErrCodeAuthFailed        int = 7 // wrong authentication / session expired

	// defaultCountry used when sportsbook_sessions has no country recorded. Empty `country`
	// makes Bifrost's user validation reject the payload; ISO 3166-1 alpha-2 is required.
	defaultCountry = "US"
)

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
	} else if log.BodyOut != nil {
		// Best-effort: derive numeric error_code from BodyOut so audit columns stay consistent.
		switch v := log.BodyOut["errorCode"].(type) {
		case int:
			c := v
			ec = &c
		case float64:
			c := int(v)
			ec = &c
		}
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
// is signaled in the body via integer `errorCode` so Oddin's authenticator can parse the response.
func writeOperatorJSON(w http.ResponseWriter, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}

// errorBody builds the seamless-wallet error envelope: integer `errorCode` + `errorDescription`.
// Per the protocol, error responses MUST contain only these two fields (no balance / user data).
func errorBody(code int, desc string) map[string]any {
	return map[string]any{
		"errorCode":        code,
		"errorDescription": desc,
	}
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

// UserDetails validates a Bifrost session token and returns the user's wallet snapshot.
// Failure paths return integer `errorCode` so Oddin's authenticator can parse without falling
// back to a transport-error path. Success returns the user snapshot WITHOUT `errorDescription`.
func (h *OperatorHandler) UserDetails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	token := operatorTokenFromBody(body)
	if token == "" {
		out := errorBody(ErrCodeAuthFailed, "missing token in request body")
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  out,
		})
		writeOperatorJSON(w, out)
		return
	}

	if h.Pool == nil {
		// Pool nil means startup misconfiguration; the audit table lives in that same pool,
		// so logRequest cannot persist this rejection. Still call it for symmetry with the
		// other error paths (defensive no-op today; if logRequest ever grows a fallback sink
		// this branch benefits automatically). Emit slog.Error so the rejection is observable
		// in Render logs even when the DB is unreachable.
		out := errorBody(ErrCodeInvalidParams, "database unavailable")
		slog.ErrorContext(ctx, "oddin_operator_pool_nil",
			"endpoint", "userDetails",
			"client_ip", ClientIP(r),
			"error_code", ErrCodeInvalidParams)
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  out,
		})
		writeOperatorJSON(w, out)
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
	if err != nil {
		// pgx.ErrNoRows is the legitimate "no matching session" case → genuine auth failure.
		// Any other error (connection drop, scan failure, query error) is an operator-side
		// problem — surface it as ErrCodeInvalidParams (consistent with the pool-nil branch)
		// and emit slog so we can distinguish system failures from real auth rejections in
		// Render logs. Without this split, a transient DB hiccup would log out every player
		// hitting the sportsbook and pollute the audit trail with false "REJECT" rows.
		if errors.Is(err, pgx.ErrNoRows) {
			out := errorBody(ErrCodeAuthFailed, "token not recognized")
			h.logRequest(ctx, "userDetails", body, operatorLog{
				Endpoint: "userDetails",
				Status:   "REJECT",
				BodyOut:  out,
			})
			writeOperatorJSON(w, out)
			return
		}
		out := errorBody(ErrCodeInvalidParams, "operator query error")
		slog.ErrorContext(ctx, "oddin_operator_query_error",
			"endpoint", "userDetails",
			"client_ip", ClientIP(r),
			"error", err.Error(),
			"error_code", ErrCodeInvalidParams)
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "ERROR",
			BodyOut:  out,
		})
		writeOperatorJSON(w, out)
		return
	}
	if strings.TrimSpace(userID) == "" {
		// Defensive: sportsbook_sessions.user_id is NOT NULL UUID so this should be
		// unreachable, but if a future schema change ever allows blanks we still want a
		// clean auth-failed response rather than handing Bifrost an empty userId.
		out := errorBody(ErrCodeAuthFailed, "token not recognized")
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  out,
		})
		writeOperatorJSON(w, out)
		return
	}

	if !strings.EqualFold(status, "ACTIVE") {
		out := errorBody(ErrCodeAuthFailed, "session is not active")
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  out,
		})
		writeOperatorJSON(w, out)
		return
	}
	if !expiresAt.IsZero() && time.Now().UTC().After(expiresAt.UTC()) {
		out := errorBody(ErrCodeAuthFailed, "session expired")
		h.logRequest(ctx, "userDetails", body, operatorLog{
			Endpoint: "userDetails",
			Status:   "REJECT",
			BodyOut:  out,
		})
		writeOperatorJSON(w, out)
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

	// Seamless wallet success body — only successful path includes the wallet snapshot.
	// `balance` is in INTEGER MINOR UNITS (cents) per Oddin's parser (their struct reads
	// it as uint64; sending a JSON float crashes their decoder for non-zero values).
	// `country` MUST be a non-empty ISO 3166-1 alpha-2 code; empty values make Bifrost
	// reject the user payload and surface "Sportsbook reported an error" in the iframe.
	out := map[string]any{
		"errorCode": ErrCodeOK,
		"userId":    userID,
		"currency":  currency,
		"language":  language,
		"country":   defaultCountry,
		"balance":   balanceMinor,
	}
	h.logRequest(ctx, "userDetails", body, operatorLog{
		Endpoint: "userDetails",
		Status:   "OK",
		BodyOut:  out,
	})
	writeOperatorJSON(w, out)
}

// DebitUserStub — placeholder; must not debit real balances. Returns ErrCodeInvalidParams (4)
// — closest "operator can't process this right now" signal in the standard 0–7 set. Will be
// replaced with real ledger debit logic once the wallet contract is wired.
func (h *OperatorHandler) DebitUserStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	out := errorBody(ErrCodeInvalidParams, "operator wallet (debit) not enabled")
	h.logRequest(ctx, "debitUser", body, operatorLog{
		Endpoint: "debitUser",
		Status:   "STUB_REJECT",
		BodyOut:  out,
	})
	writeOperatorJSON(w, out)
}

// CreditUserStub — placeholder. Returns ErrCodeInvalidParams until ledger credit is wired.
func (h *OperatorHandler) CreditUserStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	out := errorBody(ErrCodeInvalidParams, "operator wallet (credit) not enabled")
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
