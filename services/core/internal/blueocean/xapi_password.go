package blueocean

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"github.com/crypto-casino/core/internal/config"
)

var reXAPIPasswordSHA1Hex = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)

// XAPIWireUserPassword formats user_password for BO XAPI calls (createPlayer, loginPlayer, getPlayerBalance, etc.).
// BO public documentation examples use the SHA-1 message digest of the plaintext password, as 40 lowercase hex characters.
// If the value is already 40 hexadecimal characters, it is sent unchanged (operator pre-hashed).
// When cfg.BlueOceanXAPIUserPasswordSHA1 is false, the trimmed string is sent as-is (legacy / operator-confirmed plaintext).
func XAPIWireUserPassword(cfg *config.Config, password string) string {
	p := strings.TrimSpace(password)
	if p == "" {
		return ""
	}
	if cfg != nil && !cfg.BlueOceanXAPIUserPasswordSHA1 {
		return p
	}
	if reXAPIPasswordSHA1Hex.MatchString(p) {
		return strings.ToLower(p)
	}
	// nosemgrep: go.lang.security.audit.crypto.use-of-sha1 -- required wire format per Blue Ocean XAPI integration docs
	sum := sha1.Sum([]byte(p))
	return hex.EncodeToString(sum[:])
}

// finalizeBOUserPasswordParam hashes or passes through user_password on params when present (see XAPIWireUserPassword).
func finalizeBOUserPasswordParam(cfg *config.Config, method string, params map[string]any) {
	switch strings.TrimSpace(method) {
	case "createPlayer", "loginPlayer", "logoutPlayer", "getPlayerBalance", "getGameHistory":
	default:
		return
	}
	if params == nil {
		return
	}
	v, ok := params["user_password"]
	if !ok || !paramNonemptyBOString(v) {
		return
	}
	params["user_password"] = XAPIWireUserPassword(cfg, fmt.Sprint(v))
}

// stripDeprecatedBOGXAPIUserID removes the deprecated user_id key (underscore) so we do not send it alongside user_username.
func stripDeprecatedBOGXAPIUserID(params map[string]any) {
	if params == nil {
		return
	}
	delete(params, "user_id")
}
