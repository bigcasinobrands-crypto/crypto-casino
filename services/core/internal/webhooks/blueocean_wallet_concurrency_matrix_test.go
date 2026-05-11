package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/google/uuid"
)

// Stress sizes for BlueOcean S2S "concurrent" tooling (dynamic N).
var blueOceanConcurrencyNSizes = []int{1, 2, 5, 10, 25, 50, 100}

func boTestExpectBalance(t *testing.T, body []byte, wantMinor int64) {
	t.Helper()
	var o struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(body), &o); err != nil {
		t.Fatal(err)
	}
	if o.Status != "200" {
		t.Fatalf("status want 200 got %q raw=%s", o.Status, body)
	}
	want := formatBOBalanceMinor(wantMinor)
	if o.Balance != want {
		t.Fatalf("balance want %q (minor=%d) got %q", want, wantMinor, o.Balance)
	}
}

func boTestExpectFinancialJSONOK(t *testing.T, body []byte) {
	t.Helper()
	var o struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(body), &o); err != nil {
		t.Fatal(err)
	}
	if o.Status != "200" {
		t.Fatalf("status want 200 got %q raw=%s", o.Status, body)
	}
	if strings.TrimSpace(o.Balance) == "" {
		t.Fatalf("empty balance raw=%s", body)
	}
}

func TestBlueOceanConcurrentUniqueDebitsMatrix(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-u-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(101_000)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-u-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matu-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			salt := fmt.Sprintf("mat-uniq-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)

			debitMinor := int64(500) // amount "5" EUR major
			var wg sync.WaitGroup
			codes := make([]int, n)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					txn := fmt.Sprintf("uniq-%d-%d-%s", n, i, uid[:4])
					q := boSignGET(salt, map[string]string{
						"action": "debit", "remote_id": rid, "transaction_id": txn,
						"amount": "5", "currency": "EUR", "game_id": "1",
					})
					req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
					w := httptest.NewRecorder()
					h.ServeHTTP(w, req)
					codes[i] = w.Code
				}(i)
			}
			wg.Wait()
			for i := 0; i < n; i++ {
				if codes[i] != http.StatusOK {
					t.Fatalf("request %d: HTTP %d", i, codes[i])
				}
			}
			play, err := ledger.BalancePlayableSeamless(ctx, p, uid, "EUR", false)
			if err != nil {
				t.Fatal(err)
			}
			if play != startMinor-int64(n)*debitMinor {
				t.Fatalf("final playable want minor %d got %d", startMinor-int64(n)*debitMinor, play)
			}
			var nStore, nLeg int
			if err := p.QueryRow(ctx, `
				SELECT COUNT(*) FROM blueocean_wallet_transactions
				WHERE user_id = $1::uuid AND action = 'debit' AND provider = 'blueocean'
			`, uid).Scan(&nStore); err != nil {
				t.Fatal(err)
			}
			if err := p.QueryRow(ctx, `
				SELECT COUNT(*) FROM ledger_entries
				WHERE user_id = $1::uuid AND entry_type = 'game.debit'
			`, uid).Scan(&nLeg); err != nil {
				t.Fatal(err)
			}
			if nStore != n {
				t.Fatalf("wallet_transactions want %d got %d", n, nStore)
			}
			if nLeg != n {
				t.Fatalf("ledger game.debit rows want %d got %d", n, nLeg)
			}
		})
	}
}

func TestBlueOceanConcurrentUniqueDebitsFromNegativeBalance(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-neg-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(-1500)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-neg-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matneg-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			salt := fmt.Sprintf("mat-neg-uniq-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)

			debitMinor := int64(500)
			var wg sync.WaitGroup
			codes := make([]int, n)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					txn := fmt.Sprintf("neguniq-%d-%d-%s", n, i, uid[:4])
					q := boSignGET(salt, map[string]string{
						"action": "debit", "remote_id": rid, "transaction_id": txn,
						"amount": "5", "currency": "EUR", "game_id": "1",
					})
					req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
					w := httptest.NewRecorder()
					h.ServeHTTP(w, req)
					codes[i] = w.Code
				}(i)
			}
			wg.Wait()
			for i := 0; i < n; i++ {
				if codes[i] != http.StatusOK {
					t.Fatalf("request %d: HTTP %d", i, codes[i])
				}
			}
			play, err := ledger.BalancePlayableSeamless(ctx, p, uid, "EUR", false)
			if err != nil {
				t.Fatal(err)
			}
			want := startMinor - int64(n)*debitMinor
			if play != want {
				t.Fatalf("final playable want minor %d got %d", want, play)
			}
		})
	}
}

func TestBlueOceanConcurrentDuplicateDebitsMatrix(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-d-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(101_000)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-d-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matd-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			salt := fmt.Sprintf("mat-dup-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)
			txn := fmt.Sprintf("same-dup-%d-%s", n, uid[:4])
			q := boSignGET(salt, map[string]string{
				"action": "debit", "remote_id": rid, "transaction_id": txn,
				"amount": "5", "currency": "EUR", "game_id": "1",
			})

			var wg sync.WaitGroup
			codes := make([]int, n)
			bodies := make([][]byte, n)
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
			debitMinor := int64(500)
			wantMinor := startMinor - debitMinor
			var first []byte
			for i := 0; i < n; i++ {
				if codes[i] != http.StatusOK {
					t.Fatalf("request %d: HTTP %d %s", i, codes[i], bodies[i])
				}
				if i == 0 {
					first = bodies[i]
				} else if !bytes.Equal(first, bodies[i]) {
					t.Fatalf("body %d differs from first", i)
				}
				boTestExpectBalance(t, bodies[i], wantMinor)
			}
			var nStore, nLeg int
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM blueocean_wallet_transactions
				WHERE user_id = $1::uuid AND action = 'debit' AND provider = 'blueocean'
			`, uid).Scan(&nStore)
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM ledger_entries
				WHERE user_id = $1::uuid AND entry_type = 'game.debit'
			`, uid).Scan(&nLeg)
			if nStore != 1 || nLeg != 1 {
				t.Fatalf("want 1 wallet row and 1 debit, got wallet=%d ledger=%d", nStore, nLeg)
			}
		})
	}
}

func TestBlueOceanConcurrentMixedUniqueAndDuplicateDebitsMatrix(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		if n < 2 {
			continue
		}
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-m-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(101_000)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-m-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matm-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			uniqueTxn := n / 2
			if uniqueTxn < 1 {
				uniqueTxn = 1
			}
			debitMinor := int64(500)
			wantMinor := startMinor - int64(uniqueTxn)*debitMinor

			salt := fmt.Sprintf("mat-mix-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)

			var wg sync.WaitGroup
			codes := make([]int, n)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					txnIx := i % uniqueTxn
					txn := fmt.Sprintf("mix-%d-%s-%d", n, uid[:4], txnIx)
					q := boSignGET(salt, map[string]string{
						"action": "debit", "remote_id": rid, "transaction_id": txn,
						"amount": "5", "currency": "EUR", "game_id": "1",
					})
					req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
					w := httptest.NewRecorder()
					h.ServeHTTP(w, req)
					codes[i] = w.Code
				}(i)
			}
			wg.Wait()
			for i := 0; i < n; i++ {
				if codes[i] != http.StatusOK {
					t.Fatalf("request %d: HTTP %d", i, codes[i])
				}
			}
			play, err := ledger.BalancePlayableSeamless(ctx, p, uid, "EUR", false)
			if err != nil {
				t.Fatal(err)
			}
			if play != wantMinor {
				t.Fatalf("playable balance want minor %d got %d (unique=%d)", wantMinor, play, uniqueTxn)
			}
			var nStore, nLeg int
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM blueocean_wallet_transactions
				WHERE user_id = $1::uuid AND action = 'debit' AND provider = 'blueocean'
			`, uid).Scan(&nStore)
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM ledger_entries
				WHERE user_id = $1::uuid AND entry_type = 'game.debit'
			`, uid).Scan(&nLeg)
			if nStore != uniqueTxn {
				t.Fatalf("wallet_transactions want %d got %d", uniqueTxn, nStore)
			}
			if nLeg != uniqueTxn {
				t.Fatalf("ledger debits want %d got %d", uniqueTxn, nLeg)
			}
		})
	}
}

func TestBlueOceanConcurrentUniqueCreditsMatrix(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-c-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(100_000)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-c-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matc-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			salt := fmt.Sprintf("mat-credit-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)

			creditMinor := int64(500)
			var wg sync.WaitGroup
			codes := make([]int, n)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					txn := fmt.Sprintf("cr-%d-%d-%s", n, i, uid[:4])
					q := boSignGET(salt, map[string]string{
						"action": "credit", "remote_id": rid, "transaction_id": txn,
						"amount": "5", "currency": "EUR",
					})
					req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
					w := httptest.NewRecorder()
					h.ServeHTTP(w, req)
					codes[i] = w.Code
				}(i)
			}
			wg.Wait()
			wantMinor := startMinor + int64(n)*creditMinor
			for i := 0; i < n; i++ {
				if codes[i] != http.StatusOK {
					t.Fatalf("request %d: HTTP %d", i, codes[i])
				}
			}
			play, err := ledger.BalancePlayableSeamless(ctx, p, uid, "EUR", false)
			if err != nil {
				t.Fatal(err)
			}
			if play != wantMinor {
				t.Fatalf("final playable want minor %d got %d", wantMinor, play)
			}
			var nStore, nLeg int
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM blueocean_wallet_transactions
				WHERE user_id = $1::uuid AND action = 'credit' AND provider = 'blueocean'
			`, uid).Scan(&nStore)
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM ledger_entries
				WHERE user_id = $1::uuid AND entry_type = 'game.credit'
			`, uid).Scan(&nLeg)
			if nStore != n {
				t.Fatalf("wallet_transactions want %d got %d", n, nStore)
			}
			if nLeg != n {
				t.Fatalf("ledger credits want %d got %d", n, nLeg)
			}
		})
	}
}

func TestBlueOceanConcurrentDebitAndCreditWinsMatrix(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-w-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(200_000)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-w-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matw-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			salt := fmt.Sprintf("mat-win-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)

			debitMinor := int64(500)
			creditMinor := int64(300) // "3" EUR major
			var wg sync.WaitGroup
			codes := make([]int, n*2)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					txn := fmt.Sprintf("w-d-%d-%d-%s", n, i, uid[:4])
					q := boSignGET(salt, map[string]string{
						"action": "debit", "remote_id": rid, "transaction_id": txn,
						"amount": "5", "currency": "EUR", "game_id": "1",
					})
					req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
					w := httptest.NewRecorder()
					h.ServeHTTP(w, req)
					codes[i] = w.Code
				}(i)
			}
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					idx := n + i
					txn := fmt.Sprintf("w-c-%d-%d-%s", n, i, uid[:4])
					q := boSignGET(salt, map[string]string{
						"action": "credit", "remote_id": rid, "transaction_id": txn,
						"amount": "3", "currency": "EUR",
					})
					req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
					w := httptest.NewRecorder()
					h.ServeHTTP(w, req)
					codes[idx] = w.Code
				}(i)
			}
			wg.Wait()
			wantMinor := startMinor - int64(n)*debitMinor + int64(n)*creditMinor
			for i := 0; i < n*2; i++ {
				if codes[i] != http.StatusOK {
					t.Fatalf("request %d: HTTP %d", i, codes[i])
				}
			}
			play, err := ledger.BalancePlayableSeamless(ctx, p, uid, "EUR", false)
			if err != nil {
				t.Fatal(err)
			}
			if play != wantMinor {
				t.Fatalf("final playable want minor %d got %d", wantMinor, play)
			}
		})
	}
}

// Concurrent "with wins" semantics from Blue Ocean S2S: per logical round the tool may fire the same
// debit transaction_id twice and the same credit transaction_id twice; only one ledger movement each,
// and duplicate callbacks must replay the first response JSON byte-for-byte.
func TestBlueOceanConcurrentWithWinsDuplicatePairsMatrix(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	for _, n := range blueOceanConcurrencyNSizes {
		n := n
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			uid := uuid.New().String()
			email := fmt.Sprintf("bo-mat-dw-%d-%s@e2e.local", n, uid[:6])
			if _, err := p.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
				VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
			`, uid, email, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			startMinor := int64(980_000)
			if _, err := ledger.ApplyCredit(ctx, p, uid, "EUR", "test.seed", fmt.Sprintf("seed-dw-%d-%s", n, uid), startMinor, nil); err != nil {
				t.Fatal(err)
			}
			rid := fmt.Sprintf("matdw-%d-%s", n, strings.ReplaceAll(uid, "-", "")[:8])
			_, _ = p.Exec(ctx, `INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)`, uid, rid)
			t.Cleanup(func() {
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM blueocean_player_links WHERE user_id = $1::uuid`, uid)
				_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
			})

			salt := fmt.Sprintf("mat-dupwin-%d", n)
			cfg := &config.Config{
				BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt,
				BlueOceanWalletIntegerAmountIsMajorUnits: true, BlueOceanWalletSkipBonusBetGuards: true,
			}
			h := HandleBlueOceanWallet(p, cfg, nil)

			type shot struct {
				code int
				body []byte
			}
			shots := make([]shot, n*4)
			var wg sync.WaitGroup
			for r := 0; r < n; r++ {
				debitTxn := fmt.Sprintf("dw-d-%d-%d-%s", n, r, uid[:4])
				creditTxn := fmt.Sprintf("dw-c-%d-%d-%s", n, r, uid[:4])
				qDebit := boSignGET(salt, map[string]string{
					"action": "debit", "remote_id": rid, "transaction_id": debitTxn,
					"amount": "10", "currency": "EUR", "game_id": "1", "round_id": strconv.Itoa(r),
				})
				qCredit := boSignGET(salt, map[string]string{
					"action": "credit", "remote_id": rid, "transaction_id": creditTxn,
					"amount": "10", "currency": "EUR", "round_id": strconv.Itoa(r),
				})
				base := r * 4
				for k := 0; k < 2; k++ {
					wg.Add(1)
					go func(slot int, q string) {
						defer wg.Done()
						req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
						w := httptest.NewRecorder()
						h.ServeHTTP(w, req)
						b := bytes.TrimSpace(w.Body.Bytes())
						if len(b) == 0 {
							t.Errorf("empty response slot=%d", slot)
							return
						}
						shots[slot] = shot{code: w.Code, body: b}
					}(base+k, qDebit)
				}
				for k := 0; k < 2; k++ {
					wg.Add(1)
					go func(slot int, q string) {
						defer wg.Done()
						req := httptest.NewRequest(http.MethodGet, "/?"+q, nil)
						w := httptest.NewRecorder()
						h.ServeHTTP(w, req)
						b := bytes.TrimSpace(w.Body.Bytes())
						if len(b) == 0 {
							t.Errorf("empty response slot=%d", slot)
							return
						}
						shots[slot] = shot{code: w.Code, body: b}
					}(base+2+k, qCredit)
				}
			}
			wg.Wait()
			for i := 0; i < len(shots); i++ {
				if shots[i].code != http.StatusOK {
					t.Fatalf("shot %d HTTP %d body=%s", i, shots[i].code, shots[i].body)
				}
				boTestExpectFinancialJSONOK(t, shots[i].body)
			}
			for r := 0; r < n; r++ {
				base := r * 4
				if !bytes.Equal(shots[base].body, shots[base+1].body) {
					t.Fatalf("round %d duplicate debit bodies differ", r)
				}
				if !bytes.Equal(shots[base+2].body, shots[base+3].body) {
					t.Fatalf("round %d duplicate credit bodies differ", r)
				}
			}
			play, err := ledger.BalancePlayableSeamless(ctx, p, uid, "EUR", false)
			if err != nil {
				t.Fatal(err)
			}
			if play != startMinor {
				t.Fatalf("final balance want minor %d got %d", startMinor, play)
			}
			var nDebit, nCredit, nLegD, nLegC int
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM blueocean_wallet_transactions
				WHERE user_id = $1::uuid AND action = 'debit' AND provider = 'blueocean'
			`, uid).Scan(&nDebit)
			_ = p.QueryRow(ctx, `
				SELECT COUNT(*) FROM blueocean_wallet_transactions
				WHERE user_id = $1::uuid AND action = 'credit' AND provider = 'blueocean'
			`, uid).Scan(&nCredit)
			_ = p.QueryRow(ctx, `SELECT COUNT(*) FROM ledger_entries WHERE user_id = $1::uuid AND entry_type = 'game.debit'`, uid).Scan(&nLegD)
			_ = p.QueryRow(ctx, `SELECT COUNT(*) FROM ledger_entries WHERE user_id = $1::uuid AND entry_type = 'game.credit'`, uid).Scan(&nLegC)
			if nDebit != n || nCredit != n {
				t.Fatalf("wallet rows want debit=%d credit=%d got debit=%d credit=%d", n, n, nDebit, nCredit)
			}
			if nLegD != n || nLegC != n {
				t.Fatalf("ledger rows want debit=%d credit=%d got debit=%d credit=%d", n, n, nLegD, nLegC)
			}
		})
	}
}

func TestBlueOceanHandlerInvalidMethodReturnsNonEmptyJSON(t *testing.T) {
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanWalletSalt: "empty-json-guard"}
	h := HandleBlueOceanWallet(nil, cfg, nil)
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	b := bytes.TrimSpace(w.Body.Bytes())
	if len(b) == 0 {
		t.Fatal("expected non-empty JSON body")
	}
	var o struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(b, &o); err != nil {
		t.Fatalf("invalid json: %v body=%s", err, b)
	}
	if o.Status != "405" {
		t.Fatalf("want JSON status 405 got %q body=%s", o.Status, b)
	}
}
