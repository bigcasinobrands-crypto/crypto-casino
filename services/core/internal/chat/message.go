package chat

import "encoding/json"

// Envelope wraps every WebSocket frame with a discriminator.
type Envelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// InboundMessage is what the client sends.
type InboundMessage struct {
	Type string `json:"type"`
	Body string `json:"body"`
}

// OutboundMessage is broadcast to all clients.
type OutboundMessage struct {
	ID            int64    `json:"id,omitempty"`
	ParticipantID string   `json:"participant_id,omitempty"`
	Username      string   `json:"username,omitempty"`
	Body          string   `json:"body"`
	MsgType       string   `json:"msg_type"`
	VipRank       string   `json:"vip_rank,omitempty"`
	AvatarURL     string   `json:"avatar_url,omitempty"`
	CreatedAt     string   `json:"created_at"`
	Mentions      []string `json:"mentions,omitempty"`
}

// ErrorData is sent back to a single client on validation failures.
type ErrorData struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// DeleteData tells clients to remove a message.
type DeleteData struct {
	MessageID int64 `json:"message_id"`
}
