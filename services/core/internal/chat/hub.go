package chat

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	clients    map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]struct{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256),
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

		case msg := <-h.broadcast:
			h.mu.RLock()
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					go h.removeClient(c)
				}
			}
			h.mu.RUnlock()
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
	h.broadcast <- data
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
