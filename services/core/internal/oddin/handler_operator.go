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

	"github.com/crypto-casino/core/internal/config"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OperatorHandler serves Oddin operator callbacks (server-to-server). Stubs only — no ledger mutation.
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

// stubJSON writes HTTP 200 + JSON body (Oddin expects structured responses with errorCode).
func stubNotImplemented(w http.ResponseWriter, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"errorCode": "NOT_IMPLEMENTED",
		"message":   detail,
	})
}

// UserDetailsStub — placeholder until ledger-backed wallet integration.
func (h *OperatorHandler) UserDetailsStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	h.logRequest(ctx, "userDetails", body, operatorLog{
		Endpoint: "userDetails",
		Status:   "STUB",
		BodyOut:  map[string]any{"errorCode": "NOT_IMPLEMENTED"},
	})
	stubNotImplemented(w, "wallet integration pending")
}

// DebitUserStub — placeholder; must not debit real balances.
func (h *OperatorHandler) DebitUserStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	h.logRequest(ctx, "debitUser", body, operatorLog{
		Endpoint: "debitUser",
		Status:   "STUB_REJECT",
		BodyOut:  map[string]any{"errorCode": "NOT_IMPLEMENTED"},
	})
	stubNotImplemented(w, "debit not enabled")
}

// CreditUserStub — placeholder.
func (h *OperatorHandler) CreditUserStub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)
	h.logRequest(ctx, "creditUser", body, operatorLog{
		Endpoint: "creditUser",
		Status:   "STUB",
		BodyOut:  map[string]any{"errorCode": "NOT_IMPLEMENTED"},
	})
	stubNotImplemented(w, "credit not enabled")
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
