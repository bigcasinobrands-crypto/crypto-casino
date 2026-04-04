package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
)

// Client calls Blue Ocean / game-program XAPI (form-encoded POST with api_login, api_password, method, ...).
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

// Call posts application/x-www-form-urlencoded with api_login, api_password, method merged into params.
// (BOG / game-program XAPI expects form body, not JSON.)
func (c *Client) Call(ctx context.Context, method string, params map[string]any) (json.RawMessage, int, error) {
	if !c.Configured() {
		return nil, 0, fmt.Errorf("blueocean: client not configured")
	}
	body := map[string]any{
		"api_login":    c.login,
		"api_password": c.password,
		"method":       method,
	}
	for k, v := range params {
		body[k] = v
	}
	encoded := formEncode(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, strings.NewReader(encoded))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
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
	// Callers check status; do not return an error for 4xx/5xx so they can read the JSON body.
	return json.RawMessage(respBody), resp.StatusCode, nil
}

func formEncode(fields map[string]any) string {
	v := url.Values{}
	for key, val := range fields {
		if val == nil {
			continue
		}
		switch x := val.(type) {
		case string:
			v.Set(key, x)
		case int:
			v.Set(key, strconv.Itoa(x))
		case int64:
			v.Set(key, strconv.FormatInt(x, 10))
		case float64:
			v.Set(key, strconv.FormatFloat(x, 'f', -1, 64))
		case bool:
			// PHP / form APIs often expect 1/0, not "true"/"false".
			if x {
				v.Set(key, "1")
			} else {
				v.Set(key, "0")
			}
		case json.Number:
			v.Set(key, x.String())
		default:
			v.Set(key, fmt.Sprint(x))
		}
	}
	return v.Encode()
}
