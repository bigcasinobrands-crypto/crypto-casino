package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const resendEmailsEndpoint = "https://api.resend.com/emails"

// ResendSender delivers mail via Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
type ResendSender struct {
	APIKey string
	From   string
	// HTTPClient is optional; when nil a client with a 45s timeout is used.
	HTTPClient *http.Client
}

func (s *ResendSender) Configured() bool {
	return strings.TrimSpace(s.APIKey) != "" && strings.TrimSpace(s.From) != ""
}

func (s *ResendSender) httpClient() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return &http.Client{Timeout: 45 * time.Second}
}

type resendSendBody struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Text    string   `json:"text"`
}

func (s *ResendSender) Send(ctx context.Context, to, subject, textBody string) error {
	if !s.Configured() {
		return fmt.Errorf("resend: not configured")
	}
	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("resend: empty recipient")
	}
	payload := resendSendBody{
		From:    strings.TrimSpace(s.From),
		To:      []string{to},
		Subject: subject,
		Text:    textBody,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("resend: marshal body: %w", err)
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
