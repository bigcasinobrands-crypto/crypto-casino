package market

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const cmcAPIBase = "https://pro-api.coinmarketcap.com/v1"

// DefaultTickerSymbols matches the player footer "Accepted Currencies" order.
var DefaultTickerSymbols = []string{"SOL", "BTC", "USDT", "USDC", "ETH", "DOGE", "XRP", "LTC"}

// CryptoTickersResponse is returned by GET /v1/market/crypto-tickers.
type CryptoTickersResponse struct {
	Currencies []CryptoTicker `json:"currencies"`
	Source     string         `json:"source,omitempty"`
	Cached     bool           `json:"cached"`
	Error      string         `json:"error,omitempty"`
}

// CryptoTicker is one row for the footer ticker UI.
type CryptoTicker struct {
	Symbol       string  `json:"symbol"`
	Name         string  `json:"name"`
	PriceUSD     float64 `json:"price_usd"`
	Change24hPct float64 `json:"change_24h_pct"`
	LogoURL      string  `json:"logo_url,omitempty"`
}

type cmcEnvelope struct {
	Status struct {
		ErrorCode    int    `json:"error_code"`
		ErrorMessage string `json:"error_message"`
	} `json:"status"`
	Data json.RawMessage `json:"data"`
}

type quoteRow struct {
	Name   string `json:"name"`
	Symbol string `json:"symbol"`
	Quote  struct {
		USD struct {
			Price            float64 `json:"price"`
			PercentChange24h float64 `json:"percent_change_24h"`
		} `json:"USD"`
	} `json:"quote"`
}

type infoRow struct {
	Name   string `json:"name"`
	Symbol string `json:"symbol"`
	Logo   string `json:"logo"`
}

// CryptoTickers proxies CoinMarketCap quotes + metadata with short in-memory caching.
type CryptoTickers struct {
	apiKey string
	client *http.Client
	ttl    time.Duration

	mu       sync.Mutex
	cached   []CryptoTicker
	cachedAt time.Time
}

// NewCryptoTickers builds a handler. apiKey should come from env (server-side only); empty key serves a graceful JSON payload.
func NewCryptoTickers(apiKey string) *CryptoTickers {
	k := strings.TrimSpace(apiKey)
	return &CryptoTickers{
		apiKey: k,
		client: &http.Client{Timeout: 14 * time.Second},
		ttl:    60 * time.Second,
	}
}

// ServeHTTP implements http.Handler.
func (h *CryptoTickers) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if h.apiKey == "" {
		_ = json.NewEncoder(w).Encode(CryptoTickersResponse{
			Currencies: nil,
			Error:      "not_configured",
		})
		return
	}

	h.mu.Lock()
	if len(h.cached) > 0 && time.Since(h.cachedAt) < h.ttl {
		out := CryptoTickersResponse{Currencies: h.cached, Cached: true, Source: "coinmarketcap"}
		h.mu.Unlock()
		_ = json.NewEncoder(w).Encode(out)
		return
	}
	stale := append([]CryptoTicker(nil), h.cached...)
	h.mu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	list, err := h.fetchMerged(ctx)
	h.mu.Lock()
	defer h.mu.Unlock()

	if err != nil {
		if len(stale) > 0 {
			_ = json.NewEncoder(w).Encode(CryptoTickersResponse{
				Currencies: stale,
				Cached:     true,
				Source:     "coinmarketcap",
				Error:      "upstream_error",
			})
			return
		}
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(CryptoTickersResponse{Error: err.Error()})
		return
	}

	h.cached = list
	h.cachedAt = time.Now()
	_ = json.NewEncoder(w).Encode(CryptoTickersResponse{
		Currencies: list,
		Cached:     false,
		Source:     "coinmarketcap",
	})
}

func (h *CryptoTickers) fetchMerged(ctx context.Context) ([]CryptoTicker, error) {
	symParam := strings.Join(DefaultTickerSymbols, ",")

	quotesBody, err := h.cmcGET(ctx, "/cryptocurrency/quotes/latest?symbol="+symParam+"&convert=USD")
	if err != nil {
		return nil, err
	}
	quotesMap, err := parseQuotes(quotesBody)
	if err != nil {
		return nil, err
	}

	var infoMap map[string]infoRow
	if infoBody, err := h.cmcGET(ctx, "/cryptocurrency/info?symbol="+symParam); err == nil {
		if m, perr := parseInfo(infoBody); perr == nil {
			infoMap = m
		}
	}
	if infoMap == nil {
		infoMap = map[string]infoRow{}
	}

	out := make([]CryptoTicker, 0, len(DefaultTickerSymbols))
	for _, sym := range DefaultTickerSymbols {
		q, ok := lookupBySymbol(quotesMap, sym)
		if !ok {
			continue
		}
		info, _ := lookupBySymbol(infoMap, sym)
		name := strings.TrimSpace(info.Name)
		if name == "" {
			name = strings.TrimSpace(q.Name)
		}
		if name == "" {
			name = sym
		}
		out = append(out, CryptoTicker{
			Symbol:       sym,
			Name:         name,
			PriceUSD:     q.Quote.USD.Price,
			Change24hPct: q.Quote.USD.PercentChange24h,
			LogoURL:      strings.TrimSpace(info.Logo),
		})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("coinmarketcap: no ticker data for requested symbols")
	}
	return out, nil
}

func lookupBySymbol[V any](m map[string]V, sym string) (V, bool) {
	var zero V
	if v, ok := m[sym]; ok {
		return v, true
	}
	for k, v := range m {
		if strings.EqualFold(k, sym) {
			return v, true
		}
	}
	return zero, false
}

func (h *CryptoTickers) cmcGET(ctx context.Context, pathQuery string) ([]byte, error) {
	u := cmcAPIBase + pathQuery
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-CMC_PRO_API_KEY", h.apiKey)
	req.Header.Set("Accept", "application/json")

	res, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("coinmarketcap http %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var env cmcEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("coinmarketcap json: %w", err)
	}
	if env.Status.ErrorCode != 0 {
		msg := strings.TrimSpace(env.Status.ErrorMessage)
		if msg == "" {
			msg = fmt.Sprintf("error_code=%d", env.Status.ErrorCode)
		}
		return nil, fmt.Errorf("coinmarketcap: %s", msg)
	}
	return body, nil
}

func parseQuotes(body []byte) (map[string]quoteRow, error) {
	var env cmcEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	var data map[string]quoteRow
	if err := json.Unmarshal(env.Data, &data); err != nil {
		return nil, fmt.Errorf("quotes data: %w", err)
	}
	return data, nil
}

func parseInfo(body []byte) (map[string]infoRow, error) {
	var env cmcEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	var data map[string]infoRow
	if err := json.Unmarshal(env.Data, &data); err != nil {
		return nil, fmt.Errorf("info data: %w", err)
	}
	return data, nil
}
