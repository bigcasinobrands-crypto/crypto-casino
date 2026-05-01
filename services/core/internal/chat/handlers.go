package chat

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/privacy"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"nhooyr.io/websocket"
)

var (
	sharedFlood *FloodTracker
	sharedDupes *DuplicateTracker
)

func init() {
	sharedFlood = NewFloodTracker()
	sharedDupes = NewDuplicateTracker()
}

// HandleWebSocket upgrades to a WebSocket connection.
// Prefer ?ticket= from POST /v1/chat/ws-ticket when Redis is available; otherwise ?token=<jwt>.
func HandleWebSocket(hub *Hub, pool *pgxpool.Pool, iss *jwtissuer.Issuer, rev *jtiredis.Revoker, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if iss == nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "jwt not configured")
			return
		}
		var userID string
		if ticket := strings.TrimSpace(r.URL.Query().Get("ticket")); ticket != "" && rdb != nil {
			uid, ok := redeemWSTicket(r.Context(), rdb, ticket)
			if !ok || uid == "" {
				playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired ticket")
				return
			}
			userID = uid
		} else {
			token := r.URL.Query().Get("token")
			if token == "" {
				playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing token")
				return
			}
			var jti string
			var err error
			userID, jti, err = iss.ParsePlayer(token)
			if err != nil {
				playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
				return
			}
			if rev != nil && jti != "" {
				revoked, rerr := rev.IsRevoked(r.Context(), jti)
				if rerr != nil {
					playerapi.WriteError(w, http.StatusServiceUnavailable, "unavailable", "session check failed")
					return
				}
				if revoked {
					playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "token revoked")
					return
				}
			}
		}

		if banned, _ := isUserBanned(r.Context(), pool, userID); banned {
			playerapi.WriteError(w, http.StatusForbidden, "banned", "you are banned from chat")
			return
		}

		username, vipRank, avatarURL, participantID, createdAt := lookupUser(r.Context(), pool, userID)
		if username == "" {
			username = "anon"
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			log.Printf("chat: accept ws: %v", err)
			return
		}

		client := &Client{
			hub:           hub,
			conn:          conn,
			userID:        userID,
			participantID: participantID,
			username:      username,
			vipRank:       vipRank,
			avatarURL:     avatarURL,
			createdAt:     createdAt,
			send:          make(chan []byte, sendChanSize),
			pool:          pool,
			flood:         sharedFlood,
			dupes:         sharedDupes,
		}

		hub.register <- client

		ctx := r.Context()
		go client.WritePump(ctx)
		client.ReadPump(ctx)
	}
}

// HandleHistory returns the most recent chat messages as JSON.
func HandleHistory(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limitStr := r.URL.Query().Get("limit")
		limit := 50
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}

		beforeStr := r.URL.Query().Get("before")
		var beforeID int64
		if b, err := strconv.ParseInt(beforeStr, 10, 64); err == nil && b > 0 {
			beforeID = b
		}

		viewerID, _ := playerapi.UserIDFromContext(r.Context())
		rows, err := queryHistory(r.Context(), pool, limit, beforeID, strings.TrimSpace(viewerID))
		if err != nil {
			log.Printf("chat: history query: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "internal", "failed to load history")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rows)
	}
}

// HandleDeleteMessage soft-deletes a chat message (mod-only).
func HandleDeleteMessage(hub *Hub, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		modID, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		var body struct {
			MessageID int64 `json:"message_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MessageID <= 0 {
			playerapi.WriteError(w, http.StatusBadRequest, "bad_request", "invalid message_id")
			return
		}

		err := softDeleteMessage(r.Context(), pool, body.MessageID, modID)
		if err != nil {
			log.Printf("chat: delete msg %d: %v", body.MessageID, err)
			playerapi.WriteError(w, http.StatusInternalServerError, "internal", "failed to delete")
			return
		}

		env := Envelope{Type: "delete", Data: json.RawMessage(mustMarshal(DeleteData{MessageID: body.MessageID}))}
		data, _ := json.Marshal(env)
		hub.broadcast <- data

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}
}

// HandleMuteUser temporarily mutes a user (mod-only).
func HandleMuteUser(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		modID, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		var body struct {
			UserID   string `json:"user_id"`
			Duration int    `json:"duration_minutes"`
			Reason   string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" || body.Duration <= 0 {
			playerapi.WriteError(w, http.StatusBadRequest, "bad_request", "invalid user_id or duration")
			return
		}

		dur := time.Duration(body.Duration) * time.Minute
		if dur > 24*time.Hour {
			dur = 24 * time.Hour
		}

		err := muteUser(r.Context(), pool, body.UserID, modID, body.Reason, dur)
		if err != nil {
			log.Printf("chat: mute user %s: %v", body.UserID, err)
			playerapi.WriteError(w, http.StatusInternalServerError, "internal", "failed to mute")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}
}

// HandleBanUser permanently bans a user and disconnects them (mod-only).
func HandleBanUser(hub *Hub, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		modID, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		var body struct {
			UserID string `json:"user_id"`
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "bad_request", "invalid user_id")
			return
		}

		err := banUser(r.Context(), pool, body.UserID, modID, body.Reason)
		if err != nil {
			log.Printf("chat: ban user %s: %v", body.UserID, err)
			playerapi.WriteError(w, http.StatusInternalServerError, "internal", "failed to ban")
			return
		}

		hub.DisconnectUser(body.UserID)

		hub.BroadcastSystem("system", "A user has been banned from chat.")

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}
}

// --- Database helpers ---

func lookupUser(ctx context.Context, pool *pgxpool.Pool, userID string) (username, vipRank, avatarURL, participantID string, createdAt time.Time) {
	row := pool.QueryRow(ctx,
		`SELECT COALESCE(username, ''), COALESCE(avatar_url, ''), created_at, public_participant_id::text FROM users WHERE id = $1`, userID)
	var rawAvatar string
	_ = row.Scan(&username, &rawAvatar, &createdAt, &participantID)
	avatarURL = privacy.PlayerVisibleAvatarURL(rawAvatar, participantID)
	return username, "", avatarURL, participantID, createdAt
}

func insertMessage(ctx context.Context, pool *pgxpool.Pool, userID, username, body, msgType, vipRank string) (int64, error) {
	var id int64
	err := pool.QueryRow(ctx,
		`INSERT INTO chat_messages (user_id, username, body, msg_type, vip_rank)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		userID, username, body, msgType, vipRank,
	).Scan(&id)
	return id, err
}

func queryHistory(ctx context.Context, pool *pgxpool.Pool, limit int, beforeID int64, viewerID string) ([]OutboundMessage, error) {
	var query string
	var args []any

	if beforeID > 0 {
		query = `SELECT m.id, m.user_id, COALESCE(u.public_participant_id::text, ''), m.username, m.body, m.msg_type,
		                COALESCE(m.vip_rank,''), COALESCE(u.avatar_url,''), m.created_at
		         FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
		         WHERE m.deleted = false AND m.id < $1
		         ORDER BY m.created_at DESC LIMIT $2`
		args = []any{beforeID, limit}
	} else {
		query = `SELECT m.id, m.user_id, COALESCE(u.public_participant_id::text, ''), m.username, m.body, m.msg_type,
		                COALESCE(m.vip_rank,''), COALESCE(u.avatar_url,''), m.created_at
		         FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
		         WHERE m.deleted = false
		         ORDER BY m.created_at DESC LIMIT $1`
		args = []any{limit}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []OutboundMessage
	var historyInternalUIDs []string
	for rows.Next() {
		var m OutboundMessage
		var createdAt time.Time
		var internalUID, rawAvatar string
		if err := rows.Scan(&m.ID, &internalUID, &m.ParticipantID, &m.Username, &m.Body, &m.MsgType, &m.VipRank, &rawAvatar, &createdAt); err != nil {
			return nil, err
		}
		m.AvatarURL = privacy.PlayerVisibleAvatarURL(rawAvatar, m.ParticipantID)
		m.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		msgs = append(msgs, m)
		historyInternalUIDs = append(historyInternalUIDs, internalUID)
	}

	// Reverse so oldest first
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
		historyInternalUIDs[i], historyInternalUIDs[j] = historyInternalUIDs[j], historyInternalUIDs[i]
	}

	anonSeen := map[string]bool{}
	for i := range msgs {
		m := &msgs[i]
		internalUID := historyInternalUIDs[i]
		if m.MsgType != "user" || internalUID == "" {
			continue
		}
		anon, ok := anonSeen[internalUID]
		if !ok {
			anon = privacy.UserWantsPublicAnonymity(ctx, pool, internalUID)
			anonSeen[internalUID] = anon
		}
		if anon {
			m.Username = privacy.MaskMiddlePublicHandle(strings.TrimSpace(m.Username))
			if m.Username == "" {
				m.Username = "****"
			}
		}
	}
	return msgs, nil
}

func isUserBanned(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, error) {
	var count int
	err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM chat_bans
		 WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
		userID,
	).Scan(&count)
	return count > 0, err
}

func isUserMuted(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, time.Duration) {
	var expiresAt time.Time
	err := pool.QueryRow(ctx,
		`SELECT expires_at FROM chat_mutes
		 WHERE user_id = $1 AND expires_at > now()
		 ORDER BY expires_at DESC LIMIT 1`,
		userID,
	).Scan(&expiresAt)
	if err != nil {
		return false, 0
	}
	return true, time.Until(expiresAt)
}

func softDeleteMessage(ctx context.Context, pool *pgxpool.Pool, msgID int64, deletedBy string) error {
	_, err := pool.Exec(ctx,
		`UPDATE chat_messages SET deleted = true, deleted_by = $2 WHERE id = $1`,
		msgID, deletedBy,
	)
	return err
}

func muteUser(ctx context.Context, pool *pgxpool.Pool, userID, mutedBy, reason string, duration time.Duration) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO chat_mutes (user_id, muted_by, reason, expires_at) VALUES ($1, $2, $3, now() + $4::interval)`,
		userID, mutedBy, reason, duration.String(),
	)
	return err
}

func autoMuteUser(ctx context.Context, pool *pgxpool.Pool, userID string, duration time.Duration) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO chat_mutes (user_id, muted_by, reason, expires_at) VALUES ($1, $1, 'flood auto-mute', now() + $2::interval)`,
		userID, duration.String(),
	)
	return err
}

func banUser(ctx context.Context, pool *pgxpool.Pool, userID, bannedBy, reason string) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO chat_bans (user_id, banned_by, reason) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE SET banned_by = $2, reason = $3, created_at = now()`,
		userID, bannedBy, reason,
	)
	return err
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return strconv.Itoa(int(d.Seconds())) + " seconds"
	}
	return strconv.Itoa(int(d.Minutes())) + " minutes"
}
