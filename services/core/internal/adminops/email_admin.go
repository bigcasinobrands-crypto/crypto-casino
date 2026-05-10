package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/emailpolicy"
	"github.com/crypto-casino/core/internal/mail"
)

func (h *Handler) GetEmailStatus(w http.ResponseWriter, r *http.Request) {
	if h.Cfg == nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "config_missing", "server misconfigured")
		return
	}
	spec, err := emailpolicy.LoadTransactional(r.Context(), h.Pool)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "load email policy")
		return
	}
	fromAddr := strings.TrimSpace(h.Cfg.ResendFrom)
	if fromAddr == "" {
		fromAddr = strings.TrimSpace(h.Cfg.SMTPFrom)
	}
	backend := "disabled"
	if h.Mail != nil {
		backend = mail.BackendSummary(h.Mail)
	}
	writeJSON(w, map[string]any{
		"backend":             backend,
		"from_configured":     fromAddr != "",
		"from_masked_preview": maskEmailSender(fromAddr),
		"public_player_url":   strings.TrimRight(strings.TrimSpace(h.Cfg.PublicPlayerURL), "/"),
		"transactional":       spec,
		"mail_brand_site_name": strings.TrimSpace(h.Cfg.MailBrandSiteName),
		"resend_template_verify_configured":       strings.TrimSpace(h.Cfg.ResendTemplateVerifyEmail) != "",
		"resend_template_password_reset_configured": strings.TrimSpace(h.Cfg.ResendTemplatePasswordReset) != "",
	})
}

func maskEmailSender(from string) string {
	from = strings.TrimSpace(from)
	if from == "" {
		return ""
	}
	addr := from
	if lt := strings.LastIndex(from, "<"); lt >= 0 && strings.HasSuffix(from, ">") {
		addr = strings.TrimSpace(from[lt+1 : len(from)-1])
	}
	i := strings.LastIndex(addr, "@")
	if i <= 0 || i >= len(addr)-1 {
		return "(configured)"
	}
	local, domain := addr[:i], addr[i+1:]
	if len(local) <= 1 {
		return "*@" + domain
	}
	return local[:1] + "***@" + domain
}

func (h *Handler) PatchEmailTransactional(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body emailpolicy.TransactionalSpec
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	normalized := emailpolicy.Normalize(body)
	blob, err := json.Marshal(normalized)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_value", "cannot serialize")
		return
	}
	_, err = h.Pool.Exec(r.Context(), `
		INSERT INTO site_settings (key, value, updated_at, updated_by)
		VALUES ($1, $2, now(), $3::uuid)
		ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3::uuid
	`, emailpolicy.SettingKey, blob, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "upsert failed")
		return
	}
	meta, _ := json.Marshal(normalized)
	h.auditExec(r.Context(), "email.transactional.update", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'email.transactional.update', 'site_settings', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true, "transactional": normalized})
}

func (h *Handler) PostEmailTestSend(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	if h.Cfg == nil || h.Mail == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "mail_unavailable", "transactional mail is not configured (logging backend only)")
		return
	}
	var reqBody struct {
		Template string `json:"template"`
		To       string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	to := strings.TrimSpace(strings.ToLower(reqBody.To))
	if to == "" || !strings.Contains(to, "@") {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_email", "valid `to` address required")
		return
	}
	base := strings.TrimRight(strings.TrimSpace(h.Cfg.PublicPlayerURL), "/")
	brand := strings.TrimSpace(h.Cfg.MailBrandSiteName)
	if brand == "" {
		brand = "VybeBet"
	}
	switch strings.TrimSpace(strings.ToLower(reqBody.Template)) {
	case "verification", "verify":
		link := base + "/verify-email?token=ADMIN-TEST-DEMO-TOKEN-NOT-VALID"
		subj := "[TEST] " + emailpolicy.DefaultVerificationSubject
		txt := "This is a manual test from the admin console.\n\nThe link below is a demo placeholder — it will not verify an account:\n\n" + link + "\n\nExpires messaging does not apply to this demo.\n"
		tid := strings.TrimSpace(h.Cfg.ResendTemplateVerifyEmail)
		vars := map[string]string{
			mail.TemplateVarSiteName:        brand,
			mail.TemplateVarPreheader:       "[TEST] Verify your email",
			mail.TemplateVarPrimaryHeadline: "Confirm your email (test)",
			mail.TemplateVarPrimaryBody:     "This is a manual test from the admin console. The button/link below is a demo placeholder and will not verify an account.",
			mail.TemplateVarActionURL:       link,
			mail.TemplateVarButtonLabel:     "Verify email (demo)",
			mail.TemplateVarExpiryLine:      "Demo — expiry messaging does not apply.",
			mail.TemplateVarSecondaryNote:   "Safe to ignore.",
		}
		if sent, err := mail.TryResendPublishedTemplate(h.Mail, r.Context(), to, subj, tid, vars); err != nil {
			adminapi.WriteError(w, http.StatusBadGateway, "send_failed", err.Error())
			return
		} else if sent {
			break
		}
		if err := h.Mail.Send(r.Context(), to, subj, txt); err != nil {
			adminapi.WriteError(w, http.StatusBadGateway, "send_failed", err.Error())
			return
		}
	case "password_reset", "reset":
		link := base + "/reset-password?token=ADMIN-TEST-DEMO-TOKEN-NOT-VALID"
		subj := "[TEST] " + emailpolicy.DefaultPasswordResetSubject
		txt := "This is a manual test from the admin console.\n\nThe link below is a demo placeholder — it cannot reset a password:\n\n" + link + "\n\nReal resets always arrive from /forgot-password with a fresh token.\n"
		tid := strings.TrimSpace(h.Cfg.ResendTemplatePasswordReset)
		vars := map[string]string{
			mail.TemplateVarSiteName:        brand,
			mail.TemplateVarPreheader:       "[TEST] Password reset",
			mail.TemplateVarPrimaryHeadline: "Reset your password (test)",
			mail.TemplateVarPrimaryBody:     "This is a manual test from the admin console. The button/link below is a demo placeholder and cannot reset a password.",
			mail.TemplateVarActionURL:       link,
			mail.TemplateVarButtonLabel:     "Reset password (demo)",
			mail.TemplateVarExpiryLine:      "Demo — real links expire in 1 hour.",
			mail.TemplateVarSecondaryNote:   "Safe to ignore.",
		}
		if sent, err := mail.TryResendPublishedTemplate(h.Mail, r.Context(), to, subj, tid, vars); err != nil {
			adminapi.WriteError(w, http.StatusBadGateway, "send_failed", err.Error())
			return
		} else if sent {
			break
		}
		if err := h.Mail.Send(r.Context(), to, subj, txt); err != nil {
			adminapi.WriteError(w, http.StatusBadGateway, "send_failed", err.Error())
			return
		}
	default:
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_template", "template must be verification or password_reset")
		return
	}
	meta, _ := json.Marshal(map[string]string{"template": reqBody.Template, "to": to})
	h.auditExec(r.Context(), "email.test_send", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'email.test_send', 'email', $2)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}
