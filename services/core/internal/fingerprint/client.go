package fingerprint

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client calls Fingerprint Server API v3 (GET /events/{request_id}) with Auth-API-Key.
// See https://docs.fingerprint.com/reference/server-api-get-event
type Client struct {
	HTTP    *http.Client
	BaseURL string
	Secret  string
}

// NewClient returns a server-side client. BaseURL is typically https://api.fpjs.io or https://eu.api.fpjs.io.
func NewClient(baseURL, secret string) *Client {
	baseURL = strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	secret = strings.TrimSpace(secret)
	if baseURL == "" {
		baseURL = "https://api.fpjs.io"
	}
	return &Client{
		HTTP: &http.Client{
			Timeout: 15 * time.Second,
		},
		BaseURL: baseURL,
		Secret:  secret,
	}
}

// Configured is true when the secret is set (caller may still want to check BaseURL).
func (c *Client) Configured() bool {
	return c != nil && strings.TrimSpace(c.Secret) != ""
}

// GetEvent returns the raw JSON event for requestID (path parameter).
func (c *Client) GetEvent(ctx context.Context, requestID string) (map[string]any, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("fingerprint: client not configured")
	}
	rid := strings.TrimSpace(requestID)
	if rid == "" {
		return nil, fmt.Errorf("fingerprint: empty request_id")
	}
	u, err := url.Parse(c.BaseURL + "/events/" + url.PathEscape(rid))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Auth-API-Key", c.Secret)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("fingerprint: event not found (%s)", rid)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fingerprint: server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("fingerprint: decode response: %w", err)
	}
	return out, nil
}
