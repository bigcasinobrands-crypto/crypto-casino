package webhooks

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HandleBlueOceanWallet handles seamless wallet GET callbacks (balance / debit / credit / rollback).
func HandleBlueOceanWallet(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		salt := strings.TrimSpace(cfg.BlueOceanWalletSalt)
		if salt != "" {
			if !verifyBlueOceanQueryKey(r.URL.Query(), salt, r.URL.Query().Get("key")) {
				log.Printf("blueocean wallet: invalid key from %s", r.RemoteAddr)
				http.Error(w, "invalid key", http.StatusUnauthorized)
				return
			}
		}
		q := r.URL.Query()
		remote := strings.TrimSpace(q.Get("remote_id"))
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		userID, err := resolveBlueOceanRemoteUser(ctx, pool, remote)
		if err != nil || userID == "" {
			writeBOWallet(w, "400", "0")
			return
		}
		if ok, _ := playcheck.LaunchAllowed(ctx, pool, cfg, r, userID); !ok {
			writeBOWallet(w, "403", "0")
			return
		}

		ccy := strings.TrimSpace(cfg.BlueOceanCurrency)
		if ccy == "" {
			ccy = "EUR"
		}
		action := strings.ToLower(strings.TrimSpace(q.Get("action")))
		if action == "" {
			action = strings.ToLower(strings.TrimSpace(q.Get("command")))
		}
		switch action {
		case "bet":
			action = "debit"
		case "win":
			action = "credit"
		}

		txnID := firstNonEmpty(q,
			"transaction_id", "transactionid", "txn_id", "tid", "round_id", "roundid", "game_round_id",
		)
		if txnID == "" {
			txnID = "na"
		}

		gameID := firstNonEmpty(q, "game_id", "gameid", "gid", "game", "game_code")

		switch action {
		case "", "balance":
			sum, err := ledger.AvailableBalance(ctx, pool, userID)
			if err != nil {
				writeBOWallet(w, "500", "0")
				return
			}
			writeBOWallet(w, "200", strconv.FormatInt(sum, 10))
			return
		case "debit", "credit", "rollback":
			amt, ok := parseBOAmount(q)
			if !ok || amt <= 0 {
				writeBOWallet(w, "400", "0")
				return
			}
			sum, st, err := applyBOSeamless(ctx, pool, userID, ccy, action, remote, txnID, amt, gameID)
			if err != nil {
				log.Printf("blueocean wallet: %v", err)
				writeBOWallet(w, "500", strconv.FormatInt(sum, 10))
				return
			}
			writeBOWallet(w, st, strconv.FormatInt(sum, 10))
			return
		default:
			sum, _ := ledger.AvailableBalance(ctx, pool, userID)
			writeBOWallet(w, "400", strconv.FormatInt(sum, 10))
		}
	}
}

func resolveBlueOceanRemoteUser(ctx context.Context, pool *pgxpool.Pool, remote string) (string, error) {
	if remote == "" || pool == nil {
		return "", fmt.Errorf("missing remote")
	}
	var userID string
	err := pool.QueryRow(ctx, `
		SELECT user_id::text FROM blueocean_player_links WHERE remote_player_id = $1
	`, remote).Scan(&userID)
	if err == nil && userID != "" {
		return userID, nil
	}
	err = pool.QueryRow(ctx, `SELECT id::text FROM users WHERE id::text = $1`, remote).Scan(&userID)
	if err == nil && userID != "" {
		return userID, nil
	}
	if err != nil {
		return "", err
	}
	return "", fmt.Errorf("user not found")
}

func parseBOAmount(q url.Values) (int64, bool) {
	for _, k := range []string{"amount", "bet", "win", "sum", "money"} {
		s := strings.TrimSpace(q.Get(k))
		if s == "" {
			continue
		}
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return n, true
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return int64(f + 0.5), true
		}
	}
	return 0, false
}

func firstNonEmpty(q url.Values, keys ...string) string {
	for _, k := range keys {
		if s := strings.TrimSpace(q.Get(k)); s != "" {
			return s
		}
	}
	return ""
}

func debitMagnitudeByIdem(ctx context.Context, tx pgx.Tx, idem string) int64 {
	var sum int64
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE idempotency_key = $1
	`, idem).Scan(&sum)
	if sum >= 0 {
		return 0
	}
	return -sum
}

func applyBOSeamless(ctx context.Context, pool *pgxpool.Pool, userID, ccy, action, remote, txnID string, amount int64, gameID string) (balance int64, status string, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, "500", err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, userID); err != nil {
		return 0, "500", err
	}

	bal, err := ledger.BalanceMinorTx(ctx, tx, userID)
	if err != nil {
		return 0, "500", err
	}

	meta := map[string]any{"remote_id": remote, "txn": txnID, "game_id": gameID}

	switch action {
	case "debit":
		if err := bonus.CheckBetAllowedTx(ctx, tx, userID, gameID, amount); err != nil {
			if errors.Is(err, bonus.ErrExcludedGame) || errors.Is(err, bonus.ErrMaxBetExceeded) {
				return bal, "403", nil
			}
			return bal, "500", err
		}
		if bal < amount {
			return bal, "402", nil
		}
		bonusBal, err := ledger.BalanceBonusLockedTx(ctx, tx, userID)
		if err != nil {
			return bal, "500", err
		}
		cashBal, err := ledger.BalanceCashTx(ctx, tx, userID)
		if err != nil {
			return bal, "500", err
		}
		fromBonus := amount
		if fromBonus > bonusBal {
			fromBonus = bonusBal
		}
		fromCash := amount - fromBonus
		if cashBal < fromCash {
			return bal, "402", nil
		}
		if fromBonus > 0 {
			idemB := fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, txnID)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemB, fromBonus, ledger.PocketBonusLocked, meta)
			if err != nil {
				return bal, "500", err
			}
		}
		if fromCash > 0 {
			idemC := fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, txnID)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemC, fromCash, ledger.PocketCash, meta)
			if err != nil {
				return bal, "500", err
			}
		}
		if err := bonus.ApplyPostBetWagering(ctx, tx, userID, gameID, fromBonus); err != nil {
			return bal, "500", err
		}
	case "credit":
		idem := fmt.Sprintf("bo:game:credit:%s:%s", remote, txnID)
		_, err = ledger.ApplyCreditTx(ctx, tx, userID, ccy, "game.credit", idem, amount, meta)
		if err != nil {
			return bal, "500", err
		}
	case "rollback":
		bKey := fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, txnID)
		cKey := fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, txnID)
		fb := debitMagnitudeByIdem(ctx, tx, bKey)
		fc := debitMagnitudeByIdem(ctx, tx, cKey)
		if fb+fc == 0 {
			idem := fmt.Sprintf("bo:game:rollback:%s:%s", remote, txnID)
			_, err = ledger.ApplyCreditTx(ctx, tx, userID, ccy, "game.rollback", idem, amount, meta)
			if err != nil {
				return bal, "500", err
			}
		} else {
			if fb > 0 {
				idemRB := fmt.Sprintf("bo:game:rollback:bonus:%s:%s", remote, txnID)
				_, err = ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRB, fb, ledger.PocketBonusLocked, meta)
				if err != nil {
					return bal, "500", err
				}
			}
			if fc > 0 {
				idemRC := fmt.Sprintf("bo:game:rollback:cash:%s:%s", remote, txnID)
				_, err = ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRC, fc, ledger.PocketCash, meta)
				if err != nil {
					return bal, "500", err
				}
			}
		}
	}

	bal, err = ledger.BalanceMinorTx(ctx, tx, userID)
	if err != nil {
		return 0, "500", err
	}
	if err := tx.Commit(ctx); err != nil {
		return bal, "500", err
	}
	return bal, "200", nil
}

func writeBOWallet(w http.ResponseWriter, status, balance string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status, "balance": balance})
}

func verifyBlueOceanQueryKey(q url.Values, salt, wantKey string) bool {
	wantKey = strings.TrimSpace(strings.ToLower(wantKey))
	if wantKey == "" {
		return false
	}
	v := url.Values{}
	for k, vals := range q {
		if strings.EqualFold(k, "key") {
			continue
		}
		for _, val := range vals {
			v.Add(k, val)
		}
	}
	qs := v.Encode()
	sum := sha1.Sum([]byte(salt + qs))
	got := fmt.Sprintf("%x", sum)
	return strings.EqualFold(got, wantKey)
}
