package fystack

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// ListedAsset is a row from GET /api/v1/assets (public / workspace API).
type ListedAsset struct {
	ID          string
	Symbol      string
	ChainID     int64
	NetworkName string
}

// ListWhitelistedAssets requests supported deposit rails from the payment provider.
// Uses GET /api/v1/assets?is_whitelisted=true on the configured BaseURL with normal request signing.
func (c *Client) ListWhitelistedAssets(ctx context.Context, max int) ([]ListedAsset, error) {
	if c == nil || strings.TrimSpace(c.BaseURL) == "" {
		return nil, fmt.Errorf("fystack: client not configured")
	}
	if max < 1 {
		max = 200
	}
	if max > 1000 {
		max = 1000
	}
	path := "/api/v1/assets?is_whitelisted=true&limit=" + strconv.Itoa(max) + "&offset=0"
	st, body, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if st < 200 || st >= 300 {
		return nil, fmt.Errorf("fystack: assets HTTP %d", st)
	}
	var wrap struct {
		Data []struct {
			ID     string `json:"id"`
			Symbol string `json:"symbol"`
			Network struct {
				ChainID int64  `json:"chain_id"`
				Name    string `json:"name"`
			} `json:"network"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return nil, err
	}
	out := make([]ListedAsset, 0, len(wrap.Data))
	for _, row := range wrap.Data {
		sym := strings.TrimSpace(row.Symbol)
		if sym == "" {
			continue
		}
		out = append(out, ListedAsset{
			ID:          strings.TrimSpace(row.ID),
			Symbol:      sym,
			ChainID:     row.Network.ChainID,
			NetworkName: strings.TrimSpace(row.Network.Name),
		})
	}
	return out, nil
}
