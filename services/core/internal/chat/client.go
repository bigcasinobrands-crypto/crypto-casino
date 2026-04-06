package chat

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

const (
	maxMessageLen = 500
	maxReadBytes  = 4096
	minMsgInterval = time.Second
	writeWait      = 10 * time.Second
	pingInterval   = 30 * time.Second
	sendChanSize   = 64
	minAccountAge  = 5 * time.Minute
)

type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	userID    string
	username  string
	vipRank   string
	avatarURL string
	createdAt time.Time
	send      chan []byte
	lastMsg   time.Time
	pool      *pgxpool.Pool
	flood     *FloodTracker
	dupes     *DuplicateTracker
}

func (c *Client) ReadPump(ctx context.Context) {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	c.conn.SetReadLimit(maxReadBytes)

	for {
		var in InboundMessage
		err := wsjson.Read(ctx, c.conn, &in)
		if err != nil {
			if websocket.CloseStatus(err) != -1 {
				return
			}
			log.Printf("chat: read error user=%s: %v", c.userID, err)
			return
		}

		if in.Type != "message" {
			continue
		}

		body := SanitizeBody(in.Body, maxMessageLen)
		if body == "" {
			continue
		}

		if time.Since(c.createdAt) < minAccountAge {
			c.sendError("account_too_new", "Your account must be at least 5 minutes old to chat")
			continue
		}

		if banned, _ := isUserBanned(ctx, c.pool, c.userID); banned {
			c.sendError("banned", "You are banned from chat")
			return
		}

		if muted, remaining := isUserMuted(ctx, c.pool, c.userID); muted {
			c.sendError("muted", "You are muted for "+formatDuration(remaining))
			continue
		}

		if time.Since(c.lastMsg) < minMsgInterval {
			c.sendError("rate_limit", "Slow down")
			continue
		}

		if c.flood.Record(c.userID) {
			_ = autoMuteUser(ctx, c.pool, c.userID, 30*time.Second)
			c.sendError("muted", "You are muted for 30 seconds (flood)")
			continue
		}

		if c.dupes.IsDuplicate(c.userID, body) {
			c.sendError("filtered", "Duplicate message")
			continue
		}

		if ContainsLink(body) {
			c.sendError("filtered", "Links are not allowed")
			continue
		}

		body = FilterProfanity(body)
		mentions := ParseMentions(body)
		c.lastMsg = time.Now()

		now := timeNowUTC()
		msg := OutboundMessage{
			UserID:    c.userID,
			Username:  c.username,
			Body:      body,
			MsgType:   "user",
			VipRank:   c.vipRank,
			AvatarURL: c.avatarURL,
			CreatedAt: now,
			Mentions:  mentions,
		}

		go func() {
			id, err := insertMessage(context.Background(), c.pool, c.userID, c.username, body, "user", c.vipRank)
			if err != nil {
				log.Printf("chat: insert message: %v", err)
			}
			msg.ID = id
			env := Envelope{Type: "message", Data: json.RawMessage(mustMarshal(msg))}
			data, _ := json.Marshal(env)
			c.hub.broadcast <- data
		}()
	}
}

func (c *Client) WritePump(ctx context.Context) {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Write(writeCtx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}

		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}

		case <-ctx.Done():
			return
		}
	}
}

func (c *Client) sendError(code, message string) {
	env := Envelope{
		Type: "error",
		Data: json.RawMessage(mustMarshal(ErrorData{Code: code, Message: message})),
	}
	data, _ := json.Marshal(env)
	select {
	case c.send <- data:
	default:
	}
}

func timeNowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}
