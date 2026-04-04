package playerauth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/captcha"
	"github.com/crypto-casino/core/internal/jwtplayer"
	"github.com/crypto-casino/core/internal/playerapi"
)

type Handler struct {
	Svc     *Service
	Captcha *captcha.Turnstile
}

type regReq struct {
	Email          string `json:"email"`
	Password       string `json:"password"`
	AcceptTerms    bool   `json:"accept_terms"`
	AcceptPrivacy  bool   `json:"accept_privacy"`
	CaptchaToken   string `json:"captcha_token"`
}

type loginReq struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	CaptchaToken string `json:"captcha_token"`
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

type tokenRes struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
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
	access, refresh, exp, err := h.Svc.Register(r.Context(), body.Email, body.Password, body.AcceptTerms, body.AcceptPrivacy)
	if err != nil {
		if errors.Is(err, ErrTermsNotAccepted) {
			playerapi.WriteError(w, http.StatusBadRequest, "terms_required", "you must accept the terms and privacy policy")
			return
		}
		if errors.Is(err, ErrWeakPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "weak_password", "password must be at least 12 characters with letters and numbers")
			return
		}
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusConflict, "register_failed", "email may already be in use")
			return
		}
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "register failed")
		return
	}
	writeTokens(w, access, refresh, exp)
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
	access, refresh, exp, err := h.Svc.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
			return
		}
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "login failed")
		return
	}
	writeTokens(w, access, refresh, exp)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body refreshReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	access, refresh, exp, err := h.Svc.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			playerapi.WriteError(w, http.StatusUnauthorized, "invalid_refresh", "invalid or expired refresh token")
			return
		}
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "refresh failed")
		return
	}
	writeTokens(w, access, refresh, exp)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	var body refreshReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := h.Svc.Logout(r.Context(), body.RefreshToken); err != nil {
		playerapi.WriteError(w, http.StatusUnauthorized, "invalid_token", "invalid refresh token")
		return
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
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":                 p.ID,
		"email":              p.Email,
		"created_at":         p.CreatedAt.UTC().Format(time.RFC3339),
		"email_verified":     verified,
		"email_verified_at":  verifiedAt,
	})
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
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_token", "invalid or expired reset link")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func writeTokens(w http.ResponseWriter, access, refresh string, exp int64) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(tokenRes{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    exp,
		ExpiresIn:    jwtplayer.AccessTTLSeconds(),
		TokenType:    "Bearer",
	})
}
