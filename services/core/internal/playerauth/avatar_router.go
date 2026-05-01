package playerauth

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/crypto-casino/core/internal/privacy"
	"github.com/crypto-casino/core/internal/safepath"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var allowedAvatarExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true,
}

// AvatarGatewayHandler routes GET /v1/avatars/... — by-participant serves files;
// legacy /v1/avatars/{account-uuid}.ext redirects to the participant URL.
func AvatarGatewayHandler(pool *pgxpool.Pool, avatarRoot string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		suffix := strings.TrimPrefix(r.URL.Path, "/v1/avatars/")
		suffix = strings.TrimPrefix(suffix, "/")
		if suffix == "" {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(suffix, "by-participant/") {
			tail := strings.TrimPrefix(suffix, "by-participant/")
			serveAvatarByParticipant(w, r, pool, avatarRoot, tail)
			return
		}
		legacyAvatarRedirect(w, r, pool, suffix)
	}
}

func parseParticipantAvatarTail(tail string) (participantID, ext string, ok bool) {
	tail = strings.Trim(tail, "/")
	if tail == "" {
		return "", "", false
	}
	lastDot := strings.LastIndex(tail, ".")
	if lastDot <= 0 || lastDot == len(tail)-1 {
		return "", "", false
	}
	ext = strings.ToLower(tail[lastDot:])
	if !allowedAvatarExts[ext] {
		return "", "", false
	}
	participantID = tail[:lastDot]
	if _, err := uuid.Parse(participantID); err != nil {
		return "", "", false
	}
	return participantID, ext, true
}

func serveAvatarByParticipant(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, avatarRoot, tail string) {
	participantID, ext, ok := parseParticipantAvatarTail(tail)
	if !ok {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	var userID, stored string
	err := pool.QueryRow(ctx,
		`SELECT id::text, COALESCE(avatar_url, '') FROM users WHERE public_participant_id = $1::uuid`,
		participantID,
	).Scan(&userID, &stored)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	want := privacy.AvatarPathExt(stored)
	if want == "" {
		want = ".png"
	}
	if ext != want {
		http.NotFound(w, r)
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(avatarRoot, userID+ext)
	if !safepath.Within(avatarRoot, path) {
		http.NotFound(w, r)
		return
	}
	if st, err := os.Stat(path); err != nil || st.IsDir() { // #nosec G703 -- path verified via safepath.Within + UUID segments
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, path) // #nosec G703 -- same as Stat above
}

func legacyAvatarRedirect(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, suffix string) {
	if strings.Contains(suffix, "/") {
		http.NotFound(w, r)
		return
	}
	i := strings.LastIndex(suffix, ".")
	if i <= 0 || i == len(suffix)-1 {
		http.NotFound(w, r)
		return
	}
	base := suffix[:i]
	ext := strings.ToLower(suffix[i:])
	if !allowedAvatarExts[ext] {
		http.NotFound(w, r)
		return
	}
	if _, err := uuid.Parse(base); err != nil {
		http.NotFound(w, r)
		return
	}
	var pid string
	err := pool.QueryRow(r.Context(), `SELECT public_participant_id::text FROM users WHERE id = $1::uuid`, base).Scan(&pid)
	if err != nil || strings.TrimSpace(pid) == "" {
		http.NotFound(w, r)
		return
	}
	target := "/v1/avatars/by-participant/" + pid + ext
	http.Redirect(w, r, target, http.StatusMovedPermanently)
}
