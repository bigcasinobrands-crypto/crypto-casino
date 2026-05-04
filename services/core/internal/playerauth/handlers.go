package playerauth

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/captcha"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/playercookies"
)

type Handler struct {
	Svc       *Service
	Captcha   *captcha.Turnstile
	CookieCfg *config.Config // When PlayerCookieAuth, sets httpOnly cookies; nil skips cookies.
}

// sessionPersistUserMsg explains session_failed from wrapped Postgres errors (migrations, RLS, pooler).
func sessionPersistUserMsg(err error, refresh bool) string {
	intro := "Could not start your session. "
	if refresh {
		intro = "Could not refresh your session. "
	}
	if err == nil {
		return intro + "See deploy logs."
	}
	l := strings.ToLower(err.Error())
	switch {
	case strings.Contains(l, "does not exist") && strings.Contains(l, "column"),
		strings.Contains(l, "undefined column"),
		strings.Contains(l, "42703"): // undefined_column
		return intro + "The database is missing player_sessions columns — apply migration 00063 to the same DB as your API. Options: (1) From repo root with DATABASE_URL set: npm run migrate:core (2) Paste services/core/scripts/supabase-player-sessions-fix.sql into Supabase SQL Editor. Deploy logs have the exact error."
	case strings.Contains(l, "does not exist") && strings.Contains(l, "relation"):
		return intro + "Expected table missing — DATABASE_URL may point at the wrong database/schema. Confirm Render DATABASE_URL matches Supabase Settings → Database → URI (same project as production). See deploy logs."
	case strings.Contains(l, "row-level security"), strings.Contains(l, "violates row-level"):
		return intro + "Row-level security blocked the insert. On Supabase, set Core DATABASE_URL to the direct Postgres host (db.<project>.supabase.co:5432 with sslmode=require), not only the transaction pooler. See deploy logs."
	case strings.Contains(l, "permission denied"):
		return intro + "Database permission denied — check DATABASE_URL user/password matches Supabase and migrations applied. See deploy logs."
	case strings.Contains(l, "jwt") || strings.Contains(l, "private key") || strings.Contains(l, "sign player") || strings.Contains(l, "jwtrsakeyfile"):
		return intro + "JWT token signing failed — check JWT_RSA_PRIVATE_KEY_FILE / player signing config on Render. See deploy logs."
	case strings.Contains(l, "connection refused") || strings.Contains(l, "no such host") || strings.Contains(l, "timeout") && strings.Contains(l, "dial") || strings.Contains(l, "tls") || strings.Contains(l, "ssl") && strings.Contains(l, "handshake"):
		return intro + "Database connection failed — verify DATABASE_URL host/port, `?sslmode=require` for Supabase, and that Render can reach the DB (not blocked). See deploy logs."
	default:
		return intro + "Check Render Core logs for the line `playerauth: login session persist:` (full Postgres/JWT error). Usual fixes: run supabase-player-sessions-fix.sql in Supabase; set DATABASE_URL to `db.*.supabase.co:5432/...?sslmode=require`; unset SKIP_DB_MIGRATIONS_ON_START; ensure a player `users` row exists (use Register if needed)."
	}
}

type regReq struct {
	Email         string `json:"email"`
	Password      string `json:"password"`
	Username      string `json:"username"`
	AcceptTerms   bool   `json:"accept_terms"`
	AcceptPrivacy bool   `json:"accept_privacy"`
	CaptchaToken  string `json:"captcha_token"`
	// Fingerprint Pro (optional) — enriches player_sessions for admin + Settings.
	FingerprintRequestID string `json:"fingerprint_request_id"`
	FingerprintVisitorID string `json:"fingerprint_visitor_id"`
}

type loginReq struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	CaptchaToken string `json:"captcha_token"`
	FingerprintRequestID string `json:"fingerprint_request_id"`
	FingerprintVisitorID string `json:"fingerprint_visitor_id"`
}

type refreshReq struct {
	RefreshToken         string `json:"refresh_token"`
	FingerprintRequestID string `json:"fingerprint_request_id"`
	FingerprintVisitorID string `json:"fingerprint_visitor_id"`
}

type tokenRes struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

type verifyEmailReq struct {
	Token string `json:"token"`
}

type forgotReq struct {
	Email string `json:"email"`
}

type resetReq struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func requestIP(r *http.Request) string {
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip = strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	return ip
}

func sessionContextFromRequest(r *http.Request, fpReq, fpVid string) *SessionContext {
	return &SessionContext{
		IP:                   requestIP(r),
		UserAgent:            r.UserAgent(),
		GeoCountryHeader:     r.Header.Get("X-Geo-Country"),
		FingerprintRequestID: strings.TrimSpace(fpReq),
		FingerprintVisitorID: strings.TrimSpace(fpVid),
	}
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body regReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if h.Captcha != nil && h.Captcha.Required() {
		if err := h.Captcha.Verify(r.Context(), body.CaptchaToken, requestIP(r)); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "captcha_failed", "captcha verification failed")
			return
		}
	}
	sc := sessionContextFromRequest(r, body.FingerprintRequestID, body.FingerprintVisitorID)
	access, refresh, exp, err := h.Svc.Register(r.Context(), body.Email, body.Password, body.Username, body.AcceptTerms, body.AcceptPrivacy, sc)
	if err != nil {
		if errors.Is(err, ErrTermsNotAccepted) {
			playerapi.WriteError(w, http.StatusBadRequest, "terms_required", "you must accept the terms and privacy policy")
			return
		}
		if errors.Is(err, ErrWeakPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "weak_password", "password must be at least 12 characters with letters and numbers")
			return
		}
		if errors.Is(err, ErrPwnedPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "password_breached", "this password appears in known data breaches; choose a different one")
			return
		}
		if errors.Is(err, ErrUsernameTaken) {
			playerapi.WriteError(w, http.StatusConflict, "username_taken", "this username is already taken")
			return
		}
		if errors.Is(err, ErrInvalidUsername) {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_username", "username must be 3-20 characters, letters/numbers/underscores only")
			return
		}
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusConflict, "register_failed", "email may already be in use")
			return
		}
		if errors.Is(err, ErrSessionPersist) {
			log.Printf("playerauth: register session persist: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "session_failed", sessionPersistUserMsg(err, false))
			return
		}
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "register failed")
		return
	}
	writeTokens(w, h, access, refresh, exp)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body loginReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if h.Captcha != nil && h.Captcha.Required() {
		if err := h.Captcha.Verify(r.Context(), body.CaptchaToken, requestIP(r)); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "captcha_failed", "captcha verification failed")
			return
		}
	}
	sc := sessionContextFromRequest(r, body.FingerprintRequestID, body.FingerprintVisitorID)
	access, refresh, exp, err := h.Svc.Login(r.Context(), body.Email, body.Password, sc)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
			return
		}
		if errors.Is(err, ErrSessionPersist) {
			log.Printf("playerauth: login session persist: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "session_failed", sessionPersistUserMsg(err, false))
			return
		}
		log.Printf("playerauth: login failed: %v", err)
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "login failed")
		return
	}
	writeTokens(w, h, access, refresh, exp)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body refreshReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	rt := strings.TrimSpace(body.RefreshToken)
	if rt == "" && h.CookieCfg != nil && h.CookieCfg.PlayerCookieAuth {
		rt = playercookies.RefreshFromCookie(r)
	}
	sc := sessionContextFromRequest(r, body.FingerprintRequestID, body.FingerprintVisitorID)
	access, refresh, exp, err := h.Svc.Refresh(r.Context(), rt, sc)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusUnauthorized, "invalid_refresh", "invalid or expired refresh token")
			return
		}
		if errors.Is(err, ErrSessionPersist) {
			log.Printf("playerauth: refresh session persist: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "session_failed", sessionPersistUserMsg(err, true))
			return
		}
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "refresh failed")
		return
	}
	writeTokens(w, h, access, refresh, exp)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	h.Svc.RevokeAccessJTI(r.Context(), r.Header.Get("Authorization"))
	if h.CookieCfg != nil && h.CookieCfg.PlayerCookieAuth {
		if raw := playercookies.AccessFromCookie(r); raw != "" {
			h.Svc.RevokeAccessRaw(r.Context(), raw)
		}
	}
	var body refreshReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	rt := strings.TrimSpace(body.RefreshToken)
	if rt == "" && h.CookieCfg != nil && h.CookieCfg.PlayerCookieAuth {
		rt = playercookies.RefreshFromCookie(r)
	}
	if err := h.Svc.Logout(r.Context(), rt); err != nil {
		playerapi.WriteError(w, http.StatusUnauthorized, "invalid_token", "invalid refresh token")
		return
	}
	if h.CookieCfg != nil {
		playercookies.ClearAuth(w, h.CookieCfg)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	p, err := h.Svc.MeProfile(r.Context(), id)
	if err != nil {
		playerapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	verified := p.EmailVerifiedAt != nil
	var verifiedAt any
	if p.EmailVerifiedAt != nil {
		verifiedAt = p.EmailVerifiedAt.UTC().Format(time.RFC3339)
	} else {
		verifiedAt = nil
	}
	w.Header().Set("Content-Type", "application/json")
	out := map[string]any{
		"id":                p.ID,
		"participant_id":    p.PublicParticipantID,
		"email":             p.Email,
		"created_at":        p.CreatedAt.UTC().Format(time.RFC3339),
		"email_verified":    verified,
		"email_verified_at": verifiedAt,
	}
	if p.Username != nil {
		out["username"] = *p.Username
	}
	if p.AvatarURL != nil {
		out["avatar_url"] = *p.AvatarURL
	}
	if p.VIPTierID != nil {
		out["vip_tier_id"] = *p.VIPTierID
	}
	if p.VIPTierName != nil && *p.VIPTierName != "" {
		out["vip_tier"] = *p.VIPTierName
	}
	_ = json.NewEncoder(w).Encode(out)
}

func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	list, err := h.Svc.ListSessions(r.Context(), id)
	if err != nil {
		log.Printf("playerauth: list sessions: %v", err)
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not load sessions")
		return
	}
	if list == nil {
		list = []map[string]any{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"sessions": list})
}

func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if err := h.Svc.ResendVerificationEmail(r.Context(), id); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not send email")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var body verifyEmailReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := h.Svc.ConfirmVerificationToken(r.Context(), body.Token); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_token", "invalid or expired verification link")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body forgotReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	_ = h.Svc.RequestPasswordReset(r.Context(), body.Email)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body resetReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := h.Svc.ResetPassword(r.Context(), body.Token, body.Password); err != nil {
		if errors.Is(err, ErrWeakPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "weak_password", "password must be at least 12 characters with letters and numbers")
			return
		}
		if errors.Is(err, ErrPwnedPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "password_breached", "this password appears in known data breaches; choose a different one")
			return
		}
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_token", "invalid or expired reset link")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var body struct {
		Username *string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if body.Username != nil {
		u := strings.TrimSpace(*body.Username)
		if err := h.Svc.UpdateUsername(r.Context(), id, u); err != nil {
			if errors.Is(err, ErrUsernameTaken) {
				playerapi.WriteError(w, http.StatusConflict, "username_taken", "this username is already taken")
				return
			}
			if errors.Is(err, ErrInvalidUsername) {
				playerapi.WriteError(w, http.StatusBadRequest, "invalid_username", "username must be 3-20 characters, letters/numbers/underscores only")
				return
			}
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "update failed")
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if body.CurrentPassword == "" || body.NewPassword == "" {
		playerapi.WriteError(w, http.StatusBadRequest, "missing_fields", "current and new password required")
		return
	}
	if err := h.Svc.ChangePassword(r.Context(), id, body.CurrentPassword, body.NewPassword); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusUnauthorized, "wrong_password", "current password is incorrect")
			return
		}
		if errors.Is(err, ErrWeakPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "weak_password", "password must be at least 12 characters with letters and numbers")
			return
		}
		if errors.Is(err, ErrPwnedPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "password_breached", "this password appears in known data breaches; choose a different one")
			return
		}
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not change password")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	prefs, err := h.Svc.GetPreferences(r.Context(), id)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not load preferences")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(prefs)
}

func (h *Handler) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := h.Svc.UpdatePreferences(r.Context(), id, patch); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not save preferences")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) RedeemPromo(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := h.Svc.RedeemPromo(r.Context(), id, body.Code); err != nil {
		if errors.Is(err, ErrPromoAlreadyUsed) {
			playerapi.WriteError(w, http.StatusConflict, "already_used", "you have already used this promo code")
			return
		}
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_code", "invalid promo code")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	id, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20) // 2 MB
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "too_large", "file must be under 2 MB")
		return
	}
	file, hdr, err := r.FormFile("avatar")
	if err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "missing_file", "avatar file required")
		return
	}
	defer file.Close()

	url, err := h.Svc.SaveAvatar(r.Context(), id, file, hdr.Filename)
	if err != nil {
		log.Printf("avatar upload error for user %s: %v", id, err)
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not save avatar")
		return
	}
	log.Printf("avatar saved for user %s: %s", id, url)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"avatar_url": url})
}

func writeTokens(w http.ResponseWriter, h *Handler, access, refresh string, exp int64) {
	expIn := int64(900)
	if h != nil && h.Svc != nil && h.Svc.Issuer != nil {
		expIn = h.Svc.Issuer.PlayerAccessTTLSeconds()
	}
	if h != nil && h.CookieCfg != nil {
		playercookies.SetAuth(w, access, refresh, exp, h.CookieCfg)
		if err := playercookies.SetCSRF(w, h.CookieCfg); err != nil {
			log.Printf("playerauth: csrf cookie: %v", err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	at, rt := access, refresh
	if h != nil && h.CookieCfg != nil && h.CookieCfg.PlayerCookieAuth && h.CookieCfg.PlayerCookieOmitJSONTokens {
		at, rt = "", ""
	}
	_ = json.NewEncoder(w).Encode(tokenRes{
		AccessToken:  at,
		RefreshToken: rt,
		ExpiresAt:    exp,
		ExpiresIn:    expIn,
		TokenType:    "Bearer",
	})
}
