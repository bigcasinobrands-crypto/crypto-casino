package staffauth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/redis/go-redis/v9"
)

func webAuthnNotConfigured(w http.ResponseWriter) {
	adminapi.WriteError(w, http.StatusServiceUnavailable, "webauthn_not_configured", "set WEBAUTHN_RP_ID and WEBAUTHN_RP_ORIGINS")
}

func (h *Handler) WebAuthnRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if h.WA == nil {
		webAuthnNotConfigured(w)
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	user, err := loadStaffWebUser(r.Context(), h.Svc.Pool, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "load_error", "cannot load staff for webauthn")
		return
	}
	var excl []protocol.CredentialDescriptor
	for _, c := range user.credentials {
		excl = append(excl, c.Descriptor())
	}
	creation, session, err := h.WA.BeginRegistration(user, webauthn.WithExclusions(excl))
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "webauthn_begin_failed", err.Error())
		return
	}
	if h.Svc.Redis == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "redis_required", "redis required for webauthn sessions")
		return
	}
	sessKey := randomRedisKey()
	if err := redisSetJSON(r.Context(), h.Svc.Redis, redisKeyWAReg+sessKey, regRedisPayload{
		StaffID: staffID,
		Session: *session,
	}); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "session_store_failed", "redis")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"session_key": sessKey,
		"options":     creation,
	})
}

func (h *Handler) WebAuthnRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if h.WA == nil {
		webAuthnNotConfigured(w)
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	sessionKey := strings.TrimSpace(r.Header.Get("X-WebAuthn-Session-Key"))
	if sessionKey == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "X-WebAuthn-Session-Key header required")
		return
	}
	if h.Svc.Redis == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "redis_required", "redis required")
		return
	}
	payload, err := redisGetJSON[regRedisPayload](r.Context(), h.Svc.Redis, redisKeyWAReg+sessionKey)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_session", "session expired or unknown")
		return
	}
	if payload.StaffID != staffID {
		adminapi.WriteError(w, http.StatusForbidden, "session_mismatch", "")
		return
	}
	user, err := loadStaffWebUser(r.Context(), h.Svc.Pool, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "load_error", "")
		return
	}
	cred, err := h.WA.FinishRegistration(user, payload.Session, r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "webauthn_finish_failed", err.Error())
		return
	}
	credJSON, err := json.Marshal(cred)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "encode_error", "")
		return
	}
	_, err = h.Svc.Pool.Exec(r.Context(), `
		INSERT INTO staff_webauthn_credentials (staff_user_id, credential_id, credential_json)
		VALUES ($1::uuid, $2, $3::jsonb)
	`, staffID, cred.ID, credJSON)
	if err != nil {
		adminapi.WriteError(w, http.StatusConflict, "duplicate_credential", "credential may already exist")
		return
	}
	_ = h.Svc.Redis.Del(r.Context(), redisKeyWAReg+sessionKey).Err()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) WebAuthnListCredentials(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "")
		return
	}
	rows, err := h.Svc.Pool.Query(r.Context(), `
		SELECT encode(credential_id, 'hex'), created_at FROM staff_webauthn_credentials
		WHERE staff_user_id = $1::uuid ORDER BY created_at ASC
	`, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var idHex string
		var ct interface{}
		if err := rows.Scan(&idHex, &ct); err != nil {
			continue
		}
		out = append(out, map[string]any{"credential_id_hex": idHex, "created_at": ct})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"credentials": out})
}

func (h *Handler) WebAuthnMFABegin(w http.ResponseWriter, r *http.Request) {
	if h.WA == nil {
		webAuthnNotConfigured(w)
		return
	}
	var body struct {
		MFAToken string `json:"mfa_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MFAToken == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "mfa_token required")
		return
	}
	if h.Svc == nil || h.Svc.Redis == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "redis_required", "")
		return
	}
	pend, err := redisGetJSON[mfaPending](r.Context(), h.Svc.Redis, redisKeyStaffMFA+body.MFAToken)
	if err != nil {
		if errors.Is(err, redis.Nil) {
			adminapi.WriteError(w, http.StatusUnauthorized, "invalid_mfa_token", "")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "redis_error", "")
		return
	}
	user, err := loadStaffWebUser(r.Context(), h.Svc.Pool, pend.StaffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "no_credentials", "")
		return
	}
	assertion, session, err := h.WA.BeginLogin(user)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "webauthn_begin_failed", err.Error())
		return
	}
	sessKey := randomRedisKey()
	if err := redisSetJSON(r.Context(), h.Svc.Redis, redisKeyWAMFALogin+sessKey, mfaLoginRedisPayload{
		MFAToken: body.MFAToken,
		StaffID:  pend.StaffID,
		Role:     pend.Role,
		Session:  *session,
	}); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "session_store_failed", "")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"session_key": sessKey,
		"options":     assertion,
	})
}

func (h *Handler) WebAuthnMFAFinish(w http.ResponseWriter, r *http.Request) {
	if h.WA == nil {
		webAuthnNotConfigured(w)
		return
	}
	sessionKey := strings.TrimSpace(r.Header.Get("X-WebAuthn-Session-Key"))
	mfaTok := strings.TrimSpace(r.Header.Get("X-MFA-Token"))
	if sessionKey == "" || mfaTok == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "X-WebAuthn-Session-Key and X-MFA-Token headers required")
		return
	}
	if h.Svc == nil || h.Svc.Redis == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "redis_required", "")
		return
	}
	payload, err := redisGetJSON[mfaLoginRedisPayload](r.Context(), h.Svc.Redis, redisKeyWAMFALogin+sessionKey)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_session", "")
		return
	}
	if payload.MFAToken != mfaTok {
		adminapi.WriteError(w, http.StatusForbidden, "token_mismatch", "")
		return
	}
	user, err := loadStaffWebUser(r.Context(), h.Svc.Pool, payload.StaffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "load_error", "")
		return
	}
	_, err = h.WA.FinishLogin(user, payload.Session, r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "webauthn_finish_failed", err.Error())
		return
	}
	_ = h.Svc.Redis.Del(r.Context(), redisKeyWAMFALogin+sessionKey).Err()
	_ = h.Svc.Redis.Del(r.Context(), redisKeyStaffMFA+mfaTok).Err()

	requestIP := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		requestIP = xff
	}
	access, refresh, exp, err := h.Svc.issueStaffSession(r.Context(), payload.StaffID, payload.Role, requestIP)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	expIn := int64(900)
	if h.Svc.Issuer != nil {
		expIn = h.Svc.Issuer.StaffAccessTTLSeconds()
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(tokenRes{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    exp,
		ExpiresIn:    expIn,
		TokenType:    "Bearer",
	})
}
