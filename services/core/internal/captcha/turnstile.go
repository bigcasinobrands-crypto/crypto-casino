package captcha

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

// Turnstile verifies Cloudflare Turnstile tokens. Empty Secret disables verification (dev/CI).
type Turnstile struct {
	Secret string
}

type siteverifyResp struct {
	Success bool `json:"success"`
}

func (t *Turnstile) Required() bool {
	return strings.TrimSpace(t.Secret) != ""
}

func (t *Turnstile) Verify(ctx context.Context, token, remoteIP string) error {
	if !t.Required() {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("missing captcha token")
	}
	form := url.Values{}
	form.Set("secret", t.Secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	var sv siteverifyResp
	if err := json.Unmarshal(body, &sv); err != nil {
		return fmt.Errorf("turnstile: bad response")
	}
	if !sv.Success {
		return fmt.Errorf("captcha failed")
	}
	return nil
}
