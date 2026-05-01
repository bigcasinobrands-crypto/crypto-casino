package blueocean

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
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
	// Staging CDNs sometimes drop idle TLS connections; avoid reuse-related EOFs.
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DisableKeepAlives:     true,
		MaxIdleConns:          0,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   30 * time.Second,
		ResponseHeaderTimeout: 90 * time.Second,
	}
	return &Client{
		baseURL:  base,
		login:    cfg.BlueOceanAPILogin,
		password: cfg.BlueOceanAPIPassword,
		httpClient: &http.Client{
			Timeout:   120 * time.Second,
			Transport: tr,
		},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.login != "" && c.password != ""
}

const callMaxAttempts = 4

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

	for attempt := 1; attempt <= callMaxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, strings.NewReader(encoded))
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := c.httpClient.Do(req)
		if err != nil {
			if attempt < callMaxAttempts && isRetriableBlueOceanErr(err) {
				if err := waitRetry(ctx, attempt); err != nil {
					return nil, 0, err
				}
				continue
			}
			return nil, 0, wrapBlueOceanTransportErr(err)
		}
		// Large single-page catalog payloads (when paging is disabled).
		respBody, rerr := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		resp.Body.Close()
		if rerr != nil {
			if attempt < callMaxAttempts && isRetriableBlueOceanErr(rerr) {
				if err := waitRetry(ctx, attempt); err != nil {
					return nil, 0, err
				}
				continue
			}
			return nil, resp.StatusCode, wrapBlueOceanTransportErr(rerr)
		}
		// Callers check status; do not return an error for 4xx/5xx so they can read the JSON body.
		return json.RawMessage(respBody), resp.StatusCode, nil
	}
	return nil, 0, fmt.Errorf("blueocean: exhausted retries without response")
}

func waitRetry(ctx context.Context, attempt int) error {
	d := time.Duration(attempt) * 750 * time.Millisecond
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func isRetriableBlueOceanErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "eof") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "connection refused") ||
		strings.Contains(s, "tls: handshake") ||
		strings.Contains(s, "use of closed network connection") ||
		strings.Contains(s, "server closed idle connection")
}

func wrapBlueOceanTransportErr(err error) error {
	if err == nil {
		return fmt.Errorf("blueocean: unknown transport error")
	}
	return fmt.Errorf("%w — staging often returns EOF when the connection drops early; retry sync or confirm outbound IP is whitelisted with Blue Ocean", err)
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
