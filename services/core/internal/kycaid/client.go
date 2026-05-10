package kycaid

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

const defaultAPIBase = "https://api.kycaid.com"

// Client calls KYCAID HTTP APIs (form URLs, etc.).
type Client struct {
	HTTP    *http.Client
	BaseURL string
	Token   string
}

func (c *Client) base() string {
	b := strings.TrimSuffix(strings.TrimSpace(c.BaseURL), "/")
	if b == "" {
		b = defaultAPIBase
	}
	return b
}

// FormURLRequest is POST /forms/{form_id}/urls.
type FormURLRequest struct {
	ApplicantID           string `json:"applicant_id,omitempty"`
	ExternalApplicantID   string `json:"external_applicant_id,omitempty"`
	RedirectURL           string `json:"redirect_url,omitempty"`
}

// FormURLResponse is returned from CreateFormURL.
type FormURLResponse struct {
	FormID                     string `json:"form_id"`
	FormURL                    string `json:"form_url"`
	VerificationID             string `json:"verification_id"`
	FormToken                  string `json:"form_token"`
	VerificationAttemptsLeft   any    `json:"verification_attempts_left"`
}

// CreateFormURL requests a one-time hosted verification form URL.
func (c *Client) CreateFormURL(ctx context.Context, formID string, body FormURLRequest) (*FormURLResponse, error) {
	formID = strings.TrimSpace(formID)
	if formID == "" {
		return nil, fmt.Errorf("kycaid: form_id required")
	}
	if strings.TrimSpace(c.Token) == "" {
		return nil, fmt.Errorf("kycaid: api token required")
	}
	u := fmt.Sprintf("%s/forms/%s/urls", c.base(), formID)
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Token "+strings.TrimSpace(c.Token))

	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 25 * time.Second}
	}
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("kycaid: form url http %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out FormURLResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("kycaid: decode form url: %w", err)
	}
	if strings.TrimSpace(out.FormURL) == "" {
		return nil, fmt.Errorf("kycaid: empty form_url in response")
	}
	return &out, nil
}
