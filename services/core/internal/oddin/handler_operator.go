package oddin

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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

// OperatorHandler serves Oddin operator (S2S) callbacks. `userDetails` validates Oddin iframe
// (Bifrost) session tokens issued by `POST /v1/sportsbook/oddin/session-token`; `debitUser` / `creditUser` are
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

// enrichOddinUserDetails adds firstName, email, verificationStatus, and optional dateOfBirth
// so Oddin's authenticator receives the shape many seamless-wallet brands require.
func enrichOddinUserDetails(ctx context.Context, pool *pgxpool.Pool, userID string, out map[string]any) {
	if pool == nil || out == nil || strings.TrimSpace(userID) == "" {
		return
	}
	var email, username, kyc string
	var dob sql.NullString
	err := pool.QueryRow(ctx, `
		SELECT email, COALESCE(username, ''), COALESCE(kyc_status, 'none'), date_of_birth::text
		FROM users WHERE id = $1::uuid
	`, userID).Scan(&email, &username, &kyc, &dob)
	if err != nil {
		slog.WarnContext(ctx, "oddin_userdetails_profile_lookup_failed", "user_id", userID, "err", err)
		return
	}
	display := strings.TrimSpace(username)
	if display == "" && email != "" {
		if i := strings.IndexByte(email, '@'); i > 0 {
			display = strings.TrimSpace(email[:i])
		}
	}
	if display == "" {
		display = "Player"
	}
	parts := strings.Fields(display)
	var firstName, lastName string
	switch len(parts) {
	case 0:
		firstName = "Player"
	case 1:
		firstName = parts[0]
	default:
		firstName = parts[0]
		lastName = strings.Join(parts[1:], " ")
	}
	out["firstName"] = firstName
	if lastName == "" {
		out["lastName"] = "-"
	} else {
		out["lastName"] = lastName
	}
	out["email"] = strings.TrimSpace(email)
	out["nickname"] = display
	verification := "UNVERIFIED"
	if strings.EqualFold(strings.TrimSpace(kyc), "approved") {
		verification = "VERIFIED"
	}
	out["verificationStatus"] = verification
	if dob.Valid && strings.TrimSpace(dob.String) != "" {
		out["dateOfBirth"] = strings.TrimSpace(dob.String)
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

// UserDetails validates an Oddin session token (issued for their Bifrost client) and returns the user's wallet snapshot.
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
		country   *string
		expiresAt time.Time
		status    string
	)
	err := h.Pool.QueryRow(ctx, `
SELECT user_id::text, currency, language, country, expires_at, status
FROM sportsbook_sessions
WHERE token_hash = $1 AND provider = 'ODDIN'
ORDER BY created_at DESC
LIMIT 1
`, tokHash).Scan(&userID, &currency, &language, &country, &expiresAt, &status)
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
		// clean auth-failed response rather than handing Oddin an empty userId.
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
	// `country` MUST be a non-empty ISO 3166-1 alpha-2 code; empty values make Oddin's iframe
	// reject the user payload and surface "Sportsbook reported an error" in the iframe.
	// We prefer the country stored on the session row (geo at token issue) and fall back
	// to Config.OddinFallbackCountryISO2() (ODDIN_DEFAULT_COUNTRY, else US).
	resolvedCountry := ""
	if country != nil {
		if c := strings.TrimSpace(strings.ToUpper(*country)); len(c) == 2 {
			resolvedCountry = c
		}
	}
	if resolvedCountry == "" {
		resolvedCountry = h.Cfg.OddinFallbackCountryISO2()
	}
	out := map[string]any{
		"errorCode": ErrCodeOK,
		"userId":    userID,
		"currency":  currency,
		"language":  language,
		"country":   resolvedCountry,
		"balance":   balanceMinor,
	}
	enrichOddinUserDetails(ctx, h.Pool, userID, out)
	h.logRequest(ctx, "userDetails", body, operatorLog{
		Endpoint: "userDetails",
		Status:   "OK",
		BodyOut:  out,
	})
	writeOperatorJSON(w, out)
}

// extractAmountMinor pulls the amount in MINOR units from a parsed Oddin body.
// Oddin's seamless wallet protocol uses integer minor units to match the
// `balance` we return from userDetails. We accept both numeric (preferred) and
// string forms because some SDK builds emit JSON numbers as strings.
func extractAmountMinor(body map[string]any, keys ...string) (int64, bool) {
	if body == nil {
		return 0, false
	}
	for _, k := range keys {
		v, ok := body[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case float64:
			return int64(n), true
		case int:
			return int64(n), true
		case int64:
			return n, true
		case string:
			s := strings.TrimSpace(n)
			if s == "" {
				continue
			}
			// strconv-free path so we don't grow imports — float64 round-trip
			// is safe up to 2^53 which is far above any realistic stake amount.
			var f float64
			if _, err := jsonNumberFromString(s, &f); err == nil {
				return int64(f), true
			}
		}
	}
	return 0, false
}

// jsonNumberFromString parses a number-as-string without pulling strconv into
// every file in this package; we already pull encoding/json so this stays
// dependency-stable.
func jsonNumberFromString(s string, out *float64) (int, error) {
	return -1, json.Unmarshal([]byte(s), out)
}

// extractStringField picks the first non-empty string for any of the candidate keys.
func extractStringField(body map[string]any, keys ...string) string {
	if body == nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := body[k].(string); ok {
			s := strings.TrimSpace(v)
			if s != "" {
				return s
			}
		}
	}
	return ""
}

// resolveSession authenticates the operator callback and returns the bound user.
// On failure it writes the error response and returns ok=false; callers must
// stop after that. The session pre-checks must mirror UserDetails so that
// debit/credit/rollback cannot bypass auth that userDetails performed.
func (h *OperatorHandler) resolveSession(ctx context.Context, body map[string]any) (userID, currency string, ok bool, errResp map[string]any) {
	token := operatorTokenFromBody(body)
	if token == "" {
		return "", "", false, errorBody(ErrCodeAuthFailed, "missing token in request body")
	}
	if h.Pool == nil {
		return "", "", false, errorBody(ErrCodeInvalidParams, "database unavailable")
	}
	tokHash := hashOperatorToken(token)
	var (
		expiresAt time.Time
		status    string
	)
	err := h.Pool.QueryRow(ctx, `
SELECT user_id::text, currency, expires_at, status
FROM sportsbook_sessions
WHERE token_hash = $1 AND provider = 'ODDIN'
ORDER BY created_at DESC
LIMIT 1
`, tokHash).Scan(&userID, &currency, &expiresAt, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", false, errorBody(ErrCodeAuthFailed, "token not recognized")
		}
		slog.ErrorContext(ctx, "oddin_operator_session_lookup_failed", "err", err)
		return "", "", false, errorBody(ErrCodeInvalidParams, "operator query error")
	}
	if !strings.EqualFold(status, "ACTIVE") {
		return "", "", false, errorBody(ErrCodeAuthFailed, "session is not active")
	}
	if !expiresAt.IsZero() && time.Now().UTC().After(expiresAt.UTC()) {
		return "", "", false, errorBody(ErrCodeAuthFailed, "session expired")
	}
	if strings.TrimSpace(userID) == "" {
		return "", "", false, errorBody(ErrCodeAuthFailed, "token not recognized")
	}
	currency = strings.TrimSpace(strings.ToUpper(currency))
	if currency == "" {
		currency = "USD"
	}
	return userID, currency, true, nil
}

// DebitUser places a sportsbook stake on the player's wallet by writing a
// `sportsbook.debit` ledger row in the cash pocket and returning the new
// balance to Oddin. Idempotency key is derived from the provider's
// transactionId so Oddin retries cannot double-charge.
//
// Cross-checks:
//   - The session token must resolve to the same userId Oddin sent in `userId`.
//     This blocks a compromised session from spending some other player's funds.
//   - amount must be positive integer minor units; we fail closed on parse errors.
//   - balance is checked via FOR UPDATE row lock so concurrent debits from
//     userDetails / casino flow cannot race the player into negative balance.
func (h *OperatorHandler) DebitUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)

	uid, sessionCcy, ok, errResp := h.resolveSession(ctx, body)
	if !ok {
		h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "REJECT", BodyOut: errResp})
		writeOperatorJSON(w, errResp)
		return
	}

	bodyUserID := extractStringField(body, "userId", "playerId")
	if bodyUserID != "" && !strings.EqualFold(bodyUserID, uid) {
		// Token belongs to user A but Oddin claims user B. This must never be
		// a "soft fail" — it is either a misconfigured Oddin deployment or
		// an attempted replay across users. Reject with auth failure so the
		// audit row makes the mismatch obvious.
		out := errorBody(ErrCodeAuthFailed, "session/user mismatch")
		h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "REJECT_MISMATCH", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}

	txnID := extractStringField(body, "transactionId", "transaction_id", "txId")
	if txnID == "" {
		out := errorBody(ErrCodeInvalidParams, "transactionId required")
		h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "REJECT", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	ticketID := extractStringField(body, "ticketId", "ticket_id", "betId", "bet_id")
	amount, hasAmount := extractAmountMinor(body, "amount", "amountMinor", "stake", "betAmount")
	if !hasAmount || amount <= 0 {
		out := errorBody(ErrCodeInvalidParams, "amount must be positive minor units")
		h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "REJECT", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}

	ccy := strings.TrimSpace(strings.ToUpper(extractStringField(body, "currency")))
	if ccy == "" {
		ccy = sessionCcy
	}

	bal, status, err := applyOddinSeamless(ctx, h.Pool, uid, ccy, "debit", txnID, ticketID, amount)
	if err != nil {
		slog.ErrorContext(ctx, "oddin_debit_failed", "err", err, "txn", txnID)
		out := errorBody(ErrCodeInvalidParams, "operator processing error")
		h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "ERROR", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	switch status {
	case "INSUFFICIENT":
		out := errorBody(ErrCodeInsufficientFunds, "insufficient funds")
		h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "INSUFFICIENT", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}

	out := map[string]any{
		"errorCode":     ErrCodeOK,
		"userId":        uid,
		"transactionId": txnID,
		"currency":      ccy,
		"balance":       bal,
	}
	h.logRequest(ctx, "debitUser", body, operatorLog{Endpoint: "debitUser", Status: "OK", BodyOut: out})
	writeOperatorJSON(w, out)
}

// CreditUser settles a sportsbook win on the player's wallet by writing a
// `sportsbook.credit` ledger row in the cash pocket. Like DebitUser, retries
// dedupe on the provider transactionId. Negative or zero amounts are rejected
// because Oddin sends void/refund flows through rollbackUser, not creditUser.
func (h *OperatorHandler) CreditUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)

	uid, sessionCcy, ok, errResp := h.resolveSession(ctx, body)
	if !ok {
		h.logRequest(ctx, "creditUser", body, operatorLog{Endpoint: "creditUser", Status: "REJECT", BodyOut: errResp})
		writeOperatorJSON(w, errResp)
		return
	}
	bodyUserID := extractStringField(body, "userId", "playerId")
	if bodyUserID != "" && !strings.EqualFold(bodyUserID, uid) {
		out := errorBody(ErrCodeAuthFailed, "session/user mismatch")
		h.logRequest(ctx, "creditUser", body, operatorLog{Endpoint: "creditUser", Status: "REJECT_MISMATCH", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	txnID := extractStringField(body, "transactionId", "transaction_id", "txId")
	if txnID == "" {
		out := errorBody(ErrCodeInvalidParams, "transactionId required")
		h.logRequest(ctx, "creditUser", body, operatorLog{Endpoint: "creditUser", Status: "REJECT", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	ticketID := extractStringField(body, "ticketId", "ticket_id", "betId", "bet_id")
	amount, hasAmount := extractAmountMinor(body, "amount", "amountMinor", "win", "payout")
	if !hasAmount || amount < 0 {
		out := errorBody(ErrCodeInvalidParams, "amount must be non-negative minor units")
		h.logRequest(ctx, "creditUser", body, operatorLog{Endpoint: "creditUser", Status: "REJECT", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	ccy := strings.TrimSpace(strings.ToUpper(extractStringField(body, "currency")))
	if ccy == "" {
		ccy = sessionCcy
	}

	bal, _, err := applyOddinSeamless(ctx, h.Pool, uid, ccy, "credit", txnID, ticketID, amount)
	if err != nil {
		slog.ErrorContext(ctx, "oddin_credit_failed", "err", err, "txn", txnID)
		out := errorBody(ErrCodeInvalidParams, "operator processing error")
		h.logRequest(ctx, "creditUser", body, operatorLog{Endpoint: "creditUser", Status: "ERROR", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	out := map[string]any{
		"errorCode":     ErrCodeOK,
		"userId":        uid,
		"transactionId": txnID,
		"currency":      ccy,
		"balance":       bal,
	}
	h.logRequest(ctx, "creditUser", body, operatorLog{Endpoint: "creditUser", Status: "OK", BodyOut: out})
	writeOperatorJSON(w, out)
}

// RollbackUser reverses a previously-applied sportsbook stake. Oddin uses this
// for ticket cancellations, voided bets, and timeout-induced reversals. We
// accept either a `referenceTransactionId` (the original debit) or the same
// `transactionId` field; the rollback ledger row carries its own deterministic
// idempotency key so a duplicate webhook is a no-op.
func (h *OperatorHandler) RollbackUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := readJSONBody(r)

	uid, sessionCcy, ok, errResp := h.resolveSession(ctx, body)
	if !ok {
		h.logRequest(ctx, "rollbackUser", body, operatorLog{Endpoint: "rollbackUser", Status: "REJECT", BodyOut: errResp})
		writeOperatorJSON(w, errResp)
		return
	}
	bodyUserID := extractStringField(body, "userId", "playerId")
	if bodyUserID != "" && !strings.EqualFold(bodyUserID, uid) {
		out := errorBody(ErrCodeAuthFailed, "session/user mismatch")
		h.logRequest(ctx, "rollbackUser", body, operatorLog{Endpoint: "rollbackUser", Status: "REJECT_MISMATCH", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	txnID := extractStringField(body, "transactionId", "transaction_id", "txId")
	if txnID == "" {
		out := errorBody(ErrCodeInvalidParams, "transactionId required")
		h.logRequest(ctx, "rollbackUser", body, operatorLog{Endpoint: "rollbackUser", Status: "REJECT", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	refTxnID := extractStringField(body, "referenceTransactionId", "originalTransactionId", "originalTxId")
	if refTxnID == "" {
		// Some SDK builds reuse the rollback's own id as the reference.
		refTxnID = txnID
	}
	ticketID := extractStringField(body, "ticketId", "ticket_id", "betId", "bet_id")
	amount, hasAmount := extractAmountMinor(body, "amount", "amountMinor")
	if !hasAmount {
		// Best-effort: if Oddin omits the amount we look it up from the original
		// debit so rollback magnitudes stay tied to the ledger and not the
		// (potentially inflated) request body.
		var inferred int64
		if h.Pool != nil {
			origIdem := fmt.Sprintf("oddin:sportsbook:debit:%s", refTxnID)
			_ = h.Pool.QueryRow(ctx, `
				SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE idempotency_key = $1
			`, origIdem).Scan(&inferred)
			if inferred < 0 {
				inferred = -inferred
			}
		}
		amount = inferred
	}
	if amount <= 0 {
		// Treat as best-effort no-op acknowledgement; we cannot post a zero
		// rollback into the ledger but we owe Oddin a 200 with current
		// balance so it can mark its own transaction settled.
		bal, _ := ledger.BalanceMinor(ctx, h.Pool, uid)
		out := map[string]any{
			"errorCode":     ErrCodeOK,
			"userId":        uid,
			"transactionId": txnID,
			"currency":      sessionCcy,
			"balance":       bal,
		}
		h.logRequest(ctx, "rollbackUser", body, operatorLog{Endpoint: "rollbackUser", Status: "NOOP", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	ccy := strings.TrimSpace(strings.ToUpper(extractStringField(body, "currency")))
	if ccy == "" {
		ccy = sessionCcy
	}

	bal, _, err := applyOddinSeamless(ctx, h.Pool, uid, ccy, "rollback", txnID, ticketID, amount)
	if err != nil {
		slog.ErrorContext(ctx, "oddin_rollback_failed", "err", err, "txn", txnID)
		out := errorBody(ErrCodeInvalidParams, "operator processing error")
		h.logRequest(ctx, "rollbackUser", body, operatorLog{Endpoint: "rollbackUser", Status: "ERROR", BodyOut: out})
		writeOperatorJSON(w, out)
		return
	}
	out := map[string]any{
		"errorCode":     ErrCodeOK,
		"userId":        uid,
		"transactionId": txnID,
		"currency":      ccy,
		"balance":       bal,
	}
	h.logRequest(ctx, "rollbackUser", body, operatorLog{Endpoint: "rollbackUser", Status: "OK", BodyOut: out})
	writeOperatorJSON(w, out)
}

// applyOddinSeamless wraps a single sportsbook ledger movement (debit / credit
// / rollback) in one transaction with a row-level user lock. This mirrors
// applyBOSeamless for casino so we get the same correctness guarantees:
//   - balance reads happen under FOR UPDATE so concurrent stakes can't race
//   - ledger writes carry deterministic idempotency keys derived from the
//     provider transactionId, so duplicate Oddin retries are no-ops
//   - the returned balance is computed AFTER the write and AFTER the commit
//     so Oddin gets the post-state and not a stale snapshot
func applyOddinSeamless(ctx context.Context, pool *pgxpool.Pool, userID, ccy, action, txnID, ticketID string, amount int64) (int64, string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, "ERROR", err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, userID); err != nil {
		return 0, "ERROR", err
	}

	bal, err := ledger.BalanceMinorTx(ctx, tx, userID)
	if err != nil {
		return 0, "ERROR", err
	}

	meta := map[string]any{
		"provider":       "ODDIN",
		"transaction_id": txnID,
		"ticket_id":      ticketID,
	}

	switch action {
	case "debit":
		if bal < amount {
			return bal, "INSUFFICIENT", nil
		}
		idem := fmt.Sprintf("oddin:sportsbook:debit:%s", txnID)
		if _, err := ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, ledger.EntryTypeSportsbookDebit, idem, amount, ledger.PocketCash, meta); err != nil {
			return bal, "ERROR", err
		}
	case "credit":
		idem := fmt.Sprintf("oddin:sportsbook:credit:%s", txnID)
		if amount == 0 {
			// Oddin does send zero-amount settlements for losing tickets so the
			// ticket lifecycle is closed in their system. Record a non-balance
			// audit ledger row so the trace is preserved without moving funds.
			if _, err := ledger.RecordNonBalanceEvent(ctx, pool, userID, ccy, ledger.EntryTypeSportsbookCredit, idem, meta); err != nil {
				return bal, "ERROR", err
			}
		} else {
			if _, err := ledger.ApplyCreditTx(ctx, tx, userID, ccy, ledger.EntryTypeSportsbookCredit, idem, amount, meta); err != nil {
				return bal, "ERROR", err
			}
		}
	case "rollback":
		idem := fmt.Sprintf("oddin:sportsbook:rollback:%s", txnID)
		if _, err := ledger.ApplyCreditTx(ctx, tx, userID, ccy, ledger.EntryTypeSportsbookRollback, idem, amount, meta); err != nil {
			return bal, "ERROR", err
		}
	default:
		return bal, "ERROR", fmt.Errorf("oddin seamless: unknown action %q", action)
	}

	bal, err = ledger.BalanceMinorTx(ctx, tx, userID)
	if err != nil {
		return 0, "ERROR", err
	}
	if err := tx.Commit(ctx); err != nil {
		return bal, "ERROR", err
	}
	return bal, "OK", nil
}

// DebitUserStub — Deprecated: kept as alias so older route registrations compile.
// Prefer DebitUser. Will be removed once cmd/api routes use the canonical handlers.
//
// Deprecated: use DebitUser.
func (h *OperatorHandler) DebitUserStub(w http.ResponseWriter, r *http.Request) {
	h.DebitUser(w, r)
}

// CreditUserStub — Deprecated: alias for CreditUser. Use CreditUser directly.
//
// Deprecated: use CreditUser.
func (h *OperatorHandler) CreditUserStub(w http.ResponseWriter, r *http.Request) {
	h.CreditUser(w, r)
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
