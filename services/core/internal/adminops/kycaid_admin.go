package adminops

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/compliance"
	"github.com/crypto-casino/core/internal/kycaid"
)

func (h *Handler) GetKYCAIDIntegrationStatus(w http.ResponseWriter, r *http.Request) {
	if h.Cfg == nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "config_missing", "server misconfigured")
		return
	}
	ctx := r.Context()
	ss := kycaid.LoadSettings(ctx, h.Pool)
	policy, err := compliance.LoadWithdrawKYCRiskPolicy(ctx, h.Pool)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "load withdraw policy")
		return
	}

	base := strings.TrimRight(strings.TrimSpace(h.Cfg.APIPublicBase), "/")
	webhookURL := ""
	if base != "" {
		webhookURL = base + "/v1/webhooks/kycaid"
	}

	var last sql.NullTime
	_ = h.Pool.QueryRow(ctx, `SELECT MAX(received_at) FROM kycaid_verification_events`).Scan(&last)
	var lastWebhook *string
	if last.Valid {
		s := last.Time.UTC().Format(time.RFC3339)
		lastWebhook = &s
	}

	writeJSON(w, map[string]any{
		"kycaid_enabled":             h.Cfg.KYCAIDEnabled,
		"api_token_configured":       h.Cfg.KYCAIDConfigured(),
		"api_token_masked_preview":   maskKYCAIDToken(h.Cfg.KYCAIDAPIToken),
		"webhook_callback_url":       webhookURL,
		"webhook_fail_closed":        h.Cfg.KYCAIDWebhookFailClosed,
		"withdraw_kyc_gate_dry_run":  h.Cfg.WithdrawKYCGateDryRun,
		"kycaid_settings":            ss,
		"withdraw_kyc_policy":        policy,
		"last_webhook_received_at":   lastWebhook,
	})
}

func maskKYCAIDToken(tok string) string {
	tok = strings.TrimSpace(tok)
	if tok == "" {
		return ""
	}
	if len(tok) <= 4 {
		return "****"
	}
	return "****" + tok[len(tok)-4:]
}

func (h *Handler) PatchKYCAIDSiteSettings(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body struct {
		TestMode              *bool   `json:"test_mode"`
		FormID                *string `json:"form_id"`
		RedirectPathAfterForm *string `json:"redirect_path_after_form"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	cur := kycaid.LoadSettings(r.Context(), h.Pool)
	if body.TestMode != nil {
		cur.TestMode = *body.TestMode
	}
	if body.FormID != nil {
		cur.FormID = strings.TrimSpace(*body.FormID)
	}
	if body.RedirectPathAfterForm != nil {
		cur.RedirectPathAfterForm = strings.TrimSpace(*body.RedirectPathAfterForm)
	}
	blob, err := json.Marshal(cur)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_value", "cannot serialize")
		return
	}
	_, err = h.Pool.Exec(r.Context(), `
		INSERT INTO site_settings (key, value, updated_at, updated_by)
		VALUES ($1, $2, now(), $3::uuid)
		ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3::uuid
	`, kycaid.SiteSettingKYCAID, blob, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "upsert failed")
		return
	}
	meta, _ := json.Marshal(cur)
	h.auditExec(r.Context(), "kycaid.settings.update", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'kycaid.settings.update', 'site_settings', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true, "kycaid_settings": cur})
}

func (h *Handler) PatchWithdrawKYCRiskPolicy(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body compliance.WithdrawKYCRiskPolicy
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if body.FirstWithdrawRiskWithinHours < 0 {
		body.FirstWithdrawRiskWithinHours = 0
	}
	if body.FirstWithdrawRiskAmountMinCents < 0 {
		body.FirstWithdrawRiskAmountMinCents = 0
	}
	if body.DailyWithdrawCountThreshold < 0 {
		body.DailyWithdrawCountThreshold = 0
	}
	if body.DailyWithdrawTotalTriggerCents < 0 {
		body.DailyWithdrawTotalTriggerCents = 0
	}
	blob, err := json.Marshal(body)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_value", "cannot serialize")
		return
	}
	_, err = h.Pool.Exec(r.Context(), `
		INSERT INTO site_settings (key, value, updated_at, updated_by)
		VALUES ($1, $2, now(), $3::uuid)
		ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3::uuid
	`, compliance.SiteSettingWithdrawKYCPolicy, blob, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "upsert failed")
		return
	}
	meta, _ := json.Marshal(body)
	h.auditExec(r.Context(), "withdraw_kyc_policy.update", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'withdraw_kyc_policy.update', 'site_settings', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true, "withdraw_kyc_policy": body})
}
