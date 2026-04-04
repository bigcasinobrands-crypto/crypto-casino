package blueocean

import (
	"encoding/json"
	"fmt"
	"strings"
)

// FormatAPIError summarizes a provider HTTP body for player/admin-visible errors.
func FormatAPIError(raw json.RawMessage, httpStatus int) string {
	if len(raw) == 0 {
		return fmt.Sprintf("provider returned HTTP %d with an empty body", httpStatus)
	}
	var root struct {
		Error   any    `json:"error"`
		Message string `json:"message"`
		Msg     string `json:"msg"`
	}
	if json.Unmarshal(raw, &root) == nil {
		if root.Message != "" {
			return fmt.Sprintf("provider (HTTP %d): %s", httpStatus, root.Message)
		}
		if root.Msg != "" {
			return fmt.Sprintf("provider (HTTP %d): %s", httpStatus, root.Msg)
		}
		if root.Error != nil && fmt.Sprint(root.Error) != "" {
			return fmt.Sprintf("provider (HTTP %d): %v", httpStatus, root.Error)
		}
	}
	s := strings.TrimSpace(string(raw))
	if len(s) > 400 {
		s = s[:400] + "…"
	}
	return fmt.Sprintf("provider (HTTP %d): %s", httpStatus, s)
}
