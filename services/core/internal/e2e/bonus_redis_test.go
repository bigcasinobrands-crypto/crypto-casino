package e2e

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/redis/go-redis/v9"
)

// TestE2ERedisPublishesWageringAfterGrant — miniredis + real DB.
func TestE2ERedisPublishesWageringAfterGrant(t *testing.T) {
	res := bonuse2e.NewUserWithFixedNoDepositGrant(t)
	res.RegisterCleanup(t)
	s, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	rdb := redis.NewClient(&redis.Options{Addr: s.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sub := rdb.Subscribe(ctx, bonus.ChannelWageringPlayer(res.UserID))
	defer func() { _ = sub.Close() }()
	if err := bonus.PublishWageringProgressFromPool(ctx, res.Pool, rdb, res.UserID); err != nil {
		t.Fatal(err)
	}
	msg, err3 := sub.ReceiveMessage(ctx)
	if err3 != nil {
		t.Fatalf("sub receive: %v", err3)
	}
	var p bonus.WageringProgressPayload
	if err4 := json.Unmarshal([]byte(msg.Payload), &p); err4 != nil {
		t.Fatalf("json: %v", err4)
	}
	if !p.Active || p.WRRequiredMinor != 1000 || p.UserID != res.UserID {
		t.Fatalf("payload: %+v", p)
	}
}
