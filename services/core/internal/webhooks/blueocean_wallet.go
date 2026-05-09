package webhooks

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/challenges"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// ShouldRouteBlueOceanWallet is used for GET/POST / when Blue Ocean stores only the API origin.
// It returns true if the request should hit the seamless wallet handler instead of the API root stub.
func ShouldRouteBlueOceanWallet(r *http.Request) bool {
	if r == nil {
		return false
	}
	if queryValsGetCI(r.URL.Query(), "key") != "" {
		return true
	}
	if r.Method == http.MethodPost {
		ct := strings.ToLower(r.Header.Get("Content-Type"))
		if strings.Contains(ct, "application/json") ||
			strings.Contains(ct, "application/x-www-form-urlencoded") ||
			strings.Contains(ct, "multipart/form-data") {
			return true
		}
	}
	return false
}

// HandleBlueOceanWallet handles seamless wallet callbacks (balance / debit / credit / rollback).
// Blue Ocean documents GET + query string; some dashboards and testers also POST JSON or form bodies
// to the callback URL — we merge query + body and verify key = sha1(salt + canonical query without key)
// the same way as for GET.
// rdb is optional: when set, successful debits that apply bonus WR publish to Redis (see docs/blue-ocean-bonus-wagering.md).
func HandleBlueOceanWallet(pool *pgxpool.Pool, cfg *config.Config, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// SEC-1: BlueOcean seamless wallet must always be HMAC-authenticated.
		// An empty salt previously bypassed the key check entirely, exposing every player's
		// balance to any caller. Refuse the request when the salt is unset.
		salt := strings.TrimSpace(cfg.BlueOceanWalletSalt)
		if salt == "" {
			log.Printf("blueocean wallet: BLUEOCEAN_WALLET_SALT is empty — rejecting callback from %s (configure salt to enable)", r.RemoteAddr)
			http.Error(w, "wallet auth not configured", http.StatusUnauthorized)
			return
		}
		q, err := mergeBlueOceanParams(r)
		if err != nil {
			log.Printf("blueocean wallet: bad request body from %s: %v", r.RemoteAddr, err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		wantKey := queryValsGetCI(q, "key")
		if !verifyBlueOceanQueryKey(q, salt, wantKey) {
			log.Printf("blueocean wallet: invalid key from %s", r.RemoteAddr)
			http.Error(w, "invalid key", http.StatusUnauthorized)
			return
		}
		remote := strings.TrimSpace(firstNonEmptyCI(q, "remote_id"))
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		userID, err := resolveBlueOceanRemoteUser(ctx, pool, remote)
		if err != nil || userID == "" {
			writeBOWalletJSON(w, 404, 0, "PLAYER_NOT_FOUND")
			return
		}
		if ok, _ := playcheck.LaunchAllowed(ctx, pool, cfg, r, userID); !ok {
			sum, berr := ledger.AvailableBalance(ctx, pool, userID)
			if berr != nil {
				writeBOWalletJSON(w, 500, 0, "internal error")
				return
			}
			writeBOWalletJSON(w, 403, sum, "")
			return
		}

		ccy := strings.TrimSpace(cfg.BlueOceanCurrency)
		if ccy == "" {
			ccy = "EUR"
		}
		action := strings.ToLower(strings.TrimSpace(firstNonEmptyCI(q, "action")))
		if action == "" {
			action = strings.ToLower(strings.TrimSpace(firstNonEmptyCI(q, "command")))
		}
		switch action {
		case "bet":
			action = "debit"
		case "win":
			action = "credit"
		}

		txnID := firstNonEmptyCI(q,
			"transaction_id", "transactionid", "txn_id", "tid", "round_id", "roundid", "game_round_id",
		)
		if txnID == "" {
			txnID = "na"
		}

		gameID := firstNonEmptyCI(q, "game_id", "gameid", "gid", "game", "game_code")

		switch action {
		case "", "balance":
			sum, err := ledger.AvailableBalance(ctx, pool, userID)
			if err != nil {
				writeBOWalletJSON(w, 500, 0, "internal error")
				return
			}
			writeBOWalletJSON(w, 200, sum, "")
			return
		case "debit", "credit", "rollback":
			var amt int64
			var ok bool
			if action == "rollback" {
				amt, ok = 0, true
			} else {
				amt, ok = parseBOAmountCI(q, cfg.BlueOceanWalletFloatAmountIsMajorUnits)
			}
			if action == "debit" {
				if ok && amt == 0 {
					sum, berr := ledger.AvailableBalance(ctx, pool, userID)
					if berr != nil {
						writeBOWalletJSON(w, 500, 0, "internal error")
						return
					}
					writeBOWalletJSON(w, 200, sum, "")
					return
				}
				if !ok || amt < 0 {
					sum, _ := ledger.AvailableBalance(ctx, pool, userID)
					writeBOWalletJSON(w, 403, sum, "Invalid amount")
					return
				}
			}
			if action == "credit" {
				if ok && amt == 0 {
					sum, berr := ledger.AvailableBalance(ctx, pool, userID)
					if berr != nil {
						writeBOWalletJSON(w, 500, 0, "internal error")
						return
					}
					writeBOWalletJSON(w, 200, sum, "")
					return
				}
				if !ok || amt <= 0 {
					sum, _ := ledger.AvailableBalance(ctx, pool, userID)
					writeBOWalletJSON(w, 403, sum, "Invalid amount")
					return
				}
			}

			sum, st, boMsg, err := applyBOSeamless(ctx, pool, rdb, userID, ccy, action, remote, txnID, amt, gameID)
			if err != nil {
				log.Printf("blueocean wallet: %v", err)
				writeBOWalletJSON(w, 500, sum, "internal error")
				return
			}
			if st == 200 {
				bg := context.Background()
				switch action {
				case "debit":
					p := challenges.BODebitPayload{
						UserID: userID, RemoteID: remote, TxnID: txnID, GameID: gameID, StakeMinor: amt,
					}
					if rdb != nil {
						if err := challenges.EnqueueDebit(bg, rdb, p); err != nil {
							go func() {
								_ = challenges.ProcessDebit(context.Background(), pool, cfg, p)
							}()
						}
					} else {
						go func() {
							_ = challenges.ProcessDebit(context.Background(), pool, cfg, p)
						}()
					}
				case "credit":
					p := challenges.BOCreditPayload{
						UserID: userID, RemoteID: remote, TxnID: txnID, GameID: gameID, WinMinor: amt, Currency: ccy,
					}
					if rdb != nil {
						if err := challenges.EnqueueCredit(bg, rdb, p); err != nil {
							go func() {
								_ = challenges.ProcessCredit(context.Background(), pool, cfg, p)
							}()
						}
					} else {
						go func() {
							_ = challenges.ProcessCredit(context.Background(), pool, cfg, p)
						}()
					}
				}
			}
			writeBOWalletJSON(w, st, sum, boMsg)
			return
		default:
			sum, _ := ledger.AvailableBalance(ctx, pool, userID)
			writeBOWalletJSON(w, 403, sum, "")
		}
	}
}

func queryValsGetCI(q url.Values, name string) string {
	if q == nil {
		return ""
	}
	lk := strings.ToLower(strings.TrimSpace(name))
	for k, vals := range q {
		if strings.ToLower(strings.TrimSpace(k)) != lk {
			continue
		}
		for _, val := range vals {
			if s := strings.TrimSpace(val); s != "" {
				return s
			}
		}
	}
	return ""
}

func firstNonEmptyCI(q url.Values, keys ...string) string {
	for _, name := range keys {
		if s := queryValsGetCI(q, name); s != "" {
			return s
		}
	}
	return ""
}

func mergeBlueOceanParams(r *http.Request) (url.Values, error) {
	out := url.Values{}
	for k, vals := range r.URL.Query() {
		for _, v := range vals {
			out.Add(k, v)
		}
	}
	if r.Method != http.MethodPost {
		return out, nil
	}
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	const maxBody = 256 << 10
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxBody {
		return nil, fmt.Errorf("body too large")
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))

	if len(bytes.TrimSpace(body)) == 0 {
		return out, nil
	}
	if strings.Contains(ct, "application/json") || (ct == "" && len(bytes.TrimSpace(body)) > 0 && bytes.TrimSpace(body)[0] == '{') {
		dec := json.NewDecoder(bytes.NewReader(body))
		dec.UseNumber()
		var m map[string]any
		if err := dec.Decode(&m); err != nil {
			return nil, err
		}
		for k, v := range m {
			if v == nil {
				continue
			}
			s, ok := blueOceanJSONScalarString(v)
			if !ok {
				continue
			}
			out.Add(k, s)
		}
		return out, nil
	}
	if strings.Contains(ct, "application/x-www-form-urlencoded") {
		form, err := url.ParseQuery(string(body))
		if err != nil {
			return nil, err
		}
		for k, vals := range form {
			for _, v := range vals {
				out.Add(k, v)
			}
		}
		return out, nil
	}
	return out, nil
}

func blueOceanJSONScalarString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return t, true
	case bool:
		if t {
			return "1", true
		}
		return "0", true
	case json.Number:
		return t.String(), true
	case float64:
		if t == math.Trunc(t) && !math.IsInf(t, 0) {
			return strconv.FormatInt(int64(t), 10), true
		}
		return strconv.FormatFloat(t, 'f', -1, 64), true
	default:
		return "", false
	}
}

func parseBOAmountCI(q url.Values, floatIsMajor bool) (int64, bool) {
	keys := []string{"amount", "bet", "win", "sum", "money"}
	for lkWant, vals := range flattenValuesCI(q, keys) {
		_ = lkWant
		for _, s := range vals {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			s = strings.ReplaceAll(s, ",", ".")
			if _, err := strconv.ParseInt(s, 10, 64); err == nil {
				n, _ := strconv.ParseInt(s, 10, 64)
				return n, true
			}
			f, err := strconv.ParseFloat(s, 64)
			if err != nil {
				continue
			}
			if !floatIsMajor {
				return int64(math.Round(f)), true
			}
			return int64(math.Round(f * 100)), true
		}
	}
	return 0, false
}

// flattenValuesCI collects url.Values entries whose key matches any of names (case-insensitive).
func flattenValuesCI(q url.Values, names []string) map[string][]string {
	want := map[string]struct{}{}
	for _, n := range names {
		want[strings.ToLower(n)] = struct{}{}
	}
	out := map[string][]string{}
	for k, vals := range q {
		if _, ok := want[strings.ToLower(strings.TrimSpace(k))]; !ok {
			continue
		}
		out[k] = append(out[k], vals...)
	}
	return out
}

func resolveBlueOceanRemoteUser(ctx context.Context, pool *pgxpool.Pool, remote string) (string, error) {
	if remote == "" || pool == nil {
		return "", fmt.Errorf("missing remote")
	}
	candidates := []string{strings.TrimSpace(remote)}
	if alt := blueocean.AlternateUUIDForm(remote); alt != "" {
		candidates = append(candidates, alt)
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		var userID string
		err := pool.QueryRow(ctx, `
			SELECT user_id::text FROM blueocean_player_links WHERE remote_player_id = $1
		`, c).Scan(&userID)
		if err == nil && userID != "" {
			return userID, nil
		}
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		var userID string
		err := pool.QueryRow(ctx, `SELECT id::text FROM users WHERE id::text = $1`, c).Scan(&userID)
		if err == nil && userID != "" {
			return userID, nil
		}
	}
	return "", fmt.Errorf("user not found")
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

func applyBOSeamless(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID, ccy, action, remote, txnID string, amount int64, gameID string) (balance int64, status int, msg string, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 500, "", err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, userID); err != nil {
		return 0, 500, "", err
	}

	bal, err := ledger.BalanceMinorTx(ctx, tx, userID)
	if err != nil {
		return 0, 500, "", err
	}

	meta := map[string]any{"remote_id": remote, "txn": txnID, "game_id": gameID}
	if err := fingerprint.MergeTrafficAttributionTx(ctx, tx, userID, time.Now().UTC(), meta); err != nil {
		return bal, 500, "", err
	}

	var notifyWageringProgress bool

	switch action {
	case "debit":
		if amount == 0 {
			return bal, 200, "", nil
		}
		srcRef := remote + ":" + txnID
		if err := bonus.CheckBetAllowedTx(ctx, tx, userID, gameID, amount, srcRef); err != nil {
			if errors.Is(err, bonus.ErrExcludedGame) || errors.Is(err, bonus.ErrMaxBetExceeded) {
				return bal, 403, "", nil
			}
			return bal, 500, "", err
		}
		if bal < amount {
			return bal, 403, "Insufficient funds", nil
		}
		bonusBal, err := ledger.BalanceBonusLockedTx(ctx, tx, userID)
		if err != nil {
			return bal, 500, "", err
		}
		cashBal, err := ledger.BalanceCashTx(ctx, tx, userID)
		if err != nil {
			return bal, 500, "", err
		}
		// Cash-first: spend withdrawable cash before bonus_locked (enterprise promo policy).
		fromCash := amount
		if fromCash > cashBal {
			fromCash = cashBal
		}
		fromBonus := amount - fromCash
		if fromBonus > bonusBal {
			return bal, 403, "Insufficient funds", nil
		}
		if fromCash > 0 {
			idemC := fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, txnID)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemC, fromCash, ledger.PocketCash, meta)
			if err != nil {
				return bal, 500, "", err
			}
		}
		if fromBonus > 0 {
			idemB := fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, txnID)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemB, fromBonus, ledger.PocketBonusLocked, meta)
			if err != nil {
				return bal, 500, "", err
			}
		}
		if err := bonus.ApplyPostBetWagering(ctx, tx, userID, gameID, fromBonus); err != nil {
			return bal, 500, "", err
		}
		notifyWageringProgress = fromBonus > 0
	case "credit":
		if amount == 0 {
			return bal, 200, "", nil
		}
		idem := fmt.Sprintf("bo:game:credit:%s:%s", remote, txnID)
		_, err = ledger.ApplyCreditTx(ctx, tx, userID, ccy, "game.credit", idem, amount, meta)
		if err != nil {
			return bal, 500, "", err
		}
	case "rollback":
		// BO: do not rely on rollback request amount; use stored debit only. If none, 404.
		bKey := fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, txnID)
		cKey := fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, txnID)
		fb := debitMagnitudeByIdem(ctx, tx, bKey)
		fc := debitMagnitudeByIdem(ctx, tx, cKey)
		if fb+fc == 0 {
			return bal, 404, "TRANSACTION_NOT_FOUND", nil
		}
		if fb > 0 {
			idemRB := fmt.Sprintf("bo:game:rollback:bonus:%s:%s", remote, txnID)
			ins, rerr := ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRB, fb, ledger.PocketBonusLocked, meta)
			if rerr != nil {
				return bal, 500, "", rerr
			}
			if ins {
				notifyWageringProgress = true
				if err := bonus.ApplyPostBetRollbackWagering(ctx, tx, userID, gameID, fb); err != nil {
					return bal, 500, "", err
				}
			}
		}
		if fc > 0 {
			idemRC := fmt.Sprintf("bo:game:rollback:cash:%s:%s", remote, txnID)
			ins, rerr := ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRC, fc, ledger.PocketCash, meta)
			if rerr != nil {
				return bal, 500, "", rerr
			}
			if ins {
				if err := bonus.ReverseVIPAccrualForCashRollbackTx(ctx, tx, userID, fc, idemRC); err != nil {
					return bal, 500, "", err
				}
			}
		}
	}

	bal, err = ledger.BalanceMinorTx(ctx, tx, userID)
	if err != nil {
		return 0, 500, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return bal, 500, "", err
	}
	// After commit: notify subscribers of WR progress (bonus stake only; real-cash play does not move WR here).
	if (action == "debit" || action == "rollback") && notifyWageringProgress && rdb != nil {
		if pubErr := bonus.PublishWageringProgressFromPool(ctx, pool, rdb, userID); pubErr != nil {
			log.Printf("blueocean wallet: redis publish wagering progress: %v", pubErr)
		}
	}
	return bal, 200, "", nil
}

func formatBOBalanceMinor(minor int64) string {
	neg := minor < 0
	if neg {
		minor = -minor
	}
	whole := minor / 100
	frac := minor % 100
	s := fmt.Sprintf("%d.%02d", whole, frac)
	if neg {
		return "-" + s
	}
	return s
}

func writeBOWalletJSON(w http.ResponseWriter, status int, balanceMinor int64, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	type body struct {
		Status  int    `json:"status"`
		Balance string `json:"balance"`
		Msg     string `json:"msg,omitempty"`
	}
	out := body{Status: status, Balance: formatBOBalanceMinor(balanceMinor)}
	if strings.TrimSpace(msg) != "" {
		out.Msg = msg
	}
	_ = json.NewEncoder(w).Encode(out)
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
	// BlueOcean seamless wallet callback verifies key = sha1(salt + query) per provider integration.
	// nosemgrep: go.lang.security.audit.crypto.use_of_weak_crypto.use-of-sha1
	sum := sha1.Sum([]byte(salt + qs))
	got := fmt.Sprintf("%x", sum)
	return strings.EqualFold(got, wantKey)
}
