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

	method := "getGameDemo"
	params := map[string]any{
		"currency":   "EUR",
		"gameid":     bogID,
		"playforfun": true,
		"userid":     remoteUser,
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
	launchURL, err := blueocean.ExtractLaunchURL(raw)
	if err != nil || launchURL == "" {
		msg := blueocean.FormatAPIError(raw, status)
		log.Printf("blueocean launch: no URL method=%s bog_id=%d body=%.300q", method, bogID, string(raw))
		return "", errors.New("no launch URL in provider response — " + msg)
	}
	return launchURL, nil
}
