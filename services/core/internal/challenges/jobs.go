package challenges

import (
	"context"
	"encoding/json"

	"github.com/crypto-casino/core/internal/jobs"
	"github.com/redis/go-redis/v9"
)

const (
	JobBODebit  = "challenge_bo_debit"
	JobBOCredit = "challenge_bo_credit"
)

// BODebitPayload is enqueued after a successful seamless wallet debit (bet).
type BODebitPayload struct {
	UserID     string `json:"user_id"`
	RemoteID   string `json:"remote_id"`
	TxnID      string `json:"txn_id"`
	GameID     string `json:"game_id"`
	StakeMinor int64  `json:"stake_minor"`
}

// BOCreditPayload is enqueued after a successful seamless wallet credit (win).
type BOCreditPayload struct {
	UserID   string `json:"user_id"`
	RemoteID string `json:"remote_id"`
	TxnID    string `json:"txn_id"`
	GameID   string `json:"game_id"`
	WinMinor int64  `json:"win_minor"`
	Currency string `json:"currency"`
}

func EnqueueDebit(ctx context.Context, rdb *redis.Client, p BODebitPayload) error {
	if rdb == nil {
		return jobs.ErrNoQueue
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return jobs.Enqueue(ctx, rdb, jobs.Job{Type: JobBODebit, Data: raw})
}

func EnqueueCredit(ctx context.Context, rdb *redis.Client, p BOCreditPayload) error {
	if rdb == nil {
		return jobs.ErrNoQueue
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return jobs.Enqueue(ctx, rdb, jobs.Job{Type: JobBOCredit, Data: raw})
}
