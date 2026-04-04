package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const queueKey = "casino:jobs"

// ErrNoQueue means Redis is not configured — callers should process synchronously.
var ErrNoQueue = errors.New("job queue unavailable")

type Job struct {
	Type string          `json:"type"`
	ID   int64           `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

func Enqueue(ctx context.Context, rdb *redis.Client, j Job) error {
	if rdb == nil {
		return ErrNoQueue
	}
	b, err := json.Marshal(j)
	if err != nil {
		return err
	}
	return rdb.LPush(ctx, queueKey, b).Err()
}

func Pop(ctx context.Context, rdb *redis.Client) (*Job, error) {
	res, err := rdb.BRPop(ctx, 0, queueKey).Result()
	if err != nil {
		return nil, err
	}
	if len(res) < 2 {
		return nil, fmt.Errorf("unexpected brpop result")
	}
	var j Job
	if err := json.Unmarshal([]byte(res[1]), &j); err != nil {
		return nil, err
	}
	return &j, nil
}
