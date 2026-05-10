package playerkyc

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/kycaid"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SessionHandler POST /v1/kyc/kycaid/session — returns a KYCAID hosted form_url for the authenticated user.
func SessionHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			playerapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
			return
		}
		if cfg == nil || !cfg.KYCAIDEnabled || !cfg.KYCAIDConfigured() {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "kycaid_disabled", "Identity verification is not available.")
			return
		}
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok || strings.TrimSpace(uid) == "" {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		pub := strings.TrimRight(strings.TrimSpace(cfg.PublicPlayerURL), "/")
		if pub == "" {
			log.Printf("player kycaid session: PublicPlayerURL empty")
			playerapi.WriteError(w, http.StatusServiceUnavailable, "server_misconfigured", "Public profile URL is not configured.")
			return
		}

		ss := kycaid.LoadSettings(r.Context(), pool)
		formID := strings.TrimSpace(ss.FormID)
		if formID == "" {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "kycaid_form_missing", "Verification form is not configured yet.")
			return
		}

		redirectURL := redirectAfterKYCAID(pub, ss.RedirectPathAfterForm)

		var storedApplicant *string
		_ = pool.QueryRow(r.Context(), `SELECT kycaid_applicant_id FROM users WHERE id = $1::uuid`, uid).Scan(&storedApplicant)
		applicantID := ""
		if storedApplicant != nil {
			applicantID = strings.TrimSpace(*storedApplicant)
		}

		cl := &kycaid.Client{
			BaseURL: cfg.KYCAIDAPIBaseURL,
			Token:   cfg.KYCAIDAPIToken,
		}
		formBody := kycaid.FormURLRequest{
			ExternalApplicantID: uid,
			RedirectURL:         redirectURL,
		}
		if applicantID != "" {
			formBody.ApplicantID = applicantID
			formBody.ExternalApplicantID = ""
		}
		resp, err := cl.CreateFormURL(r.Context(), formID, formBody)
		if err != nil {
			log.Printf("player kycaid session: form url err=%v user=%s", err, uid)
			playerapi.WriteError(w, http.StatusBadGateway, "kycaid_upstream_error", "Could not start verification. Try again shortly.")
			return
		}

		vid := strings.TrimSpace(resp.VerificationID)
		if vid != "" {
			if _, err := pool.Exec(r.Context(), `
				UPDATE users SET
					kycaid_last_verification_id = $2,
					kyc_status = CASE WHEN COALESCE(kyc_status, 'none') IN ('none', 'rejected') THEN 'pending' ELSE kyc_status END,
					updated_at = now()
				WHERE id = $1::uuid
			`, uid, vid); err != nil {
				log.Printf("player kycaid session: persist verification id: %v", err)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"form_url":        resp.FormURL,
			"verification_id": resp.VerificationID,
			"test_mode":       ss.TestMode,
		})
	}
}

func redirectAfterKYCAID(publicBase, cfgPath string) string {
	p := strings.TrimSpace(cfgPath)
	if strings.HasPrefix(strings.ToLower(p), "http://") || strings.HasPrefix(strings.ToLower(p), "https://") {
		return p
	}
	base := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	if p == "" {
		p = "/profile?settings=verify"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return base + p
}
