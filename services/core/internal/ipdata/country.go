package ipdata

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type apiPayload struct {
	CountryName string `json:"country_name"`
	CountryCode string `json:"country_code"`
}

var (
	mu    sync.Mutex
	cache = map[string]entry{}
)

type entry struct {
	at   time.Time
	name string
}

const cacheTTL = 15 * time.Minute

// CountryName returns English country_name from ipdata.co for the given IP (IPv4 or IPv6).
// Empty API key or lookup failure returns "". Responses are cached per IP briefly to limit quota use.
func CountryName(ctx context.Context, rawIP, apiKey string) string {
	apiKey = strings.TrimSpace(apiKey)
	rawIP = strings.TrimSpace(rawIP)
	if apiKey == "" || rawIP == "" {
		return ""
	}
	ip := net.ParseIP(rawIP)
	if ip == nil {
		return ""
	}
	key := ip.String()

	mu.Lock()
	if e, ok := cache[key]; ok && time.Since(e.at) < cacheTTL && e.name != "" {
		mu.Unlock()
		return e.name
	}
	mu.Unlock()

	name := fetchCountryName(ctx, key, apiKey)
	if name != "" {
		mu.Lock()
		if len(cache) > 4096 {
			cache = map[string]entry{}
		}
		cache[key] = entry{at: time.Now(), name: name}
		mu.Unlock()
	}
	return name
}

func fetchCountryName(ctx context.Context, ip, apiKey string) string {
	u := fmt.Sprintf("https://api.ipdata.co/%s?api-key=%s",
		url.PathEscape(ip), url.QueryEscape(apiKey))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return ""
	}
	client := &http.Client{Timeout: 1800 * time.Millisecond}
	res, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ""
	}
	var p apiPayload
	if json.NewDecoder(res.Body).Decode(&p) != nil {
		return ""
	}
	return strings.TrimSpace(p.CountryName)
}
