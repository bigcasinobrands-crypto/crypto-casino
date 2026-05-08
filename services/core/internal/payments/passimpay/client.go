package passimpay

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

// Client calls PassimPay v2 JSON API (POST + x-signature).
// https://passimpay.gitbook.io/passimpay-api/get-address
// https://passimpay.gitbook.io/passimpay-api/withdraw
type Client struct {
	BaseURL    string
	PlatformID int
	SecretKey  string
	HTTP       *http.Client
}

func NewClient(baseURL string, platformID int, secretKey string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &Client{
		BaseURL:    strings.TrimSuffix(strings.TrimSpace(baseURL), "/"),
		PlatformID: platformID,
		SecretKey:  strings.TrimSpace(secretKey),
		HTTP:       &http.Client{Timeout: timeout},
	}
}

func (c *Client) post(ctx context.Context, path string, body map[string]any) (status int, resp map[string]any, raw []byte, err error) {
	if c == nil || c.BaseURL == "" || c.SecretKey == "" {
		return 0, nil, nil, fmt.Errorf("passimpay: client not configured")
	}
	u := c.BaseURL + path
	b := make(map[string]any, len(body)+1)
	for k, v := range body {
		b[k] = v
	}
	if _, ok := b["platformId"]; !ok {
		b["platformId"] = c.PlatformID
	}
	jsonBody, sig, err := SignBody(c.PlatformID, c.SecretKey, b)
	if err != nil {
		return 0, nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(jsonBody))
	if err != nil {
		return 0, nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-signature", sig)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	defer res.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(res.Body, 1<<22))
	if err != nil {
		return res.StatusCode, nil, nil, err
	}
	var parsed map[string]any
	if len(raw) > 0 && json.Valid(raw) {
		_ = json.Unmarshal(raw, &parsed)
	}
	return res.StatusCode, parsed, raw, nil
}

// GetDepositAddress wraps POST /v2/address.
func (c *Client) GetDepositAddress(ctx context.Context, paymentID int, orderID string) (address string, destTag string, err error) {
	st, j, _, err := c.post(ctx, "/v2/address", map[string]any{
		"paymentId": paymentID,
		"orderId":   orderID,
	})
	if err != nil {
		return "", "", err
	}
	if st < 200 || st >= 300 {
		msg := ""
		if j != nil && j["message"] != nil {
			msg = strings.TrimSpace(fmt.Sprint(j["message"]))
		}
		return "", "", fmt.Errorf("passimpay address: HTTP %d %s", st, msg)
	}
	if res, ok := j["result"].(float64); !ok || int(res) != 1 {
		return "", "", fmt.Errorf("passimpay address: result not success %+v", j)
	}
	addr := strings.TrimSpace(fmt.Sprint(j["address"]))
	tag := ""
	if v, ok := j["destinationTag"]; ok && v != nil {
		tag = strings.TrimSpace(fmt.Sprint(v))
	}
	return addr, tag, nil
}

// CreateInvoiceOrder wraps POST /v2/createorder (invoice / hosted payment link).
// https://passimpay.gitbook.io/passimpay-api/create-an-invoice-link
// amountUSD must use two decimal places (e.g. "50.00"). type 1 = cryptocurrencies only.
func (c *Client) CreateInvoiceOrder(ctx context.Context, orderID, amountUSD string, paymentID int) (payURL string, err error) {
	st, j, _, err := c.post(ctx, "/v2/createorder", map[string]any{
		"orderId":    orderID,
		"amount":     amountUSD,
		"currencies": fmt.Sprintf("%d", paymentID),
		"symbol":     "USD",
		"type":       1,
	})
	if err != nil {
		return "", err
	}
	if st < 200 || st >= 300 {
		msg := ""
		if j != nil && j["message"] != nil {
			msg = strings.TrimSpace(fmt.Sprint(j["message"]))
		}
		return "", fmt.Errorf("passimpay createorder: HTTP %d %s", st, msg)
	}
	if res, ok := j["result"].(float64); !ok || int(res) != 1 {
		return "", fmt.Errorf("passimpay createorder: result not success %+v", j)
	}
	u := strings.TrimSpace(fmt.Sprint(j["url"]))
	if u == "" {
		return "", fmt.Errorf("passimpay createorder: missing url in %+v", j)
	}
	return u, nil
}

// CreateWithdraw wraps POST /v2/withdraw. Rate limited to 1 rps upstream.
func (c *Client) CreateWithdraw(ctx context.Context, paymentID int, addressTo, amount string, orderID string) (txID string, err error) {
	st, j, _, err := c.post(ctx, "/v2/withdraw", map[string]any{
		"paymentId": paymentID,
		"addressTo": addressTo,
		"amount":    amount,
		"orderId":   orderID,
	})
	if err != nil {
		return "", err
	}
	if st < 200 || st >= 300 {
		msg := ""
		if j != nil && j["message"] != nil {
			msg = strings.TrimSpace(fmt.Sprint(j["message"]))
		}
		return "", fmt.Errorf("passimpay withdraw: HTTP %d %s", st, msg)
	}
	if res, ok := j["result"].(float64); !ok || int(res) != 1 {
		return "", fmt.Errorf("passimpay withdraw: result not success %+v", j)
	}
	raw := ""
	if j["transactionId"] != nil {
		raw = strings.TrimSpace(fmt.Sprint(j["transactionId"]))
	}
	return raw, nil
}
