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
	mu       sync.Mutex
	cache    = map[string]entry{}
	inflight = map[string]struct{}{}
)

type entry struct {
	at   time.Time
	name string
}

const cacheTTL = 15 * time.Minute

// PeekCountryName returns a cached English country_name for rawIP without performing network I/O.
// Empty when unknown or cache expired — callers typically pair with Warm.
func PeekCountryName(rawIP string) string {
	rawIP = strings.TrimSpace(rawIP)
	ip := net.ParseIP(rawIP)
	if ip == nil {
		return ""
	}
	key := ip.String()

	mu.Lock()
	defer mu.Unlock()
	if e, ok := cache[key]; ok && time.Since(e.at) < cacheTTL && e.name != "" {
		return e.name
	}
	return ""
}

// Warm kicks off a background ipdata.co lookup when the cache is cold (deduped per IP).
// Never blocks the caller — used so GET /health/operational stays fast while names populate on repeat polls.
func Warm(rawIP, apiKey string) {
	apiKey = strings.TrimSpace(apiKey)
	ip := net.ParseIP(strings.TrimSpace(rawIP))
	if apiKey == "" || ip == nil {
		return
	}
	key := ip.String()

	mu.Lock()
	if e, ok := cache[key]; ok && time.Since(e.at) < cacheTTL && e.name != "" {
		mu.Unlock()
		return
	}
	if _, busy := inflight[key]; busy {
		mu.Unlock()
		return
	}
	inflight[key] = struct{}{}
	mu.Unlock()

	go func() {
		defer func() {
			mu.Lock()
			delete(inflight, key)
			mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
		defer cancel()
		name := fetchCountryName(ctx, key, apiKey)
		if name == "" {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if len(cache) > 4096 {
			cache = map[string]entry{}
		}
		cache[key] = entry{at: time.Now(), name: name}
	}()
}

func fetchCountryName(ctx context.Context, ip, apiKey string) string {
	u := fmt.Sprintf("https://api.ipdata.co/%s?api-key=%s",
		url.PathEscape(ip), url.QueryEscape(apiKey))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return ""
	}
	client := &http.Client{Timeout: 2200 * time.Millisecond}
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
