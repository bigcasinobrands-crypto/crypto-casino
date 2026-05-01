package staffauth

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/adminops"
	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	Svc *Service
	Ops *adminops.Handler
	WA  *webauthn.WebAuthn
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenRes struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

type meRes struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (h *Handler) Mount(r chi.Router, iss *jwtissuer.Issuer, rev *jtiredis.Revoker) {
	r.Post("/auth/login", h.Login)
	r.Post("/auth/mfa/webauthn/begin", h.WebAuthnMFABegin)
	r.Post("/auth/mfa/webauthn/finish", h.WebAuthnMFAFinish)
	r.Post("/auth/refresh", h.Refresh)
	r.Post("/auth/logout", h.Logout)
	r.Group(func(r chi.Router) {
		r.Use(adminapi.BearerMiddleware(iss, rev))
		r.Post("/auth/webauthn/register/begin", h.WebAuthnRegisterBegin)
		r.Post("/auth/webauthn/register/finish", h.WebAuthnRegisterFinish)
		r.Get("/auth/webauthn/credentials", h.WebAuthnListCredentials)
		r.Get("/me", h.Me)
	})
	r.Group(func(r chi.Router) {
		r.Use(adminapi.BearerMiddleware(iss, rev))
		ops := h.Ops
		if ops == nil {
			ops = &adminops.Handler{Pool: h.Svc.Pool}
		}
		ops.Mount(r)
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body loginReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip = xff
	}
	access, refresh, exp, err := h.Svc.Login(r.Context(), body.Email, body.Password, ip)
	if err != nil {
		var mfa *NeedMFAError
		if errors.As(err, &mfa) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"mfa_required": true,
				"mfa_token":    mfa.MFAToken,
			})
			return
		}
		if errors.Is(err, ErrMFAEnforcedNoCredential) {
			adminapi.WriteError(w, http.StatusForbidden, "mfa_not_enrolled", err.Error())
			return
		}
		if errors.Is(err, ErrInvalidCredentials) {
			adminapi.WriteError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "login failed")
		return
	}
	expIn := int64(900)
	if h.Svc != nil && h.Svc.Issuer != nil {
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

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body refreshReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	access, refresh, exp, err := h.Svc.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			adminapi.WriteError(w, http.StatusUnauthorized, "invalid_refresh", "invalid or expired refresh token")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "refresh failed")
		return
	}
	expIn := int64(900)
	if h.Svc != nil && h.Svc.Issuer != nil {
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

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	h.Svc.RevokeAccessJTI(r.Context(), r.Header.Get("Authorization"))
	var body refreshReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := h.Svc.Logout(r.Context(), body.RefreshToken); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			adminapi.WriteError(w, http.StatusUnauthorized, "invalid_token", "invalid refresh token")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "logout failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	id, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff context")
		return
	}
	email, role, err := h.Svc.Me(r.Context(), id)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "staff user not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(meRes{Email: email, Role: role})
}
