package webhooks

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/crypto-casino/core/internal/config"
	"github.com/google/uuid"
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

	salt := "e2e-wallet-salt"
	cfg := &config.Config{BlueOceanCurrency: "USDT", BlueOceanWalletSalt: salt}
	h := HandleBlueOceanWallet(res.Pool, cfg, rdb)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	sub := rdb.Subscribe(ctx, bonus.ChannelWageringPlayer(res.UserID))
	defer func() { _ = sub.Close() }()

	rid := "bo-e2e-" + res.UserID
	q := boSignGET(salt, map[string]string{
		"action":          "debit",
		"amount":          "1000",
		"remote_id":       rid,
		"game_id":         "slot1",
		"transaction_id":  "tx1",
	})
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

// TestE2EBlueOceanDuplicateDebitIdempotent replays the same debit (same transaction_id); balance must not drop twice (BO advanced wallet tests).
func TestE2EBlueOceanDuplicateDebitIdempotent(t *testing.T) {
	res := bonuse2e.NewUserWithFixedNoDepositGrant(t)
	res.RegisterCleanup(t)
	_, _ = res.Pool.Exec(res.Ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2) ON CONFLICT (user_id) DO UPDATE SET remote_player_id = EXCLUDED.remote_player_id`,
		res.UserID, "bo-e2e-dup-"+res.UserID)

	salt := "e2e-wallet-dup-salt"
	cfg := &config.Config{BlueOceanCurrency: "USDT", BlueOceanWalletSalt: salt}
	h := HandleBlueOceanWallet(res.Pool, cfg, nil)

	rid := "bo-e2e-dup-" + res.UserID
	qs := func() string {
		return boSignGET(salt, map[string]string{
			"action":         "debit",
			"amount":         "1000",
			"remote_id":      rid,
			"game_id":        "slot1",
			"transaction_id": "tx-dup-1",
		})
	}
	req1 := httptest.NewRequest("GET", "/?"+qs(), nil)
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, req1)
	if w1.Code != 200 {
		t.Fatalf("first: code=%d body=%s", w1.Code, w1.Body.String())
	}
	var b1 struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(w1.Body.Bytes(), &b1); err != nil {
		t.Fatal(err)
	}
	if b1.Status != "200" {
		t.Fatalf("first: status=%v body=%s", b1.Status, w1.Body.String())
	}

	req2 := httptest.NewRequest("GET", "/?"+qs(), nil)
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("second: code=%d body=%s", w2.Code, w2.Body.String())
	}
	var b2 struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &b2); err != nil {
		t.Fatal(err)
	}
	if b2.Status != "200" {
		t.Fatalf("second: status=%v body=%s", b2.Status, w2.Body.String())
	}
	if b1.Balance != b2.Balance {
		t.Fatalf("duplicate debit changed balance: first=%v second=%v", b1.Balance, b2.Balance)
	}
}

// TestE2EBlueOceanDebitAllowsNegativeBalanceWhenConfigured matches BO GH1-style sandboxes that expect
// an empty wallet to accept a debit and report a negative balance when this opt-in is enabled.
func TestE2EBlueOceanDebitAllowsNegativeBalanceWhenConfigured(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()

	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-neg-" + uid + "@e2e.local"
	_, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})

	rid := "bo-neg-" + strings.ReplaceAll(uid, "-", "")
	_, err = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	if err != nil {
		t.Fatal(err)
	}

	salt := "e2e-neg-salt"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletAllowNegativeBalance:      true,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)

	q := boSignGET(salt, map[string]string{
		"action":         "debit",
		"amount":         "5",
		"remote_id":      rid,
		"transaction_id": "tx-neg-1",
		"game_id":        "181796",
		"currency":       "EUR",
	})
	req := httptest.NewRequest("GET", "/?"+q, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Status != "200" || out.Balance != "-5" {
		t.Fatalf("got status=%q balance=%q body=%s", out.Status, out.Balance, w.Body.String())
	}
}
