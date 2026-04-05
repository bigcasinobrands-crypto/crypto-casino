package fystack

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

// Client calls Fystack REST with HMAC auth (enterprise or api.fystack.io).
type Client struct {
	HTTPClient    *http.Client
	BaseURL       string // e.g. https://enterprise-sandbox.fystack.io
	APIKey        string
	APISecret     string
	WorkspaceID   string
}

func NewClient(baseURL, apiKey, apiSecret, workspaceID string) *Client {
	baseURL = strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	return &Client{
		HTTPClient:  &http.Client{Timeout: 45 * time.Second},
		BaseURL:     baseURL,
		APIKey:      strings.TrimSpace(apiKey),
		APISecret:   strings.TrimSpace(apiSecret),
		WorkspaceID: strings.TrimSpace(workspaceID),
	}
}

// Do executes a signed Fystack API request. Exported for tooling (e.g. asset discovery).
func (c *Client) Do(ctx context.Context, method, path string, body []byte) (status int, respBody []byte, err error) {
	return c.do(ctx, method, path, body)
}

func (c *Client) do(ctx context.Context, method, fullPath string, body []byte) (status int, respBody []byte, err error) {
	if c == nil || c.BaseURL == "" {
		return 0, nil, fmt.Errorf("fystack: client not configured")
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	if !strings.HasPrefix(fullPath, "/") {
		fullPath = "/" + fullPath
	}
	signPath := fullPath
	if idx := strings.IndexByte(signPath, '?'); idx >= 0 {
		signPath = signPath[:idx]
	}
	bodyStr := ""
	if body != nil {
		bodyStr = string(body)
	}
	ts, sig, err := SignAccessSign(c.APISecret, method, signPath, bodyStr)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+fullPath, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("ACCESS-API-KEY", c.APIKey)
	req.Header.Set("ACCESS-TIMESTAMP", ts)
	req.Header.Set("ACCESS-SIGN", sig)

	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	respBody, err = io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return res.StatusCode, nil, err
	}
	return res.StatusCode, respBody, nil
}

// CreateWallet POST /api/v1/wallets (docs.fystack.io/wallets).
// walletType: "standard" (Hyper, instant) or "mpc" (async).
func (c *Client) CreateWallet(ctx context.Context, name string, walletType string) (map[string]any, int, error) {
	if walletType == "" {
		walletType = "standard"
	}
	path := "/api/v1/wallets"
	payload := map[string]any{
		"name":           name,
		"wallet_type":    walletType,
		"wallet_purpose": "user",
	}
	body, _ := json.Marshal(payload)
	st, resp, err := c.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return nil, st, err
	}
	var m map[string]any
	_ = json.Unmarshal(resp, &m)
	return m, st, nil
}

// GetWebhookPublicKey GET /api/v1/workspaces/{id}/webhook-verification-key
func (c *Client) GetWebhookPublicKey(ctx context.Context) (publicKeyHex string, err error) {
	if c.WorkspaceID == "" {
		return "", fmt.Errorf("fystack: workspace id required")
	}
	path := "/api/v1/workspaces/" + c.WorkspaceID + "/webhook-verification-key"
	st, resp, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", err
	}
	if st < 200 || st >= 300 {
		return "", fmt.Errorf("fystack: webhook key HTTP %d: %s", st, truncate(string(resp), 200))
	}
	var wrap struct {
		Data struct {
			PublicKey string `json:"public_key"`
		} `json:"data"`
		Success bool `json:"success"`
	}
	if json.Unmarshal(resp, &wrap) == nil && wrap.Data.PublicKey != "" {
		return strings.TrimSpace(wrap.Data.PublicKey), nil
	}
	var m map[string]any
	if json.Unmarshal(resp, &m) == nil {
		if d, ok := m["data"].(map[string]any); ok {
			if pk, ok := d["public_key"].(string); ok {
				return strings.TrimSpace(pk), nil
			}
		}
	}
	return "", fmt.Errorf("fystack: parse webhook public key")
}

// CreateCheckout POST /api/v1/checkouts (path per checkout docs; adjust if workspace-scoped).
func (c *Client) CreateCheckout(ctx context.Context, bodyJSON []byte) (map[string]any, int, error) {
	path := "/api/v1/checkouts"
	st, resp, err := c.do(ctx, http.MethodPost, path, bodyJSON)
	if err != nil {
		return nil, st, err
	}
	var m map[string]any
	_ = json.Unmarshal(resp, &m)
	return m, st, nil
}

// RequestWithdrawal POST /api/v1/wallets/{walletID}/request-withdrawal
func (c *Client) RequestWithdrawal(ctx context.Context, treasuryWalletID, assetID, amountDecimal, recipient string, idempotencyKey string) (map[string]any, int, error) {
	path := "/api/v1/wallets/" + strings.TrimSpace(treasuryWalletID) + "/request-withdrawal"
	payload := map[string]string{
		"asset_id":          strings.TrimSpace(assetID),
		"amount":            strings.TrimSpace(amountDecimal),
		"recipient_address": strings.TrimSpace(recipient),
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, 0, err
	}
	bodyStr := string(b)
	ts, sig, err := SignAccessSign(c.APISecret, http.MethodPost, path, bodyStr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("ACCESS-API-KEY", c.APIKey)
	req.Header.Set("ACCESS-TIMESTAMP", ts)
	req.Header.Set("ACCESS-SIGN", sig)
	if strings.TrimSpace(idempotencyKey) != "" {
		req.Header.Set("X-Idempotency-Key", idempotencyKey)
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, res.StatusCode, err
	}
	var m map[string]any
	_ = json.Unmarshal(respBody, &m)
	return m, res.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// ExtractWalletID tries common response shapes from create wallet.
func ExtractWalletID(m map[string]any) string {
	if m == nil {
		return ""
	}
	if s, ok := m["wallet_id"].(string); ok && s != "" {
		return s
	}
	if s, ok := m["id"].(string); ok && s != "" {
		return s
	}
	if d, ok := m["data"].(map[string]any); ok {
		if s, ok := d["wallet_id"].(string); ok && s != "" {
			return s
		}
		if s, ok := d["id"].(string); ok && s != "" {
			return s
		}
	}
	return ""
}
