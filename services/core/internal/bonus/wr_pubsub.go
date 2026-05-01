package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// WageringPubSubVersion is the JSON schema version in Redis pub/sub payloads.
const WageringPubSubVersion = 1

// ChannelWageringPlayer returns the Redis PUBLISH channel for live WR updates for a player
// (pattern: wagering:player:{user_id}).
func ChannelWageringPlayer(userID string) string {
	return "wagering:player:" + userID
}

// WageringProgressPayload is the message body for [PublishWageringProgressFromPool].
// Exposed for tests; API consumers should treat fields as best-effort / forward-compatible.
type WageringProgressPayload struct {
	SchemaVersion      int     `json:"v"`
	UserID             string  `json:"user_id"`
	Active             bool    `json:"active"`
	InstanceID         string  `json:"instance_id,omitempty"`
	WRRequiredMinor    int64   `json:"wr_required_minor,omitempty"`
	WRContributedMinor int64   `json:"wr_contributed_minor,omitempty"`
	PctComplete        float64 `json:"pct_complete,omitempty"`
}

// buildWageringProgressPayload creates a payload from an active instance row, or an inactive payload if none.
func buildWageringProgressPayload(userID, instanceID string, wrReq, wrDone int64) WageringProgressPayload {
	if instanceID == "" {
		return WageringProgressPayload{SchemaVersion: WageringPubSubVersion, UserID: userID, Active: false}
	}
	var pct float64
	if wrReq > 0 {
		pct = 100.0 * float64(wrDone) / float64(wrReq)
		if pct > 100 {
			pct = 100
		}
		pct = math.Round(pct*100) / 100
	}
	return WageringProgressPayload{
		SchemaVersion:      WageringPubSubVersion,
		UserID:             userID,
		Active:             true,
		InstanceID:         instanceID,
		WRRequiredMinor:    wrReq,
		WRContributedMinor: wrDone,
		PctComplete:        pct,
	}
}

// PublishWageringProgressFromPool loads the current active bonus instance with WR in progress
// and PUBLISHes a JSON message to channel [ChannelWageringPlayer](userID).
// Call this only after the wallet / wagering transaction has committed.
// If rdb is nil, returns nil. If the player has no in-progress WR, publishes active=false.
func PublishWageringProgressFromPool(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID string) error {
	if rdb == nil {
		return nil
	}
	var instID string
	var wrReq, wrDone int64
	err := pool.QueryRow(ctx, `
		SELECT id::text, wr_required_minor, wr_contributed_minor
		FROM user_bonus_instances
		WHERE user_id = $1::uuid
		  AND status = 'active'
		  AND wr_required_minor > 0
		ORDER BY created_at ASC
		LIMIT 1
	`, userID).Scan(&instID, &wrReq, &wrDone)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			b, mErr := json.Marshal(buildWageringProgressPayload(userID, "", 0, 0))
			if mErr != nil {
				return mErr
			}
			return rdb.Publish(ctx, ChannelWageringPlayer(userID), b).Err()
		}
		return err
	}
	b, err := json.Marshal(buildWageringProgressPayload(userID, instID, wrReq, wrDone))
	if err != nil {
		return err
	}
	return rdb.Publish(ctx, ChannelWageringPlayer(userID), b).Err()
}
