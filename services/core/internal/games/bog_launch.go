package games

import (
	"context"
	"errors"
	"log"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
)

// appendBlueOceanLaunchHints adds operator-facing context when BO returns the generic XAPI error.
func appendBlueOceanLaunchHints(msg string, cfg *config.Config) string {
	if cfg == nil || !strings.Contains(strings.ToLower(msg), "invalid user details") {
		return msg
	}
	var parts []string
	if strings.TrimSpace(cfg.BlueOceanAgentID) == "" {
		parts = append(parts, "set BLUEOCEAN_AGENT_ID from onboarding")
	}
	if strings.TrimSpace(cfg.BlueOceanCatalogSnapshotPath) != "" {
		parts = append(parts, "catalog may be from BLUEOCEAN_CATALOG_SNAPSHOT_PATH — that bypasses live getGameList; fix XAPI then run a live sync to confirm credentials + IP")
	}
	parts = append(parts, "confirm Api Access password (not Backoffice)", "try BLUEOCEAN_USERID_NO_HYPHENS=true", "check BO IP allowlist for this server’s egress")
	return msg + " — " + strings.Join(parts, "; ") + "."
}

var (
	errBogUnconfigured  = errors.New("blueocean: client not configured")
	errDemoNotSupported = errors.New("demo not supported for this title")
)

func mergeBlueOceanAgentParams(cfg *config.Config, params map[string]any) {
	if cfg == nil {
		return
	}
	if aid := strings.TrimSpace(cfg.BlueOceanAgentID); aid != "" {
		if n, err := strconv.ParseInt(aid, 10, 64); err == nil && n > 0 {
			params["agentid"] = n
		} else {
			params["associateid"] = aid
		}
	}
}

// blueOceanLaunchFromBogID calls getGameDemo / getGame and returns the iframe URL from Blue Ocean XAPI.
func (s *Server) blueOceanLaunchFromBogID(ctx context.Context, remoteUser string, bogID int64, mode string, playFunSupported bool) (string, error) {
	if s.BOG == nil || !s.BOG.Configured() {
		return "", errBogUnconfigured
	}
	if bogID == 0 {
		return "", errors.New("blueocean: missing game id")
	}

	xapiUser := remoteUser
	if s.Cfg != nil {
		xapiUser = blueocean.FormatUserIDForXAPI(remoteUser, s.Cfg.BlueOceanUserIDNoHyphens)
	}
	method := "getGameDemo"
	params := map[string]any{
		"currency":   "EUR",
		"gameid":     bogID,
		"playforfun": true,
		"userid":     xapiUser,
	}
	if s.Cfg != nil {
		if c := strings.TrimSpace(s.Cfg.BlueOceanCurrency); c != "" {
			params["currency"] = c
		}
		if s.Cfg.BlueOceanMulticurrency {
			params["multicurrency"] = 1
		}
	}
	if mode == "real" {
		method = "getGame"
		params["playforfun"] = false
	} else {
		if !playFunSupported {
			return "", errDemoNotSupported
		}
	}
	mergeBlueOceanAgentParams(s.Cfg, params)

	raw, status, err := s.BOG.Call(ctx, method, params)
	if err != nil {
		log.Printf("blueocean launch: transport error method=%s bog_id=%d: %v", method, bogID, err)
		return "", err
	}
	if status < 200 || status >= 300 {
		msg := blueocean.FormatAPIError(raw, status)
		log.Printf("blueocean launch: HTTP %d method=%s bog_id=%d: %s", status, method, bogID, msg)
		return "", errors.New(msg)
	}
	if !blueocean.LaunchPayloadOK(raw) {
		msg := blueocean.FormatAPIError(raw, status)
		msg = appendBlueOceanLaunchHints(msg, s.Cfg)
		log.Printf("blueocean launch: provider failure method=%s bog_id=%d: %s", method, bogID, msg)
		return "", errors.New(msg)
	}
	launchURL, err := blueocean.ExtractLaunchURL(raw)
	if err != nil || launchURL == "" {
		msg := blueocean.FormatAPIError(raw, status)
		log.Printf("blueocean launch: no URL method=%s bog_id=%d body=%.300q", method, bogID, string(raw))
		return "", errors.New("no launch URL in provider response — " + msg)
	}
	return launchURL, nil
}
