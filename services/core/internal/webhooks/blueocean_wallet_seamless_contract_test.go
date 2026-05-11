package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	if w.Code != http.StatusOK {
		t.Fatalf("want HTTP 200 (JSON status in body) got %d body=%s", w.Code, w.Body.String())
	}
	var o struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &o); err != nil {
		t.Fatal(err)
	}
	if o.Status != "401" {
		t.Fatalf("want JSON status 401 got %q body=%s", o.Status, w.Body.String())
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

// TestBlueOceanAllowsSameTransactionIDForDifferentPlayers (regression: BlueOcean reuses transaction_id per table round;
// idempotency must be per player, not global on transaction_id.)
func TestBlueOceanAllowsSameTransactionIDForDifferentPlayers(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	mkPlayer := func(prefix string, seedMinor int64) (uid, rid string) {
		uid = uuid.New().String()
		email := prefix + uid + "@e2e.local"
		if _, err := p.Exec(ctx, `
			INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
			VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
		`, uid, email, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", prefix+":seed:"+uid, seedMinor, nil); err != nil {
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
		return uid, r
	}
	uidA, ridA := mkPlayer("boa", 100_000) // 1000.00 EUR display
	uidB, ridB := mkPlayer("bob", 29_000)  // 290.00 EUR display
	salt := "contract-2pl-same-txn"
	cfg := &config.Config{
		BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "same-table-txn-42"
	gameID := "181796"
	roundID := "r-shared-1"
	debit := func(rid string) (bal string) {
		q := boSignGET(salt, map[string]string{
			"action": "debit", "remote_id": rid, "transaction_id": txn, "round_id": roundID,
			"amount": "5", "currency": "EUR", "game_id": gameID,
		})
		req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("debit %s HTTP %d %s", rid, w.Code, w.Body.String())
		}
		var o struct {
			Status  string `json:"status"`
			Balance string `json:"balance"`
		}
		if err := json.Unmarshal(bytes.TrimSpace(w.Body.Bytes()), &o); err != nil {
			t.Fatal(err)
		}
		if o.Status != "200" {
			t.Fatalf("status want 200 got %q body=%s", o.Status, w.Body.String())
		}
		return o.Balance
	}
	balA := debit(ridA)
	balB := debit(ridB)
	if balA != "995" {
		t.Fatalf("player A balance want 995 got %q", balA)
	}
	if balB != "285" {
		t.Fatalf("player B balance want 285 got %q", balB)
	}
	var nStore int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM blueocean_wallet_transactions
		WHERE provider = 'blueocean' AND transaction_id = $1 AND action = 'debit'
	`, txn).Scan(&nStore); err != nil {
		t.Fatal(err)
	}
	if nStore != 2 {
		t.Fatalf("blueocean_wallet_transactions rows want 2 got %d", nStore)
	}
	countDebits := func(uid string) int {
		var c int
		_ = p.QueryRow(ctx, `
			SELECT COUNT(*) FROM ledger_entries
			WHERE user_id = $1::uuid AND entry_type = 'game.debit'
		`, uid).Scan(&c)
		return c
	}
	if a, b := countDebits(uidA), countDebits(uidB); a != 1 || b != 1 {
		t.Fatalf("game.debit rows want 1 each got A=%d B=%d", a, b)
	}
}

// TestBlueocean_two_players_same_transaction_id_process_independently locks idempotency to (user_id, action, transaction_id)
// so two players can share the same BlueOcean transaction_id and round_id without balance collision.
func TestBlueocean_two_players_same_transaction_id_process_independently(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	mk := func(remote string, seedMinor int64) (uid string) {
		uid = uuid.New().String()
		email := "bo2p-" + remote + "-" + uid[:6] + "@e2e.local"
		if _, err := p.Exec(ctx, `
			INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
			VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
		`, uid, email, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "two-player:"+remote+":"+uid, seedMinor, nil); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, remote); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
		})
		return uid
	}
	uidA := mk("A", 101_500) // 1015.00 EUR display
	uidB := mk("B", 100_000) // 1000.00 EUR — independent wallet
	salt := "reg-two-players-same-txn"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "shared-financial-txn-99"
	gameID := "g-shared"
	roundID := "r-shared"
	debit := func(rid string) (bal, st string) {
		q := boSignGET(salt, map[string]string{
			"action": "debit", "remote_id": rid, "transaction_id": txn, "round_id": roundID,
			"amount": "5", "currency": "EUR", "game_id": gameID,
		})
		req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("debit remote=%s HTTP %d %s", rid, w.Code, w.Body.String())
		}
		var o struct {
			Status  string `json:"status"`
			Balance string `json:"balance"`
		}
		if err := json.Unmarshal(bytes.TrimSpace(w.Body.Bytes()), &o); err != nil {
			t.Fatal(err)
		}
		return o.Balance, o.Status
	}
	balA, stA := debit("A")
	balB, stB := debit("B")
	if stA != "200" || stB != "200" {
		t.Fatalf("status want 200 got %q and %q", stA, stB)
	}
	if balA != "1010" {
		t.Fatalf("player A balance want 1010 got %q", balA)
	}
	if balB != "995" {
		t.Fatalf("player B balance want 995 got %q (should not see 0 from wrong-wallet idempotency)", balB)
	}
	var nStore int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM blueocean_wallet_transactions
		WHERE provider = 'blueocean' AND transaction_id = $1 AND action = 'debit'
	`, txn).Scan(&nStore); err != nil {
		t.Fatal(err)
	}
	if nStore != 2 {
		t.Fatalf("blueocean_wallet_transactions debit rows want 2 got %d", nStore)
	}
	for _, pair := range []struct {
		uid  string
		rid  string
		want int
	}{
		{uidA, "A", 1},
		{uidB, "B", 1},
	} {
		var c int
		if err := p.QueryRow(ctx, `
			SELECT COUNT(*) FROM blueocean_wallet_transactions
			WHERE provider = 'blueocean' AND user_id = $1::uuid AND remote_id = $2 AND action = 'debit' AND transaction_id = $3
		`, pair.uid, pair.rid, txn).Scan(&c); err != nil {
			t.Fatal(err)
		}
		if c != pair.want {
			t.Fatalf("wallet row for user %s remote %s want %d got %d", pair.uid, pair.rid, pair.want, c)
		}
		var leg int
		if err := p.QueryRow(ctx, `
			SELECT COUNT(*) FROM ledger_entries
			WHERE user_id = $1::uuid AND entry_type = 'game.debit'
		`, pair.uid).Scan(&leg); err != nil {
			t.Fatal(err)
		}
		if leg != 1 {
			t.Fatalf("ledger game.debit for %s want 1 got %d", pair.rid, leg)
		}
	}
}

// TestBlueOceanDuplicateDebitSamePlayerReturnsOriginalResponse (regression: replay same debit is idempotent per player.)
func TestBlueOceanDuplicateDebitSamePlayerReturnsOriginalResponse(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-dupd-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "dupd-seed:"+uid, 100_000, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	rid := "dupd-" + strings.ReplaceAll(uid, "-", "")[:10]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)

	salt := "contract-dup-debit-same-player"
	cfg := &config.Config{
		BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "idem-txn-X"
	q := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": txn,
		"amount": "5", "currency": "EUR", "game_id": "1",
	})
	var first []byte
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("iter %d HTTP %d %s", i, w.Code, w.Body.String())
		}
		b := bytes.TrimSpace(w.Body.Bytes())
		if i == 0 {
			first = b
			continue
		}
		if !bytes.Equal(first, b) {
			t.Fatalf("duplicate replay body differs:\nfirst %s\nsecond %s", first, b)
		}
	}
	var o struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(first, &o); err != nil {
		t.Fatal(err)
	}
	if o.Balance != "995" {
		t.Fatalf("balance want 995 got %q", o.Balance)
	}
	var nDebit int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = 'game.debit'
	`, uid).Scan(&nDebit); err != nil {
		t.Fatal(err)
	}
	if nDebit != 1 {
		t.Fatalf("game.debit rows want 1 got %d", nDebit)
	}
}

func TestBlueOceanConcurrentDuplicateDebitsReplayIdentical(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-conc-leg-" + uid + "@e2e.local"
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

	salt := "contract-concurrent-legacy"
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
	n := blueOceanConcurrencyNSizes[len(blueOceanConcurrencyNSizes)-1]
	var wg sync.WaitGroup
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

// Regression: rollback must resolve the original debit from blueocean_wallet_transactions using
// remote_id + transaction_id only (no amount / game_id / round_id in callback), including when
// ledger keys used txn+"::"+round from the original debit.
func TestBlueOceanRollbackWithoutMetaFindsOriginalDebit(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-rb-meta-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "rb-meta-seed:"+uid, 101_000, nil); err != nil {
		t.Fatal(err)
	}
	rid := "rbmeta-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)

	salt := "contract-rb-nometa"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
		BlueOceanWalletLedgerTxnUsesRound:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "ez-cfc172a9413aa61b25ae0027c2a5c17d"
	qDebit := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": txn,
		"amount": "5", "currency": "EUR", "game_id": "g1", "round_id": "round-99",
	})
	wd := httptest.NewRecorder()
	h.ServeHTTP(wd, httptest.NewRequest(http.MethodGet, "/?"+qDebit, nil))
	if wd.Code != http.StatusOK {
		t.Fatalf("debit HTTP %d %s", wd.Code, wd.Body.String())
	}
	var deb struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(wd.Body.Bytes()), &deb); err != nil {
		t.Fatal(err)
	}
	if deb.Status != "200" || deb.Balance != "1005" {
		t.Fatalf("after debit want balance 1005 got status=%q bal=%q", deb.Status, deb.Balance)
	}

	qRb := boSignGET(salt, map[string]string{
		"action": "rollback", "remote_id": rid, "transaction_id": txn,
	})
	wr1 := httptest.NewRecorder()
	h.ServeHTTP(wr1, httptest.NewRequest(http.MethodGet, "/?"+qRb, nil))
	if wr1.Code != http.StatusOK {
		t.Fatalf("rollback HTTP %d %s", wr1.Code, wr1.Body.String())
	}
	var rb1 struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(wr1.Body.Bytes()), &rb1); err != nil {
		t.Fatal(err)
	}
	if rb1.Status != "200" || rb1.Balance != "1010" {
		t.Fatalf("rollback want 1010 got status=%q bal=%q body=%s", rb1.Status, rb1.Balance, wr1.Body.String())
	}
	var rolled bool
	if err := p.QueryRow(ctx, `
		SELECT rolled_back FROM blueocean_wallet_transactions
		WHERE user_id = $1::uuid AND action = 'debit' AND transaction_id = $2 AND provider = 'blueocean'
	`, uid, txn).Scan(&rolled); err != nil {
		t.Fatal(err)
	}
	if !rolled {
		t.Fatal("debit row should be marked rolled_back")
	}

	wr2 := httptest.NewRecorder()
	h.ServeHTTP(wr2, httptest.NewRequest(http.MethodGet, "/?"+qRb, nil))
	if wr2.Code != http.StatusOK {
		t.Fatalf("dup rollback HTTP %d %s", wr2.Code, wr2.Body.String())
	}
	if !bytes.Equal(bytes.TrimSpace(wr1.Body.Bytes()), bytes.TrimSpace(wr2.Body.Bytes())) {
		t.Fatalf("duplicate rollback should replay exact JSON:\n%s\nvs\n%s", wr1.Body.String(), wr2.Body.String())
	}
	var rbCount int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM blueocean_wallet_transactions
		WHERE user_id = $1::uuid AND action = 'rollback' AND provider = 'blueocean'
	`, uid).Scan(&rbCount); err != nil {
		t.Fatal(err)
	}
	if rbCount != 1 {
		t.Fatalf("rollback wallet rows want 1 got %d", rbCount)
	}
	var legRollback int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = 'game.rollback'
	`, uid).Scan(&legRollback); err != nil {
		t.Fatal(err)
	}
	if legRollback != 1 {
		t.Fatalf("game.rollback ledger rows want 1 got %d", legRollback)
	}
}

// TestBlueOceanRollbackCreditReversesWin: rollback references the credit (win) transaction_id; no original debit match required.
func TestBlueOceanRollbackCreditReversesWin(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-rbcr-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "rbcr-seed:"+uid, 101_000, nil); err != nil {
		t.Fatal(err)
	}
	rid := "2326698-rbcrev-" + uid[:6]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)

	salt := "contract-rb-credit-win"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)

	debitTxn := "ez-f7039ef164366ee01c3a1b19bb7aa201"
	winTxn := "ez-993fb83612faf655ac2ba6fbf8132f43"
	round := "b25c7fed0f22d1e3487bea85d5663b7d"

	qDebit := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": debitTxn,
		"amount": "5", "currency": "EUR", "game_id": "g1", "round_id": round,
	})
	wd := httptest.NewRecorder()
	h.ServeHTTP(wd, httptest.NewRequest(http.MethodGet, "/?"+qDebit, nil))
	if wd.Code != http.StatusOK {
		t.Fatalf("debit HTTP %d %s", wd.Code, wd.Body.String())
	}

	qCredit := boSignGET(salt, map[string]string{
		"action": "credit", "remote_id": rid, "transaction_id": winTxn,
		"amount": "10", "currency": "EUR", "game_id": "g1", "round_id": round,
	})
	wc := httptest.NewRecorder()
	h.ServeHTTP(wc, httptest.NewRequest(http.MethodGet, "/?"+qCredit, nil))
	if wc.Code != http.StatusOK {
		t.Fatalf("credit HTTP %d %s", wc.Code, wc.Body.String())
	}
	var cr struct {
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(wc.Body.Bytes()), &cr); err != nil {
		t.Fatal(err)
	}
	if cr.Balance != "1015" {
		t.Fatalf("after credit want 1015 got %q", cr.Balance)
	}

	qRb := boSignGET(salt, map[string]string{
		"action": "rollback", "remote_id": rid, "transaction_id": winTxn, "round_id": round,
	})
	wr := httptest.NewRecorder()
	h.ServeHTTP(wr, httptest.NewRequest(http.MethodGet, "/?"+qRb, nil))
	if wr.Code != http.StatusOK {
		t.Fatalf("rollback HTTP %d %s", wr.Code, wr.Body.String())
	}
	var rb struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(wr.Body.Bytes()), &rb); err != nil {
		t.Fatal(err)
	}
	if rb.Status != "200" || rb.Balance != "1005" {
		t.Fatalf("rollback want 200 balance 1005 got status=%q bal=%q", rb.Status, rb.Balance)
	}
	var creditRolled bool
	if err := p.QueryRow(ctx, `
		SELECT rolled_back FROM blueocean_wallet_transactions
		WHERE user_id = $1::uuid AND action = 'credit' AND transaction_id = $2 AND provider = 'blueocean'
	`, uid, winTxn).Scan(&creditRolled); err != nil {
		t.Fatal(err)
	}
	if !creditRolled {
		t.Fatal("credit row should be rolled_back")
	}
	var winRollbackCount int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = 'game.win_rollback'
	`, uid).Scan(&winRollbackCount); err != nil {
		t.Fatal(err)
	}
	if winRollbackCount != 1 {
		t.Fatalf("game.win_rollback rows want 1 got %d", winRollbackCount)
	}
}

func TestBlueOceanDuplicateRollbackCreditReplaysJSON(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-duprbc-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "duprbc:"+uid, 100_500, nil); err != nil {
		t.Fatal(err)
	}
	rid := "duprbc-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-dup-rb-credit"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	winTxn := "ez-win-dup-" + uid[:8]
	qCredit := boSignGET(salt, map[string]string{
		"action": "credit", "remote_id": rid, "transaction_id": winTxn,
		"amount": "10", "currency": "EUR", "game_id": "1",
	})
	wc := httptest.NewRecorder()
	h.ServeHTTP(wc, httptest.NewRequest(http.MethodGet, "/?"+qCredit, nil))
	if wc.Code != http.StatusOK {
		t.Fatalf("credit HTTP %d %s", wc.Code, wc.Body.String())
	}
	qRb := boSignGET(salt, map[string]string{"action": "rollback", "remote_id": rid, "transaction_id": winTxn})
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, httptest.NewRequest(http.MethodGet, "/?"+qRb, nil))
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/?"+qRb, nil))
	if w1.Code != http.StatusOK || w2.Code != http.StatusOK {
		t.Fatalf("rollback HTTP %d / %d", w1.Code, w2.Code)
	}
	if !bytes.Equal(bytes.TrimSpace(w1.Body.Bytes()), bytes.TrimSpace(w2.Body.Bytes())) {
		t.Fatalf("duplicate rollback credit should replay exact JSON:\n%s\nvs\n%s", w1.Body.String(), w2.Body.String())
	}
	var n int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = 'game.win_rollback'
	`, uid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("win_rollback ledger rows want 1 got %d", n)
	}
}

func TestBlueOceanRollbackDebitTransactionStillWorks(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-rbdebit-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "rbdebit:"+uid, 100_000, nil); err != nil {
		t.Fatal(err)
	}
	rid := "rbdebit-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-rb-debit-still"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "debit-still-" + uid[:6]
	qd := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": txn,
		"amount": "5", "currency": "EUR", "game_id": "1",
	})
	wd := httptest.NewRecorder()
	h.ServeHTTP(wd, httptest.NewRequest(http.MethodGet, "/?"+qd, nil))
	if wd.Code != http.StatusOK {
		t.Fatalf("debit HTTP %d %s", wd.Code, wd.Body.String())
	}
	qr := boSignGET(salt, map[string]string{"action": "rollback", "remote_id": rid, "transaction_id": txn})
	wr := httptest.NewRecorder()
	h.ServeHTTP(wr, httptest.NewRequest(http.MethodGet, "/?"+qr, nil))
	var rb struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(wr.Body.Bytes()), &rb); err != nil {
		t.Fatal(err)
	}
	if rb.Status != "200" || rb.Balance != "1000" {
		t.Fatalf("after rollback want 1000 got status=%q bal=%q body=%s", rb.Status, rb.Balance, wr.Body.String())
	}
}

func TestBlueOceanTwoPlayerSameTxnSecondPlayerNegativeWithTestFlag(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	mk := func(remote string, seedMinor int64) (uid string) {
		uid = uuid.New().String()
		email := "bo2neg-" + remote + "-" + uid[:6] + "@e2e.local"
		if _, err := p.Exec(ctx, `
			INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
			VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
		`, uid, email, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		if seedMinor > 0 {
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "2neg:"+remote+uid, seedMinor, nil); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, remote); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
			_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
		})
		return uid
	}
	_ = mk("2326698", 101_500)
	_ = mk("2326702", 0)

	salt := "contract-2p-neg"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
		BlueOceanAllowNegativeTestBalance:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "shared-txn-two-player-neg"
	round := "shared-round-neg"
	gameID := "g1"
	debit := func(rid string) (bal, st string) {
		q := boSignGET(salt, map[string]string{
			"action": "debit", "remote_id": rid, "transaction_id": txn, "round_id": round,
			"amount": "5", "currency": "EUR", "game_id": gameID,
		})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/?"+q, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("debit %s HTTP %d %s", rid, w.Code, w.Body.String())
		}
		var o struct {
			Status  string `json:"status"`
			Balance string `json:"balance"`
		}
		if err := json.Unmarshal(bytes.TrimSpace(w.Body.Bytes()), &o); err != nil {
			t.Fatal(err)
		}
		return o.Balance, o.Status
	}
	balA, stA := debit("2326698")
	balB, stB := debit("2326702")
	if stA != "200" || stB != "200" {
		t.Fatalf("status want 200 got %q %q", stA, stB)
	}
	if balA != "1010" {
		t.Fatalf("player A want 1010 got %q", balA)
	}
	if balB != "-5" {
		t.Fatalf("player B want -5 got %q", balB)
	}
}

func TestBlueOceanInsufficientFundsWhenNegativeModesOff(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-if-" + uid + "@e2e.local"
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
	rid := "ifblk-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-if-off"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
		BlueOceanWalletAllowNegativeBalance:      false,
		BlueOceanAllowNegativeTestBalance:        false,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	q := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": "if-1",
		"amount": "5", "currency": "EUR", "game_id": "1",
	})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/?"+q, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("HTTP %d %s", w.Code, w.Body.String())
	}
	var o struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(w.Body.Bytes()), &o); err != nil {
		t.Fatal(err)
	}
	if o.Status != "403" {
		t.Fatalf("want 403 insufficient funds got status=%q body=%s", o.Status, w.Body.String())
	}
}

func TestBlueOceanDebitBareTxnReplayedWhenEzDuplicateRequested(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-ezbr-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "ezbr-seed:"+uid, 100_000, nil); err != nil {
		t.Fatal(err)
	}
	rid := "ezbr-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-ez-bare-dup"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	hexID := "a1b2c3d4e5f6789012345678abcdef01234567"
	qEz := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": "ez-" + hexID,
		"amount": "5", "currency": "EUR", "game_id": "1",
	})
	qBare := boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": hexID,
		"amount": "5", "currency": "EUR", "game_id": "1",
	})
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, httptest.NewRequest(http.MethodGet, "/?"+qEz, nil))
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/?"+qBare, nil))
	if w1.Code != http.StatusOK || w2.Code != http.StatusOK {
		t.Fatalf("HTTP ez=%d bare=%d", w1.Code, w2.Code)
	}
	if !bytes.Equal(bytes.TrimSpace(w1.Body.Bytes()), bytes.TrimSpace(w2.Body.Bytes())) {
		t.Fatalf("idempotent debit replay mismatch")
	}
	var nLeg int
	if err := p.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries WHERE user_id = $1::uuid AND entry_type = 'game.debit'
	`, uid).Scan(&nLeg); err != nil {
		t.Fatal(err)
	}
	if nLeg != 1 {
		t.Fatalf("ledger debits want 1 got %d", nLeg)
	}
}

// TestBlueOceanBasicSequenceCreditDebitRollback validates the canonical cashflow: credit win, debit bet,
// rollback bet (same transaction_id as debit), then rejects an invalid-key debit without mutating balance.
func TestBlueOceanBasicSequenceCreditDebitRollback(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-basicseq-" + uid + "@e2e.local"
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
	// 995.00 EUR playable
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "basicseq-seed:"+uid, 99_500, nil); err != nil {
		t.Fatal(err)
	}
	rid := "basic-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-basic-blueocean-seq"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)

	qBal := func() string {
		return boSignGET(salt, map[string]string{"action": "balance", "remote_id": rid, "currency": "EUR"})
	}

	creditTxn := "basic-credit-" + uid[:6]
	wC := httptest.NewRecorder()
	h.ServeHTTP(wC, httptest.NewRequest(http.MethodGet, "/?"+boSignGET(salt, map[string]string{
		"action": "credit", "remote_id": rid, "transaction_id": creditTxn,
		"amount": "10", "currency": "EUR", "game_id": "g1",
	}), nil))
	boTestExpectBalance(t, wC.Body.Bytes(), 100_500)

	debitTxn := "03e13acd59b18cdca4bd876b9b7dcef8"
	wD := httptest.NewRecorder()
	h.ServeHTTP(wD, httptest.NewRequest(http.MethodGet, "/?"+boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": debitTxn,
		"amount": "5", "currency": "EUR", "game_id": "g1",
	}), nil))
	boTestExpectBalance(t, wD.Body.Bytes(), 100_000)

	wR := httptest.NewRecorder()
	h.ServeHTTP(wR, httptest.NewRequest(http.MethodGet, "/?"+boSignGET(salt, map[string]string{
		"action": "rollback", "remote_id": rid, "transaction_id": debitTxn,
	}), nil))
	boTestExpectBalance(t, wR.Body.Bytes(), 100_500)

	wBad := httptest.NewRecorder()
	h.ServeHTTP(wBad, httptest.NewRequest(http.MethodGet, "/?action=debit&remote_id="+url.QueryEscape(rid)+"&transaction_id=hack&amount=5&currency=EUR&key=deadbeef", nil))
	var badSt struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(wBad.Body.Bytes()), &badSt); err != nil {
		t.Fatalf("invalid key response must be JSON: %v body=%q", err, wBad.Body.String())
	}
	if badSt.Status != "401" {
		t.Fatalf("want 401 for invalid key got %q body=%s", badSt.Status, wBad.Body.String())
	}
	wBal := httptest.NewRecorder()
	h.ServeHTTP(wBal, httptest.NewRequest(http.MethodGet, "/?"+qBal(), nil))
	boTestExpectBalance(t, wBal.Body.Bytes(), 100_500)
}

// TestBlueOceanRollbackIgnoresRequestAmount uses a bogus rollback amount; reversal uses the original debit only.
func TestBlueOceanRollbackIgnoresRequestAmount(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-rb-amt-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "rb-amt-seed:"+uid, 100_000, nil); err != nil {
		t.Fatal(err)
	}
	rid := "rbamt-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-rb-amt-ign"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	txn := "rb-amt-txn-1"
	wd := httptest.NewRecorder()
	h.ServeHTTP(wd, httptest.NewRequest(http.MethodGet, "/?"+boSignGET(salt, map[string]string{
		"action": "debit", "remote_id": rid, "transaction_id": txn, "amount": "5", "currency": "EUR", "game_id": "g1",
	}), nil))
	boTestExpectBalance(t, wd.Body.Bytes(), 99_500)
	// Signed rollback with nonsense amount — must still credit back exactly 5 EUR (500 minor).
	wr := httptest.NewRecorder()
	h.ServeHTTP(wr, httptest.NewRequest(http.MethodGet, "/?"+boSignGET(salt, map[string]string{
		"action": "rollback", "remote_id": rid, "transaction_id": txn, "amount": "99999", "currency": "EUR",
	}), nil))
	boTestExpectBalance(t, wr.Body.Bytes(), 100_000)
}

// TestBlueOceanWalletFinancialHandlersAlwaysEmitJSONObjects ensures balance / mutation paths never return an empty body.
func TestBlueOceanWalletFinancialHandlersAlwaysEmitJSONObjects(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-nonempty-" + uid + "@e2e.local"
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
	if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", "nonempty-seed:"+uid, 50_000, nil); err != nil {
		t.Fatal(err)
	}
	rid := "nonempty-" + uid[:8]
	_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
	salt := "contract-nonempty-json"
	cfg := &config.Config{
		BlueOceanCurrency:                        "EUR",
		BlueOceanWalletSalt:                      salt,
		BlueOceanWalletIntegerAmountIsMajorUnits: true,
		BlueOceanWalletSkipBonusBetGuards:        true,
	}
	h := HandleBlueOceanWallet(p, cfg, nil)
	cases := []struct {
		path string
	}{
		{boSignGET(salt, map[string]string{"action": "balance", "remote_id": rid})},
		{boSignGET(salt, map[string]string{"action": "credit", "remote_id": rid, "transaction_id": "ne-c1", "amount": "1", "currency": "EUR"})},
		{boSignGET(salt, map[string]string{"action": "debit", "remote_id": rid, "transaction_id": "ne-d1", "amount": "1", "currency": "EUR", "game_id": "g"})},
		{boSignGET(salt, map[string]string{"action": "rollback", "remote_id": rid, "transaction_id": "ne-d1"})},
	}
	for i, c := range cases {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/?"+c.path, nil))
		raw := bytes.TrimSpace(w.Body.Bytes())
		if len(raw) == 0 {
			t.Fatalf("case %d: empty body", i)
		}
		var o map[string]json.RawMessage
		if err := json.Unmarshal(raw, &o); err != nil {
			t.Fatalf("case %d: not JSON object: %v body=%q", i, err, string(raw))
		}
		if _, ok := o["status"]; !ok {
			t.Fatalf("case %d: missing status", i)
		}
		if _, ok := o["balance"]; !ok {
			t.Fatalf("case %d: missing balance", i)
		}
	}
}
