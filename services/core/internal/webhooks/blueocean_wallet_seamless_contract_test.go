package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/google/uuid"
)

func TestBlueOceanInvalidKeyRejected(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	salt := "contract-invalid-key"
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt}
	h := HandleBlueOceanWallet(p, cfg, nil)
	req := httptest.NewRequest(http.MethodGet, "/?action=balance&remote_id=1&key=deadbeef", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestBlueOceanZeroDebitPersistedAndReplayed(t *testing.T) {
	res := bonuse2e.NewUserWithFixedNoDepositGrant(t)
	res.RegisterCleanup(t)
	ctx := context.Background()
	rid := "bo-z0-" + res.UserID[:8]
	_, _ = res.Pool.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2) ON CONFLICT (user_id) DO UPDATE SET remote_player_id = excluded.remote_player_id`,
		res.UserID, rid)

	salt := "contract-z-debit"
	cfg := &config.Config{BlueOceanCurrency: "USDT", BlueOceanWalletSalt: salt, BlueOceanWalletSkipBonusBetGuards: true}
	h := HandleBlueOceanWallet(res.Pool, cfg, nil)
	qs := func() string {
		return boSignGET(salt, map[string]string{
			"action": "debit", "remote_id": rid, "transaction_id": "z1", "game_id": "g1",
			"amount": "0",
		})
	}
	r1 := httptest.NewRequest(http.MethodGet, "/?"+qs(), nil)
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, r1)
	r2 := httptest.NewRequest(http.MethodGet, "/?"+qs(), nil)
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, r2)
	if !bytes.Equal(bytes.TrimSpace(w1.Body.Bytes()), bytes.TrimSpace(w2.Body.Bytes())) {
		t.Fatalf("replay mismatch:\n1=%s\n2=%s", w1.Body.String(), w2.Body.String())
	}
}

func TestBlueOceanDuplicateCreditReplaysExactJSON(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-dupc-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	rid := "2326698-" + uid[:6]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)

	salt := "contract-dup-credit"
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt, BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true}
	h := HandleBlueOceanWallet(p, cfg, nil)
	qs := func() string {
		return boSignGET(salt, map[string]string{
			"action": "credit", "remote_id": rid, "transaction_id": "shared-txn-1",
			"amount": "10", "currency": "EUR",
		})
	}
	var first []byte
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/?"+qs(), nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("iter %d: HTTP %d %s", i, w.Code, w.Body.String())
		}
		b := bytes.TrimSpace(w.Body.Bytes())
		if i == 0 {
			first = b
			continue
		}
		if !bytes.Equal(first, b) {
			t.Fatalf("iter %d body differs:\nwant %s\ngot  %s", i, first, b)
		}
	}
}

func TestBlueOceanTwoPlayersSameTransactionIDIndependent(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	mkUser := func(prefix string) (rid string) {
		uid := uuid.New().String()
		email := prefix + uid + "@e2e.local"
		if _, err := p.Exec(ctx, `
			INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
			VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
		`, uid, email, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		r := prefix + strings.ReplaceAll(uid, "-", "")[:10]
		_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, r)
		t.Cleanup(func() {
			_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
		})
		return r
	}
	rid1 := mkUser("p1")
	rid2 := mkUser("p2")
	salt := "contract-2pl"
	cfg := &config.Config{
		BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "same-table-txn-42"
	debit := func(rid string) []byte {
		q := boSignGET(salt, map[string]string{
			"action": "debit", "remote_id": rid, "transaction_id": txn, "round_id": "r1",
			"amount": "5", "currency": "EUR", "game_id": "181796",
		})
		req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("debit %s HTTP %d %s", rid, w.Code, w.Body.String())
		}
		return bytes.TrimSpace(w.Body.Bytes())
	}
	b1 := debit(rid1)
	b2 := debit(rid2)
	if bytes.Equal(b1, b2) {
		t.Fatal("expected distinct JSON responses for two players")
	}
	var o1, o2 struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	_ = json.Unmarshal(b1, &o1)
	_ = json.Unmarshal(b2, &o2)
	if o1.Status != "200" || o2.Status != "200" {
		t.Fatalf("status: %v %v", o1, o2)
	}
}

func TestBlueOceanConcurrentDuplicateDebitsReplayIdentical(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-conc-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	rid := "conc-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "contract-seed:"+uid, 10_000, nil); err != nil {
		t.Fatal(err)
	}

	salt := "contract-concurrent"
	cfg := &config.Config{
		BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "conc-dup-txn"
	q := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": txn,
		"amount": "100", "currency": "EUR", "game_id": "1",
	})
	var wg sync.WaitGroup
	const n = 10
	bodies := make([][]byte, n)
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			codes[i] = w.Code
			bodies[i] = bytes.TrimSpace(w.Body.Bytes())
		}(i)
	}
	wg.Wait()
	for i := 0; i < n; i++ {
		if codes[i] != http.StatusOK {
			t.Fatalf("request %d: HTTP %d %s", i, codes[i], string(bodies[i]))
		}
		if i > 0 && !bytes.Equal(bodies[0], bodies[i]) {
			t.Fatalf("body %d differs", i)
		}
	}
}

func TestBlueOceanCreditWithoutDebitAccepted(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-orph-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	rid := "orph-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-orph-credit"
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt, BlueOceanWalletIntegerAmountIsMajorUnits: true}
	h := HandleBlueOceanWallet(p, cfg, nil)
	q := boSignGET(salt, map[string]string{
		"action": "credit", "remote_id": rid, "transaction_id": "orph-win",
		"amount": "25", "currency": "EUR",
	})
	req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("HTTP %d %s", w.Code, w.Body.String())
	}
	var o struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &o)
	if o.Status != "200" {
		t.Fatalf("want 200 status field got %v", o.Status)
	}
}

func TestBlueOceanRollbackUnknownTxReplays404(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-rb404-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	rid := "rb404-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-rb404"
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt}
	h := HandleBlueOceanWallet(p, cfg, nil)
	qs := func() string {
		return boSignGET(salt, map[string]string{
			"action": "rollback", "remote_id": rid, "transaction_id": "nope",
		})
	}
	r1 := httptest.NewRequest(http.MethodGet, "/?"+qs(), nil)
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, r1)
	b1 := bytes.TrimSpace(w1.Body.Bytes())
	r2 := httptest.NewRequest(http.MethodGet, "/?"+qs(), nil)
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, r2)
	b2 := bytes.TrimSpace(w2.Body.Bytes())
	if !bytes.Equal(b1, b2) {
		t.Fatalf("404 replay mismatch: %s vs %s", b1, b2)
	}
	var o struct {
		Status string `json:"status"`
		Msg    string `json:"msg"`
	}
	_ = json.Unmarshal(b1, &o)
	if o.Status != "404" || !strings.Contains(strings.ToUpper(o.Msg), "TRANSACTION") {
		t.Fatalf("expected 404 TRANSACTION_NOT_FOUND in JSON, got status=%q msg=%q raw=%s", o.Status, o.Msg, b1)
	}
}
