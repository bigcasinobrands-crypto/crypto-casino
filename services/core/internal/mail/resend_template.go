package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Variable keys for published Resend templates (HTML uses triple braces: {{{SITE_NAME}}}).
// See https://resend.com/docs/dashboard/templates/template-variables
const (
	TemplateVarSiteName         = "SITE_NAME"
	TemplateVarPreheader        = "PREHEADER"
	TemplateVarPrimaryHeadline  = "PRIMARY_HEADLINE"
	TemplateVarPrimaryBody      = "PRIMARY_BODY"
	TemplateVarActionURL        = "ACTION_URL"
	TemplateVarButtonLabel      = "BUTTON_LABEL"
	TemplateVarExpiryLine       = "EXPIRY_LINE"
	TemplateVarSecondaryNote    = "SECONDARY_NOTE" // optional footer line (e.g. ignore-if-not-you)
)

const resendTemplateVarMaxRunes = 2000

func truncateResendTemplateVar(s string) string {
	if utf8.RuneCountInString(s) <= resendTemplateVarMaxRunes {
		return s
	}
	r := []rune(s)
	return string(r[:resendTemplateVarMaxRunes])
}

type resendTemplateBlock struct {
	ID        string            `json:"id"`
	Variables map[string]string `json:"variables"`
}

type resendTemplateSendBody struct {
	From     string              `json:"from"`
	To       []string            `json:"to"`
	Subject  string              `json:"subject,omitempty"`
	Template resendTemplateBlock `json:"template"`
}

// SendPublishedTemplate sends mail via a published Resend template (POST /emails with template object).
// templateID is the dashboard template id or alias. Subject/from override template defaults when provided.
// https://resend.com/docs/api-reference/emails/send-email
func (s *ResendSender) SendPublishedTemplate(ctx context.Context, to, subject, templateID string, variables map[string]string) error {
	if !s.Configured() {
		return fmt.Errorf("resend: not configured")
	}
	templateID = strings.TrimSpace(templateID)
	if templateID == "" {
		return fmt.Errorf("resend: empty template id")
	}
	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("resend: empty recipient")
	}
	vars := make(map[string]string, len(variables)+1)
	for k, v := range variables {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		vars[k] = truncateResendTemplateVar(strings.TrimSpace(v))
	}
	payload := resendTemplateSendBody{
		From:    strings.TrimSpace(s.From),
		To:      []string{to},
		Subject: strings.TrimSpace(subject),
		Template: resendTemplateBlock{
			ID:        templateID,
			Variables: vars,
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("resend: marshal template body: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEmailsEndpoint, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("resend: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(s.APIKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("resend: request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("resend: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// TryResendPublishedTemplate uses SendPublishedTemplate when s is a *ResendSender and templateID is non-empty.
// Returns (true, nil) on success, (false, nil) when skipped (wrong backend or empty template id), or (_, err) on failure.
func TryResendPublishedTemplate(s Sender, ctx context.Context, to, subject, templateID string, variables map[string]string) (bool, error) {
	rs, ok := s.(*ResendSender)
	if !ok || strings.TrimSpace(templateID) == "" {
		return false, nil
	}
	if err := rs.SendPublishedTemplate(ctx, to, subject, templateID, variables); err != nil {
		return true, err
	}
	return true, nil
}
