package blueocean

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
)

// Client calls Blue Ocean XAPI (JSON POST body with api_login, api_password, method, ...).
type Client struct {
	baseURL    string
	login      string
	password   string
	httpClient *http.Client
}

// NewClient returns nil if BLUEOCEAN_API_BASE_URL is unset (sync/launch will error until configured).
func NewClient(cfg *config.Config) *Client {
	base := strings.TrimSuffix(strings.TrimSpace(cfg.BlueOceanAPIBaseURL), "/")
	if base == "" {
		return nil
	}
	return &Client{
		baseURL: base,
		login:   cfg.BlueOceanAPILogin,
		password: cfg.BlueOceanAPIPassword,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.login != "" && c.password != ""
}

// Call posts a JSON body with api_login, api_password, method merged into params.
func (c *Client) Call(ctx context.Context, method string, params map[string]any) (json.RawMessage, int, error) {
	if !c.Configured() {
		return nil, 0, fmt.Errorf("blueocean: client not configured")
	}
	body := map[string]any{
		"api_login":     c.login,
		"api_password":  c.password,
		"method":        method,
	}
	for k, v := range params {
		body[k] = v
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	// Large single-page catalog payloads (when paging is disabled).
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return json.RawMessage(respBody), resp.StatusCode, fmt.Errorf("blueocean: http %d", resp.StatusCode)
	}
	return json.RawMessage(respBody), resp.StatusCode, nil
}
