package privacy

import "strings"

// PlayerVisibleAvatarURL rewrites stored avatar URLs so player-visible responses
// never expose the canonical account UUID in the path. External (absolute) URLs
// are returned unchanged.
func PlayerVisibleAvatarURL(storedURL, publicParticipantID string) string {
	storedURL = strings.TrimSpace(storedURL)
	publicParticipantID = strings.TrimSpace(publicParticipantID)
	if storedURL == "" || publicParticipantID == "" {
		return storedURL
	}
	lower := strings.ToLower(storedURL)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return storedURL
	}
	if strings.Contains(storedURL, "/avatars/by-participant/") {
		return storedURL
	}
	ext := AvatarPathExt(storedURL)
	if ext == "" {
		ext = ".png"
	}
	return "/v1/avatars/by-participant/" + publicParticipantID + ext
}

// AvatarPathExt returns the lowercase file extension from the last path segment (including the dot).
func AvatarPathExt(url string) string {
	u := strings.TrimSpace(url)
	if i := strings.LastIndex(u, "/"); i >= 0 {
		u = u[i+1:]
	}
	if j := strings.LastIndex(u, "."); j >= 0 && j < len(u)-1 {
		return strings.ToLower(u[j:])
	}
	return ""
}
