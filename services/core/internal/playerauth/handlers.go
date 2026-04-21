package playerauth

import (
	"encoding/json"
	"errors"
	"log"
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
	Username       string `json:"username"`
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
	access, refresh, exp, err := h.Svc.Register(r.Context(), body.Email, body.Password, body.Username, body.AcceptTerms, body.AcceptPrivacy)
	if err != nil {
		if errors.Is(err, ErrTermsNotAccepted) {
			playerapi.WriteError(w, http.StatusBadRequest, "terms_required", "you must accept the terms and privacy policy")
			return
		}
		if errors.Is(err, ErrWeakPassword) {
			playerapi.WriteError(w, http.StatusBadRequest, "weak_password", "password must be at least 12 characters with letters and numbers")
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
	out := map[string]any{
		"id":                 p.ID,
		"email":              p.Email,
		"created_at":         p.CreatedAt.UTC().Format(time.RFC3339),
		"email_verified":     verified,
		"email_verified_at":  verifiedAt,
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
