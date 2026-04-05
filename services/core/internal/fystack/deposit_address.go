package fystack

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// GetDepositAddress GET /api/v1/wallets/{walletID}/deposit-address?asset_id=...&address_type=evm
// addressType: "evm" or "sol" (tron coming soon per docs.fystack.io/wallets).
func (c *Client) GetDepositAddress(ctx context.Context, walletID, assetID, addressType string) (map[string]any, int, error) {
	walletID = strings.TrimSpace(walletID)
	assetID = strings.TrimSpace(assetID)
	if walletID == "" {
		return nil, 0, fmt.Errorf("fystack: wallet id required")
	}
	q := url.Values{}
	if assetID != "" {
		q.Set("asset_id", assetID)
	}
	if addressType != "" {
		q.Set("address_type", addressType)
	}
	path := "/api/v1/wallets/" + url.PathEscape(walletID) + "/deposit-address"
	if qs := q.Encode(); qs != "" {
		path += "?" + qs
	}
	st, resp, err := c.do(ctx, "GET", path, nil)
	if err != nil {
		return nil, st, err
	}
	var m map[string]any
	_ = json.Unmarshal(resp, &m)
	return m, st, nil
}
