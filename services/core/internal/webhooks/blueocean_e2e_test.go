package webhooks

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/crypto-casino/core/internal/config"
	"github.com/redis/go-redis/v9"
)

// TestE2EBlueOceanDebitPublishesWageringRedis runs the seamless GET callback with miniredis + DB
// (BONUS_E2E_DATABASE_URL). After a grant, a debit that uses only bonus_locked must PUBLISH one WR message.
func TestE2EBlueOceanDebitPublishesWageringRedis(t *testing.T) {
	res := bonuse2e.NewUserWithFixedNoDepositGrant(t)
	res.RegisterCleanup(t)
	_, _ = res.Pool.Exec(res.Ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2) ON CONFLICT (user_id) DO UPDATE SET remote_player_id = EXCLUDED.remote_player_id`,
		res.UserID, "bo-e2e-"+res.UserID)

	s, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	rdb := redis.NewClient(&redis.Options{Addr: s.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cfg := &config.Config{BlueOceanCurrency: "USDT"}
	// Empty salt => no key= signature for GET callback
	h := HandleBlueOceanWallet(res.Pool, cfg, rdb)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	sub := rdb.Subscribe(ctx, bonus.ChannelWageringPlayer(res.UserID))
	defer func() { _ = sub.Close() }()

	q := "action=debit&amount=1000&remote_id=bo-e2e-" + res.UserID + "&game_id=slot1&transaction_id=tx1"
	req := httptest.NewRequest("GET", "/api/blueocean/callback?"+q, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}

	msg, err := sub.ReceiveMessage(ctx)
	if err != nil {
		t.Fatalf("redis: %v", err)
	}
	var p map[string]any
	if err := json.Unmarshal([]byte(msg.Payload), &p); err != nil {
		t.Fatal(err)
	}
	// One completion bet may yield active false if WR is complete in same tx; either is acceptable
	if p["v"] == nil || p["user_id"] != res.UserID {
		t.Fatalf("bad payload: %s", msg.Payload)
	}
}
