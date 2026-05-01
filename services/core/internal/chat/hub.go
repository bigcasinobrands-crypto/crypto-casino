package chat

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/crypto-casino/core/internal/privacy"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Hub struct {
	clients    map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	broadcast  chan any
	pool       *pgxpool.Pool
	mu         sync.RWMutex
}

// fanoutUserMessage triggers per-recipient masking for privacy-aware players.
type fanoutUserMessage struct {
	msg         OutboundMessage
	internalUID string
}

func NewHub(pool *pgxpool.Pool) *Hub {
	return &Hub{
		clients:    make(map[*Client]struct{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan any, 256),
		pool:       pool,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			count := len(h.clients)
			h.mu.Unlock()
			h.broadcastOnlineCount(count)

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			count := len(h.clients)
			h.mu.Unlock()
			h.broadcastOnlineCount(count)

		case item := <-h.broadcast:
			switch v := item.(type) {
			case []byte:
				h.mu.RLock()
				for c := range h.clients {
					select {
					case c.send <- v:
					default:
						go h.removeClient(c)
					}
				}
				h.mu.RUnlock()
			case fanoutUserMessage:
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				var anon bool
				if h.pool != nil && v.msg.MsgType == "user" && v.internalUID != "" {
					anon = privacy.UserWantsPublicAnonymity(ctx, h.pool, v.internalUID)
				}
				cancel()
				h.mu.RLock()
				for c := range h.clients {
					out := v.msg
					if v.msg.MsgType == "user" && anon {
						out.Username = privacy.MaskMiddlePublicHandle(strings.TrimSpace(v.msg.Username))
						if out.Username == "" {
							out.Username = "****"
						}
					}
					env := Envelope{Type: "message", Data: json.RawMessage(mustMarshal(out))}
					data, err := json.Marshal(env)
					if err != nil {
						continue
					}
					select {
					case c.send <- data:
					default:
						go h.removeClient(c)
					}
				}
				h.mu.RUnlock()
			default:
				log.Printf("chat: unknown broadcast type %T", item)
			}
		}
	}
}

func (h *Hub) removeClient(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
}

func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// DisconnectUser force-closes every connection belonging to userID.
func (h *Hub) DisconnectUser(userID string) {
	h.mu.RLock()
	var targets []*Client
	for c := range h.clients {
		if c.userID == userID {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.conn.Close(4001, "banned")
	}
}

func (h *Hub) broadcastOnlineCount(count int) {
	env := Envelope{Type: "online_count", Data: json.RawMessage(mustMarshal(map[string]int{"count": count}))}
	data, err := json.Marshal(env)
	if err != nil {
		log.Printf("chat: marshal online_count: %v", err)
		return
	}
	h.mu.RLock()
	for c := range h.clients {
		select {
		case c.send <- data:
		default:
		}
	}
	h.mu.RUnlock()
}

// BroadcastSystem injects a system or rain message into the chat from server-side code.
func (h *Hub) BroadcastSystem(msgType, body string) {
	msg := OutboundMessage{
		MsgType:   msgType,
		Body:      body,
		CreatedAt: timeNowUTC(),
	}
	env := Envelope{Type: msgType, Data: json.RawMessage(mustMarshal(msg))}
	data, err := json.Marshal(env)
	if err != nil {
		log.Printf("chat: marshal system: %v", err)
		return
	}
	h.broadcast <- data // []byte uniform frame
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
