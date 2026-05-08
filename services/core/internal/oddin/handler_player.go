package oddin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler handles Oddin-related player routes (iframe token, client-side event ingest).
type Handler struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config
}

func hashOpaqueToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// PublicConfig serves GET /v1/sportsbook/oddin/public-config — public; same values as player VITE_ODDIN_* when the operator configures Oddin only on core.
func (h *Handler) PublicConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.Cfg == nil || !h.Cfg.OddinIntegrationEnabled() {
		playerapi.WriteError(w, http.StatusNotFound, "oddin_disabled", "oddin integration is disabled")
		return
	}
	bt := strings.TrimSpace(h.Cfg.OddinBrandTokenPublic)
	bu := strings.TrimSpace(h.Cfg.OddinPublicBaseURL)
	su := strings.TrimSpace(h.Cfg.OddinPublicScriptURL)
	if bt == "" || bu == "" || su == "" {
		playerapi.WriteError(w, http.StatusNotFound, "oddin_incomplete", "Set ODDIN_BRAND_TOKEN, ODDIN_PUBLIC_BASE_URL, and ODDIN_PUBLIC_SCRIPT_URL on core")
		return
	}
	if u, err := url.Parse(su); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		playerapi.WriteError(w, http.StatusInternalServerError, "oddin_config", "ODDIN_PUBLIC_SCRIPT_URL is not a valid absolute URL")
		return
	}
	if u, err := url.Parse(bu); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		playerapi.WriteError(w, http.StatusInternalServerError, "oddin_config", "ODDIN_PUBLIC_BASE_URL is not a valid absolute URL")
		return
	}
	out := map[string]any{
		"brand_token":      bt,
		"base_url":         bu,
		"script_url":       su,
		"env":              h.Cfg.OddinEnvLabel(),
		"default_language": h.Cfg.OddinDefaultLanguage,
		"default_currency": h.Cfg.OddinDefaultCurrency,
		"dark_mode":        h.Cfg.OddinDarkMode,
	}
	if th := strings.TrimSpace(h.Cfg.OddinTheme); th != "" {
		out["theme"] = th
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

type sessionTokenReq struct {
	Currency string `json:"currency"`
	Language string `json:"language"`
}

type sessionTokenResp struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
	UserID    string `json:"userId"`
	Currency  string `json:"currency"`
	Language  string `json:"language"`
}

// SessionToken issues an opaque iframe token for the authenticated player.
//
// Hygiene guarantees:
//   - Single ACTIVE session per (user, ODDIN) at any time. Issuing a new token
//     atomically REVOKEs all prior ACTIVE rows for the same user before the
//     INSERT. Without this, every page-load could spawn a new token and old
//     tokens stayed valid forever — a free credential-leak vector.
//   - The session row records the country (resolved best-effort from the most
//     recent traffic_sessions row) and issuance IP, so userDetails can answer
//     Oddin's iframe with the player's actual country instead of the hard-coded "US"
//     placeholder, and so incident response can correlate fraud back to a
//     concrete network.
func (h *Handler) SessionToken(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil || h.Cfg == nil {
		playerapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "service unavailable")
		return
	}
	if !h.Cfg.OddinIntegrationEnabled() {
		playerapi.WriteError(w, http.StatusNotFound, "oddin_disabled", "oddin integration is disabled")
		return
	}
	uid, ok := playerapi.UserIDFromContext(r.Context())
	if !ok || strings.TrimSpace(uid) == "" {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "sign in required")
		return
	}
	var body sessionTokenReq
	if r.Body != nil {
		b, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
		_ = json.Unmarshal(b, &body)
	}
	ccy := strings.TrimSpace(strings.ToUpper(body.Currency))
	if ccy == "" {
		ccy = "USD"
	}
	lang := strings.TrimSpace(body.Language)
	if lang == "" {
		lang = "en"
	}
	ttl := h.Cfg.OddinTokenTTLSeconds
	if ttl <= 0 {
		ttl = 2592000
	}
	exp := time.Now().UTC().Add(time.Duration(ttl) * time.Second)

	var tokBytes [32]byte
	if _, err := rand.Read(tokBytes[:]); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "token_failed", "could not issue token")
		return
	}
	plain := hex.EncodeToString(tokBytes[:])
	th := hashOpaqueToken(plain)

	ctx := r.Context()
	var country string
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(upper(btrim(ts.country_iso2)), ''), '')
		FROM traffic_sessions ts
		WHERE ts.user_id = $1::uuid
		ORDER BY ts.last_at DESC
		LIMIT 1
	`, uid).Scan(&country)
	country = strings.TrimSpace(strings.ToUpper(country))
	if len(country) != 2 {
		country = ""
	}
	if country == "" {
		country = h.Cfg.OddinFallbackCountryISO2()
	}

	clientIP := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if i := strings.IndexByte(clientIP, ','); i > 0 {
		clientIP = strings.TrimSpace(clientIP[:i])
	}
	if clientIP == "" {
		clientIP = strings.TrimSpace(r.RemoteAddr)
		if i := strings.LastIndexByte(clientIP, ':'); i > 0 {
			clientIP = strings.TrimSpace(clientIP[:i])
		}
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not start transaction")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	if _, err := tx.Exec(ctx, `
		UPDATE sportsbook_sessions SET status = 'REVOKED'
		WHERE user_id = $1::uuid AND provider = 'ODDIN' AND status = 'ACTIVE'
	`, uid); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not revoke prior session")
		return
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO sportsbook_sessions (user_id, provider, token_hash, currency, language, country, ip_at_issue, expires_at, status)
VALUES ($1::uuid, 'ODDIN', $2, $3, $4, NULLIF($5, ''), NULLIF($6, '')::inet, $7, 'ACTIVE')
`, uid, th, ccy, lang, country, clientIP, exp); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not persist session")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not commit session")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sessionTokenResp{
		Token:     plain,
		ExpiresAt: exp.UTC().Format(time.RFC3339),
		UserID:    uid,
		Currency:  ccy,
		Language:  lang,
	})
}

type clientEventReq struct {
	EventType string         `json:"event_type"`
	Action    string         `json:"action"`
	Route     string         `json:"route"`
	Payload   map[string]any `json:"payload"`
}

// ClientEvent stores iframe/client analytics for admin diagnostics (optional auth).
func (h *Handler) ClientEvent(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		playerapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "service unavailable")
		return
	}
	var body clientEventReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	et := strings.TrimSpace(body.EventType)
	if et == "" {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_event", "event_type required")
		return
	}
	var uid *uuid.UUID
	if s, ok := playerapi.UserIDFromContext(r.Context()); ok {
		if u, err := uuid.Parse(s); err == nil {
			uid = &u
		}
	}
	payload := body.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	raw, _ := json.Marshal(payload)

	ctx := r.Context()
	var uidArg any
	if uid != nil {
		uidArg = *uid
	}
	_, err := h.Pool.Exec(ctx, `
INSERT INTO sportsbook_iframe_events (user_id, provider, event_type, action, route, payload)
VALUES ($1, 'ODDIN', $2, NULLIF($3,''), NULLIF($4,''), COALESCE($5::jsonb, '{}'::jsonb))
`, uidArg, truncate(et, 128), truncate(body.Action, 256), truncate(body.Route, 512), raw)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not store event")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// --- Admin ---

// IntegrationStatusJSON returns non-secret Oddin integration diagnostics for admin UI.
func IntegrationStatusJSON(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config) (map[string]any, error) {
	out := map[string]any{
		"enabled":              cfg != nil && cfg.OddinIntegrationEnabled(),
		"environment":          "",
		"script_url_configured": false,
		"base_url_configured":   false,
		"brand_token_configured": false,
	}
	if cfg == nil {
		return out, nil
	}
	out["environment"] = cfg.OddinEnvLabel()
	out["script_url_configured"] = strings.TrimSpace(cfg.OddinPublicScriptURL) != ""
	out["base_url_configured"] = strings.TrimSpace(cfg.OddinPublicBaseURL) != ""
	out["brand_token_configured"] = strings.TrimSpace(cfg.OddinBrandTokenPublic) != ""
	out["operator_api_key_configured"] = strings.TrimSpace(cfg.OddinAPISecurityKey) != ""
	out["hash_secret_configured"] = strings.TrimSpace(cfg.OddinHashSecret) != ""
	out["oddin_fallback_country_iso2"] = cfg.OddinFallbackCountryISO2()
	if su := strings.TrimSpace(cfg.OddinPublicScriptURL); su != "" {
		out["script_url"] = su
	}
	if bu := strings.TrimSpace(cfg.OddinPublicBaseURL); bu != "" {
		out["base_url"] = bu
	}

	if pool == nil {
		return out, nil
	}

	var loadedAt, errAt *time.Time
	_ = pool.QueryRow(ctx, `
SELECT MAX(created_at) FILTER (WHERE event_type = 'LOADED'),
       MAX(created_at) FILTER (WHERE event_type = 'ERROR')
FROM sportsbook_iframe_events WHERE provider = 'ODDIN'
`).Scan(&loadedAt, &errAt)
	if loadedAt != nil {
		out["last_iframe_loaded_at"] = loadedAt.UTC().Format(time.RFC3339)
	}
	if errAt != nil {
		out["last_iframe_error_at"] = errAt.UTC().Format(time.RFC3339)
	}

	var pageViews, signIn, refreshBal, analyticsCount int64
	_ = pool.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (WHERE event_type = 'LOADED'),
  COUNT(*) FILTER (WHERE event_type = 'REQUEST_SIGN_IN'),
  COUNT(*) FILTER (WHERE event_type = 'REQUEST_REFRESH_BALANCE'),
  COUNT(*) FILTER (WHERE event_type = 'ANALYTICS')
FROM sportsbook_iframe_events WHERE provider = 'ODDIN'
`).Scan(&pageViews, &signIn, &refreshBal, &analyticsCount)
	out["iframe_loaded_events"] = pageViews
	out["request_sign_in_events"] = signIn
	out["request_refresh_balance_events"] = refreshBal
	out["analytics_events"] = analyticsCount

	var opErrs int64
	_ = pool.QueryRow(ctx, `
SELECT COUNT(*) FROM sportsbook_provider_requests
WHERE provider = 'ODDIN' AND (status = 'ERROR' OR status = 'REJECT' OR error_code IS NOT NULL)
`).Scan(&opErrs)
	out["operator_endpoint_errors"] = opErrs
	out["esports_nav_configured"] = EsportsNavConfigured(cfg)

	return out, nil
}
