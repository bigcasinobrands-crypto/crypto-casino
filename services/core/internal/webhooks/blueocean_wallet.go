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
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/challenges"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// boWalletErrInternal is surfaced in JSON for Blue Ocean tooling (same casing as their dashboards).
const boWalletErrInternal = "Internal error"

// boWalletTxnWireKeys lists JSON/query keys for the financial transaction id (ledger idempotency).
// Prefer real transaction/bet ids. round_id is last — many BO payloads reuse one round across multiple
// financial operations; treating round as the txn id collapses distinct credits/debits into one key and
// breaks S2S concurrent tests (balance appears "stuck" when a later amount mismatches the first post).
var boWalletTxnWireKeys = []string{
	"transaction_id", "transactionid", "txn_id", "txid",
	"trans_id", "transid",
	"transfer_id", "transferid",
	"operation_id", "operationid",
	"ext_transaction_id", "exttransactionid",
	"external_transaction_id", "externaltransactionid",
	"reference", "ref",
	"bet_id", "betid",
	"win_id", "winid",
	"payment_id", "paymentid",
	"round_id", "roundid", "game_round_id",
}

// boWalletAmountParamKeys tries common Blue Ocean / operator amount field names (merged query + JSON).
var boWalletAmountParamKeys = []string{
	"amount", "bet", "win", "sum", "money",
	"stake", "value",
	"bet_amount", "betamount",
	"win_amount", "winamount",
	"sum_amount", "sumamount",
}

// boWalletTxMaxAttempts handles deadlocks / serialization failures when BO runs concurrent wallet calls
// against the same player (stress tests). Keep generous: pool starvation + many threads can amplify retries.
const boWalletTxMaxAttempts = 32

func isBOWalletTxRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "40001": // serialization_failure
			return true
		case "40P01": // deadlock_detected
			return true
		case "55P03": // lock_not_available (NOWAIT); rare but safe to retry
			return true
		}
	}
	if strings.Contains(strings.ToLower(err.Error()), "deadlock") {
		return true
	}
	if strings.Contains(strings.ToLower(err.Error()), "serialization failure") {
		return true
	}
	return false
}

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
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("blueocean wallet panic: %v", rec)
				writeBOWalletJSON(w, 500, 0, boWalletErrInternal)
			}
		}()
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			writeBOWalletJSON(w, 405, 0, "Method not allowed")
			return
		}
		// SEC-1: BlueOcean seamless wallet must always be HMAC-authenticated.
		// An empty salt previously bypassed the key check entirely, exposing every player's
		// balance to any caller. Refuse the request when the salt is unset.
		salt := strings.TrimSpace(cfg.BlueOceanWalletSalt)
		if salt == "" {
			log.Printf("blueocean wallet: BLUEOCEAN_WALLET_SALT is empty — rejecting callback from %s (configure salt to enable)", r.RemoteAddr)
			writeBOWalletJSON(w, 401, 0, "wallet auth not configured")
			return
		}
		q, err := mergeBlueOceanParams(r)
		if err != nil {
			log.Printf("blueocean wallet: bad request body from %s: %v", r.RemoteAddr, err)
			writeBOWalletJSON(w, 400, 0, "bad request")
			return
		}
		wantKey := queryValsGetCI(q, "key")
		if !verifyBlueOceanWalletKey(r, q, salt, wantKey) {
			log.Printf("blueocean wallet: invalid key from %s", r.RemoteAddr)
			writeBOWalletJSON(w, 401, 0, "invalid key")
			return
		}
		remote := strings.TrimSpace(firstNonEmptyCI(q,
			"remote_id", "player_id", "playerid", "username", "user_name", "userid", "user_id",
		))
		// Deadline comes from chi middleware on the wallet routes (see cmd/api — 3m seamless group).
		// Do not add a shorter nested WithTimeout here: it caps work below the time needed when many
		// concurrent callbacks queue on pool acquire + FOR UPDATE.
		ctx := r.Context()

		userID, err := resolveBlueOceanRemoteUser(ctx, pool, remote)
		if err != nil || userID == "" {
			writeBOWalletJSON(w, 404, 0, "PLAYER_NOT_FOUND")
			return
		}
		walletCCY := strings.ToUpper(strings.TrimSpace(firstNonEmptyCI(q, "currency", "curr", "ccy")))
		if walletCCY == "" {
			walletCCY = strings.TrimSpace(cfg.BlueOceanCurrency)
		}
		if walletCCY == "" {
			walletCCY = "EUR"
		}
		if ok, _ := playcheck.LaunchAllowed(ctx, pool, cfg, r, userID); !ok {
			sum, berr := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
			if berr != nil {
				writeBOWalletJSON(w, 500, 0, boWalletErrInternal)
				return
			}
			writeBOWalletJSON(w, 403, sum, "")
			return
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

		// Do not use "tid" in boWalletTxnWireKeys — many BO/live callbacks set tid to a shared session value, which would
		// collapse distinct financial transactions into one idempotency namespace under concurrency.
		txnID := strings.TrimSpace(firstNonEmptyCI(q, boWalletTxnWireKeys...))
		if txnID == "" {
			txnID = "na"
		}
		ledgerTxnID := blueOceanLedgerTxnIDForKeys(q, txnID, cfg.BlueOceanWalletLedgerTxnUsesRound)

		gameID := firstNonEmptyCI(q, "game_id", "gameid", "gid", "game", "game_code")

		switch action {
		case "", "balance":
			sum, err := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
			if err != nil {
				writeBOWalletJSON(w, 500, 0, boWalletErrInternal)
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
				amt, ok = parseBOAmountCI(q, cfg.BlueOceanWalletFloatAmountIsMajorUnits, cfg.BlueOceanWalletIntegerAmountIsMajorUnits)
			}
			if action == "debit" {
				if !ok || amt < 0 {
					sum, _ := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
					writeBOWalletJSON(w, 403, sum, "Invalid amount")
					return
				}
			}
			if action == "credit" {
				if !ok {
					amt, ok = 0, true
				}
				if amt < 0 {
					sum, _ := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
					writeBOWalletJSON(w, 403, sum, "Invalid amount")
					return
				}
			}

			persist := boSeamlessPersistMeta{
				Username:      firstNonEmptyCI(q, "username", "user_name", "callerId", "caller_id"),
				RoundID:       firstNonEmptyCI(q, "round_id", "roundid", "game_round_id"),
				GameID:        gameID,
				SessionID:     firstNonEmptyCI(q, "session_id", "sessionid"),
				GamesessionID: firstNonEmptyCI(q, "gamesession_id", "gamesessionid"),
			}
			replayBody, sum, st, _, _, replayed, err := applyBOSeamlessWithRetry(ctx, pool, rdb, userID, walletCCY, cfg.BlueOceanMulticurrency, cfg.BlueOceanWalletAllowNegativeBalance, cfg.BlueOceanWalletSkipBonusBetGuards, cfg.BlueOceanWalletLedgerTxnUsesRound, action, remote, txnID, ledgerTxnID, amt, gameID, persist)
			if err != nil {
				log.Printf("blueocean wallet: %v", err)
				writeBOWalletJSON(w, 500, sum, boWalletErrInternal)
				return
			}
			if len(replayBody) == 0 {
				sum2, sErr := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
				if sErr != nil {
					log.Printf("blueocean wallet: empty handler body, balance read failed: %v", sErr)
					writeBOWalletJSON(w, 500, 0, boWalletErrInternal)
					return
				}
				log.Printf("blueocean wallet: empty replay body action=%s remote=%s txn=%s st=%d replayed=%v — writing 500 JSON", action, remote, txnID, st, replayed)
				writeBOWalletJSON(w, 500, sum2, boWalletErrInternal)
				return
			}
			if st == 200 && !replayed && (action == "debit" || action == "credit") {
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
						UserID: userID, RemoteID: remote, TxnID: txnID, GameID: gameID, WinMinor: amt, Currency: walletCCY,
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
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(replayBody)
			return
		default:
			sum, _ := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
			writeBOWalletJSON(w, 403, sum, "")
		}
	}
}

func queryValsGetCI(q url.Values, name string) string {
	if q == nil {
		return ""
	}
	lk := strings.ToLower(strings.TrimSpace(name))
	var last string
	for k, vals := range q {
		if strings.ToLower(strings.TrimSpace(k)) != lk {
			continue
		}
		for _, val := range vals {
			if s := strings.TrimSpace(val); s != "" {
				last = s
			}
		}
	}
	return last
}

func firstNonEmptyCI(q url.Values, keys ...string) string {
	for _, k := range keys {
		if s := queryValsGetCI(q, k); s != "" {
			return s
		}
	}
	return ""
}

func blueOceanLedgerTxnIDForKeys(q url.Values, txnID string, useRound bool) string {
	txnID = strings.TrimSpace(txnID)
	if txnID == "" || txnID == "na" || !useRound {
		return txnID
	}
	r := strings.TrimSpace(firstNonEmptyCI(q, "round_id", "roundid", "game_round_id"))
	if r == "" {
		return txnID
	}
	return txnID + "::" + r
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
		addJSONObjectToValues(out, m)
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

func sortedJSONMapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// addJSONObjectToValues flattens one or more levels of JSON objects into url.Values using Set (deterministic key order; nested keys override earlier scalars at the same path level).
func addJSONObjectToValues(out url.Values, m map[string]any) {
	for _, k := range sortedJSONMapKeys(m) {
		v := m[k]
		if v == nil {
			continue
		}
		if sub, ok := v.(map[string]any); ok {
			addJSONObjectToValues(out, sub)
			continue
		}
		s, ok := blueOceanJSONScalarString(v)
		if !ok {
			continue
		}
		out.Set(k, s)
	}
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

func parseBOAmountCI(q url.Values, floatIsMajor, intIsMajor bool) (int64, bool) {
	for _, key := range boWalletAmountParamKeys {
		for _, raw := range valuesForKeyCI(q, key) {
			s := strings.ReplaceAll(strings.TrimSpace(raw), ",", ".")
			if s == "" {
				continue
			}
			if n, ok := tryParseBOAmountString(s, floatIsMajor, intIsMajor); ok {
				return n, true
			}
		}
	}
	return 0, false
}

func valuesForKeyCI(q url.Values, name string) []string {
	var out []string
	want := strings.ToLower(strings.TrimSpace(name))
	for k, vals := range q {
		if strings.ToLower(strings.TrimSpace(k)) != want {
			continue
		}
		for _, v := range vals {
			if s := strings.TrimSpace(v); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func tryParseBOAmountString(s string, floatIsMajor, intIsMajor bool) (int64, bool) {
	if _, err := strconv.ParseInt(s, 10, 64); err == nil {
		n, _ := strconv.ParseInt(s, 10, 64)
		if intIsMajor {
			return n * 100, true
		}
		return n, true
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	if !floatIsMajor && !intIsMajor {
		return int64(math.Round(f)), true
	}
	return int64(math.Round(f * 100)), true
}

func resolveBlueOceanRemoteUser(ctx context.Context, pool *pgxpool.Pool, remote string) (string, error) {
	uid, err := blueocean.ResolveWalletRemoteToUserID(ctx, pool, remote)
	if err != nil {
		return "", err
	}
	return uid, nil
}

func debitMagnitudeByIdemForUser(ctx context.Context, tx pgx.Tx, userID, idem string) int64 {
	uid := strings.TrimSpace(userID)
	if uid == "" || strings.TrimSpace(idem) == "" {
		return 0
	}
	var sum int64
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE user_id = $1::uuid AND idempotency_key = $2
	`, uid, idem).Scan(&sum)
	if sum >= 0 {
		return 0
	}
	return -sum
}

func boWalletRemoteNorm(s string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), "-", ""))
}

// boWalletKeyRemoteTx returns the canonical player id string for ledger idempotency (link.remote_player_id),
// falling back to the callback's remote when no link row exists (users.id-only balance tests).
func boWalletKeyRemoteTx(ctx context.Context, tx pgx.Tx, userID, requestRemote string) string {
	var linkID string
	_ = tx.QueryRow(ctx, `
		SELECT remote_player_id FROM blueocean_player_links WHERE user_id = $1::uuid LIMIT 1
	`, userID).Scan(&linkID)
	linkID = strings.TrimSpace(linkID)
	if linkID != "" {
		return linkID
	}
	return strings.TrimSpace(requestRemote)
}

// boGameDebitRollbackScanKeys lists idempotency keys for debit net / rollback sums for one user.
// Primary keys are blueocean:{userUUID}:{remote}:... so two players can share the same provider
// transaction_id without ledger collisions. Legacy keys remain for older rows.
func boGameDebitRollbackScanKeys(userID, remote, txnID string) []string {
	remote = strings.TrimSpace(remote)
	txnID = strings.TrimSpace(txnID)
	if remote == "" || txnID == "" {
		return nil
	}
	uid := strings.TrimSpace(userID)
	var head []string
	if uid != "" {
		head = []string{
			fmt.Sprintf("blueocean:%s:%s:debit:%s:cash", uid, remote, txnID),
			fmt.Sprintf("blueocean:%s:%s:debit:%s:bonus", uid, remote, txnID),
			fmt.Sprintf("blueocean:%s:%s:rollback:%s:cash", uid, remote, txnID),
			fmt.Sprintf("blueocean:%s:%s:rollback:%s:bonus", uid, remote, txnID),
		}
	}
	leg := []string{
		fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, txnID),
		fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, txnID),
		fmt.Sprintf("bo:game:rollback:cash:%s:%s", remote, txnID),
		fmt.Sprintf("bo:game:rollback:bonus:%s:%s", remote, txnID),
		fmt.Sprintf("blueocean:%s:debit:%s:cash", remote, txnID),
		fmt.Sprintf("blueocean:%s:debit:%s:bonus", remote, txnID),
		fmt.Sprintf("blueocean:%s:rollback:%s:cash", remote, txnID),
		fmt.Sprintf("blueocean:%s:rollback:%s:bonus", remote, txnID),
	}
	if uid == "" {
		return dedupeBOLedgerKeys(append(head, leg...))
	}
	v2 := []string{
		fmt.Sprintf("bo:game:debit:cash:%s:%s:%s", uid, remote, txnID),
		fmt.Sprintf("bo:game:debit:bonus:%s:%s:%s", uid, remote, txnID),
		fmt.Sprintf("bo:game:rollback:cash:%s:%s:%s", uid, remote, txnID),
		fmt.Sprintf("bo:game:rollback:bonus:%s:%s:%s", uid, remote, txnID),
	}
	return dedupeBOLedgerKeys(append(append(head, leg...), v2...))
}

func boCreditScanKeys(userID, remote, tid string) []string {
	remote = strings.TrimSpace(remote)
	tid = strings.TrimSpace(tid)
	if remote == "" || tid == "" {
		return nil
	}
	leg := fmt.Sprintf("bo:game:credit:%s:%s", remote, tid)
	neo := fmt.Sprintf("blueocean:%s:credit:%s", remote, tid)
	uid := strings.TrimSpace(userID)
	var head []string
	if uid != "" {
		head = []string{fmt.Sprintf("blueocean:%s:%s:credit:%s", uid, remote, tid)}
	}
	if uid == "" {
		return dedupeBOLedgerKeys(append(head, neo, leg))
	}
	v2 := fmt.Sprintf("bo:game:credit:%s:%s:%s", uid, remote, tid)
	return dedupeBOLedgerKeys(append(head, neo, v2, leg))
}

func boWinRollbackScanKeys(userID, remote, tid string) []string {
	remote = strings.TrimSpace(remote)
	tid = strings.TrimSpace(tid)
	if remote == "" || tid == "" {
		return nil
	}
	leg := fmt.Sprintf("bo:game:rollback:win:%s:%s", remote, tid)
	neo := fmt.Sprintf("blueocean:%s:rollback_win:%s", remote, tid)
	uid := strings.TrimSpace(userID)
	var head []string
	if uid != "" {
		head = []string{fmt.Sprintf("blueocean:%s:%s:rollback_win:%s", uid, remote, tid)}
	}
	if uid == "" {
		return dedupeBOLedgerKeys(append(head, neo, leg))
	}
	v2 := fmt.Sprintf("bo:game:rollback:win:%s:%s:%s", uid, remote, tid)
	return dedupeBOLedgerKeys(append(head, neo, v2, leg))
}

func dedupeBOLedgerKeys(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

func sumLedgerKeysINForUser(ctx context.Context, tx pgx.Tx, userID string, keys []string) (int64, error) {
	uid := strings.TrimSpace(userID)
	if len(keys) == 0 || uid == "" {
		return 0, nil
	}
	args := make([]any, 1+len(keys))
	args[0] = uid
	ph := make([]string, len(keys))
	for i, k := range keys {
		args[i+1] = k
		ph[i] = fmt.Sprintf("$%d", i+2)
	}
	q := `SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE user_id = $1::uuid AND idempotency_key IN (` + strings.Join(ph, ",") + `)`
	var sum int64
	err := tx.QueryRow(ctx, q, args...).Scan(&sum)
	return sum, err
}

func sumLedgerKeysIN(ctx context.Context, tx pgx.Tx, keys []string) (int64, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	args := make([]any, len(keys))
	ph := make([]string, len(keys))
	for i, k := range keys {
		args[i] = k
		ph[i] = fmt.Sprintf("$%d", i+1)
	}
	q := `SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE idempotency_key IN (` + strings.Join(ph, ",") + `)`
	var sum int64
	err := tx.QueryRow(ctx, q, args...).Scan(&sum)
	return sum, err
}

func isBOSeamlessProviderTxnPrefix(s string) bool {
	if len(s) == 0 || len(s) > 6 {
		return false
	}
	for _, r := range s {
		if !unicode.IsLetter(r) {
			return false
		}
	}
	return true
}

// looksLikeBOSeamlessTxnTokenSuffix is true for long hex tokens often used after a provider prefix (e.g. ez-<hex>).
func looksLikeBOSeamlessTxnTokenSuffix(s string) bool {
	if len(s) < 8 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
			return false
		}
	}
	return true
}

// boWalletTxnWireFormatVariants returns provider transaction id variants to match ledger idempotency keys.
// Rollbacks often arrive as "ez-<hex>" while the original debit was keyed as "<hex>" only (or vice versa).
func boWalletTxnWireFormatVariants(wire string) []string {
	wire = strings.TrimSpace(wire)
	if wire == "" {
		return nil
	}
	seen := make(map[string]struct{}, 4)
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	add(wire)
	if i := strings.IndexByte(wire, '-'); i > 0 && i < len(wire)-1 {
		prefix := wire[:i]
		suffix := wire[i+1:]
		if isBOSeamlessProviderTxnPrefix(prefix) && looksLikeBOSeamlessTxnTokenSuffix(suffix) {
			add(suffix)
		}
	}
	return out
}

// boWalletTxnIDLookupVariants returns wire forms used to find an existing blueocean_wallet_transactions row
// (idempotency + rollback) when providers alternate between "ez-<hex>" and bare hex transaction_id values.
// Inserts still use the exact incoming transaction_id string; only lookups widen to these variants.
func boWalletTxnIDLookupVariants(wire string) []string {
	wire = strings.TrimSpace(wire)
	if wire == "" {
		return nil
	}
	seen := make(map[string]struct{}, 8)
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	for _, v := range boWalletTxnWireFormatVariants(wire) {
		add(v)
	}
	// Bare hex → common Evolution-style "ez-" prefix (forward lookup).
	if i := strings.IndexByte(wire, '-'); i < 0 && looksLikeBOSeamlessTxnTokenSuffix(wire) {
		add("ez-" + wire)
		add("EZ-" + wire)
	}
	return out
}

// boLedgerTxnIDForDebitRow reconstructs the ledger idempotency segment (possibly txn + "::" + round)
// from data we stored on the original debit row.
func boLedgerTxnIDForDebitRow(storedTxnID, storedRoundID string, ledgerUsesRound bool) string {
	storedTxnID = strings.TrimSpace(storedTxnID)
	if storedTxnID == "" || storedTxnID == "na" || !ledgerUsesRound {
		return storedTxnID
	}
	r := strings.TrimSpace(storedRoundID)
	if r == "" {
		return storedTxnID
	}
	return storedTxnID + "::" + r
}

// expandBOLedgerTxnComposite expands txn id wire formats; if base contains "::round", only the segment
// before "::" is varied (ledger keys use txn+round composite from blueOceanLedgerTxnIDForKeys).
func expandBOLedgerTxnComposite(base string, add func(string)) {
	base = strings.TrimSpace(base)
	if base == "" {
		return
	}
	if i := strings.Index(base, "::"); i >= 0 {
		prefixPart := base[:i]
		suffixComposite := base[i:]
		for _, v := range boWalletTxnWireFormatVariants(prefixPart) {
			add(v + suffixComposite)
		}
		return
	}
	for _, v := range boWalletTxnWireFormatVariants(base) {
		add(v)
	}
}

// boLedgerTxnIDVariants returns distinct transaction id strings used for ledger idempotency lookups.
// When ledgerTxn differs from txnWire (composite txn "::" round), both namespaces are queried so legacy
// rows keyed only by txnWire still participate in net and rollback calculations.
// Provider-prefixed ids (e.g. ez-<hex>) are paired with bare <hex> so rollback can find debits without round_id.
func boLedgerTxnIDVariants(txnWire, ledgerTxn string) []string {
	txnWire = strings.TrimSpace(txnWire)
	ledgerTxn = strings.TrimSpace(ledgerTxn)
	if ledgerTxn == "" {
		ledgerTxn = txnWire
	}
	if txnWire == "" && ledgerTxn == "" {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	if txnWire == ledgerTxn {
		expandBOLedgerTxnComposite(txnWire, add)
		return out
	}
	expandBOLedgerTxnComposite(ledgerTxn, add)
	expandBOLedgerTxnComposite(txnWire, add)
	return out
}

func aggregateKeysForRemotes(keyRemote, altRemote string, txnIDs []string, keyFn func(remote, tid string) []string) []string {
	var keys []string
	for _, tid := range txnIDs {
		if tid == "" {
			continue
		}
		keys = append(keys, keyFn(keyRemote, tid)...)
		if altRemote != "" && boWalletRemoteNorm(altRemote) != boWalletRemoteNorm(keyRemote) {
			keys = append(keys, keyFn(altRemote, tid)...)
		}
	}
	return dedupeBOLedgerKeys(keys)
}

// boTxnNetLedgerMinor sums ledger lines for this Blue Ocean game transaction (cash+bonus debit plus matching rollbacks)
// across txnWire and ledgerTxn key variants. Negative ⇒ funds are still reduced by this txn (active debit).
func boTxnNetLedgerMinor(ctx context.Context, tx pgx.Tx, userID, keyRemote, altRemote, txnWire, ledgerTxn string) (int64, error) {
	fn := func(remote, tid string) []string {
		return boGameDebitRollbackScanKeys(userID, remote, tid)
	}
	keys := aggregateKeysForRemotes(keyRemote, altRemote, boLedgerTxnIDVariants(txnWire, ledgerTxn), fn)
	return sumLedgerKeysINForUser(ctx, tx, userID, keys)
}

func boCreditScanKeysAggregate(userID, keyRemote, altRemote, txnWire, ledgerTxn string) []string {
	return aggregateKeysForRemotes(keyRemote, altRemote, boLedgerTxnIDVariants(txnWire, ledgerTxn), func(remote, tid string) []string {
		return boCreditScanKeys(userID, remote, tid)
	})
}

func boWinRollbackScanKeysAggregate(userID, keyRemote, altRemote, txnWire, ledgerTxn string) []string {
	return aggregateKeysForRemotes(keyRemote, altRemote, boLedgerTxnIDVariants(txnWire, ledgerTxn), func(remote, tid string) []string {
		return boWinRollbackScanKeys(userID, remote, tid)
	})
}

func boCreditScanKeysAggregateMerged(userID, keyRemote, altRemote string, wireA, ledA, wireB, ledB string) []string {
	a := boCreditScanKeysAggregate(userID, keyRemote, altRemote, wireA, ledA)
	b := boCreditScanKeysAggregate(userID, keyRemote, altRemote, wireB, ledB)
	return dedupeBOLedgerKeys(append(append([]string{}, a...), b...))
}

func boWinRollbackScanKeysAggregateMerged(userID, keyRemote, altRemote string, wireA, ledA, wireB, ledB string) []string {
	a := boWinRollbackScanKeysAggregate(userID, keyRemote, altRemote, wireA, ledA)
	b := boWinRollbackScanKeysAggregate(userID, keyRemote, altRemote, wireB, ledB)
	return dedupeBOLedgerKeys(append(append([]string{}, a...), b...))
}

// maxDebitMagBonusCash returns the largest stored debit magnitudes (bonus and cash pockets) across txn id variants and remotes.
func maxDebitMagBonusCash(ctx context.Context, tx pgx.Tx, userID, keyRemote, altRemote, txnWire, ledgerTxn string) (bonus, cash int64) {
	uid := strings.TrimSpace(userID)
	for _, tid := range boLedgerTxnIDVariants(txnWire, ledgerTxn) {
		if tid == "" {
			continue
		}
		scan := func(remote string) {
			bLeg := fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, tid)
			cLeg := fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, tid)
			bNeo := fmt.Sprintf("blueocean:%s:debit:%s:bonus", remote, tid)
			cNeo := fmt.Sprintf("blueocean:%s:debit:%s:cash", remote, tid)
			if b := debitMagnitudeByIdemForUser(ctx, tx, uid, bLeg); b > bonus {
				bonus = b
			}
			if c := debitMagnitudeByIdemForUser(ctx, tx, uid, cLeg); c > cash {
				cash = c
			}
			if b := debitMagnitudeByIdemForUser(ctx, tx, uid, bNeo); b > bonus {
				bonus = b
			}
			if c := debitMagnitudeByIdemForUser(ctx, tx, uid, cNeo); c > cash {
				cash = c
			}
			if uid != "" {
				bNeoU := fmt.Sprintf("blueocean:%s:%s:debit:%s:bonus", uid, remote, tid)
				cNeoU := fmt.Sprintf("blueocean:%s:%s:debit:%s:cash", uid, remote, tid)
				if b := debitMagnitudeByIdemForUser(ctx, tx, uid, bNeoU); b > bonus {
					bonus = b
				}
				if c := debitMagnitudeByIdemForUser(ctx, tx, uid, cNeoU); c > cash {
					cash = c
				}
				bV2 := fmt.Sprintf("bo:game:debit:bonus:%s:%s:%s", uid, remote, tid)
				cV2 := fmt.Sprintf("bo:game:debit:cash:%s:%s:%s", uid, remote, tid)
				if b := debitMagnitudeByIdemForUser(ctx, tx, uid, bV2); b > bonus {
					bonus = b
				}
				if c := debitMagnitudeByIdemForUser(ctx, tx, uid, cV2); c > cash {
					cash = c
				}
			}
		}
		scan(keyRemote)
		if altRemote != "" && boWalletRemoteNorm(altRemote) != boWalletRemoteNorm(keyRemote) {
			scan(altRemote)
		}
	}
	return bonus, cash
}

// BO seamless tooling and advanced S2S tests expect balance to be a non-negative amount string
// (operator support: signed negatives break their validators). Use magnitude here; HTTP/json
// status still carries errors.
//
// BO tooling often compares strings loosely but rejects "0.40" vs expected "0.4" — we trim redundant trailing zeros (public examples use whole euros like "300" when no cents).
func formatBOBalanceMinor(minor int64) string {
	if minor < 0 {
		// int64 min edge is unreachable for wallet balances; -minor is safe in practice.
		minor = -minor
	}
	whole := minor / 100
	frac := minor % 100
	if frac == 0 {
		return strconv.FormatInt(whole, 10)
	}
	s := fmt.Sprintf("%d.%02d", whole, frac)
	s = strings.TrimRight(s, "0")
	s = strings.TrimSuffix(s, ".")
	return s
}

func writeBOWalletJSON(w http.ResponseWriter, status int, balanceMinor int64, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	b, err := boMarshalWalletResponseJSON(status, balanceMinor, msg)
	if err != nil {
		_, _ = w.Write([]byte(`{"status":"500","balance":"0","msg":"Internal error"}` + "\n"))
		return
	}
	_, _ = w.Write(b)
}

// verifyBlueOceanWalletKey checks key = sha1(salt + signingString). Blue Ocean’s PHP sample uses
// http_build_query($_GET) after removing key: that preserves parameter **order** from the URL and
// uses x-www-form-urlencoded rules (spaces as '+'). Go’s url.Values.Encode() sorts keys and uses
// %20 for spaces — so we try several canonicalizations.
func verifyBlueOceanWalletKey(r *http.Request, merged url.Values, salt, wantKey string) bool {
	wantKey = strings.TrimSpace(strings.ToLower(wantKey))
	if wantKey == "" {
		return false
	}
	dedup := make(map[string]struct{})
	try := func(signing string) bool {
		if signing == "" {
			return false
		}
		if _, ok := dedup[signing]; ok {
			return false
		}
		dedup[signing] = struct{}{}
		// nosemgrep: go.lang.security.audit.crypto.use-of-sha1 -- BO contract
		sum := sha1.Sum([]byte(salt + signing))
		got := fmt.Sprintf("%x", sum)
		return strings.EqualFold(got, wantKey)
	}
	if r != nil {
		if raw := strings.TrimSpace(r.URL.RawQuery); raw != "" {
			if try(blueOceanSigningFromRawOrdered(raw)) {
				return true
			}
		}
	}
	if r != nil && r.Method == http.MethodPost {
		if signing, ok := blueOceanSigningFromPostJSONBody(r); ok && try(signing) {
			return true
		}
	}
	if try(blueOceanPHPSortedQuery(merged)) {
		return true
	}
	if try(blueOceanGoURLEncodeQuery(merged)) {
		return true
	}
	return false
}


type blueOceanQueryPair struct {
	key, val string
}

func parseQueryStringOrdered(raw string) []blueOceanQueryPair {
	if raw == "" {
		return nil
	}
	var out []blueOceanQueryPair
	for _, seg := range strings.Split(raw, "&") {
		if seg == "" {
			continue
		}
		k, v := seg, ""
		if i := strings.IndexByte(seg, '='); i >= 0 {
			k, v = seg[:i], seg[i+1:]
		}
		kDec, errK := url.QueryUnescape(k)
		if errK == nil {
			k = kDec
		}
		vDec, errV := url.QueryUnescape(v)
		if errV == nil {
			v = vDec
		}
		out = append(out, blueOceanQueryPair{key: k, val: v})
	}
	return out
}

// phpQueryEscape approximates PHP urlencode for application/x-www-form-urlencoded (space -> '+').
func phpQueryEscape(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "%20", "+")
}

func blueOceanSigningFromRawOrdered(raw string) string {
	pairs := parseQueryStringOrdered(raw)
	var parts []string
	for _, p := range pairs {
		if strings.EqualFold(p.key, "key") {
			continue
		}
		parts = append(parts, phpQueryEscape(p.key)+"="+phpQueryEscape(p.val))
	}
	return strings.Join(parts, "&")
}

func blueOceanPHPSortedQuery(q url.Values) string {
	if q == nil {
		return ""
	}
	var keys []string
	for k := range q {
		if strings.EqualFold(k, "key") {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		for _, val := range q[k] {
			parts = append(parts, phpQueryEscape(k)+"="+phpQueryEscape(val))
		}
	}
	return strings.Join(parts, "&")
}

func blueOceanGoURLEncodeQuery(q url.Values) string {
	v := url.Values{}
	for k, vals := range q {
		if strings.EqualFold(k, "key") {
			continue
		}
		for _, val := range vals {
			v.Add(k, val)
		}
	}
	return v.Encode()
}

const maxBlueOceanJSONBodyPeek = 256 << 10

// blueOceanSigningFromPostJSONBody builds signing string using JSON object key order (BO testers
// often POST JSON; signature may follow key order in the payload).
func blueOceanSigningFromPostJSONBody(r *http.Request) (string, bool) {
	if r == nil || r.Body == nil {
		return "", false
	}
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	if !strings.Contains(ct, "application/json") && ct != "" {
		return "", false
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBlueOceanJSONBodyPeek+1))
	if err != nil || len(body) > maxBlueOceanJSONBodyPeek {
		return "", false
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))

	keys, err := jsonObjectStringKeyOrder(bytes.TrimSpace(body))
	if err != nil || len(keys) == 0 {
		return "", false
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", false
	}
	var parts []string
	for _, k := range keys {
		if strings.EqualFold(k, "key") {
			continue
		}
		rawVal, ok := raw[k]
		if !ok {
			continue
		}
		var str string
		if err := json.Unmarshal(rawVal, &str); err == nil {
			parts = append(parts, phpQueryEscape(k)+"="+phpQueryEscape(str))
			continue
		}
		var num json.Number
		if err := json.Unmarshal(rawVal, &num); err == nil {
			parts = append(parts, phpQueryEscape(k)+"="+phpQueryEscape(num.String()))
			continue
		}
		var f float64
		if err := json.Unmarshal(rawVal, &f); err == nil {
			s := strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.6f", f), "0"), ".")
			if s == "" || s == "-" {
				s = "0"
			}
			parts = append(parts, phpQueryEscape(k)+"="+phpQueryEscape(s))
			continue
		}
		var b bool
		if err := json.Unmarshal(rawVal, &b); err == nil {
			if b {
				parts = append(parts, phpQueryEscape(k)+"="+phpQueryEscape("1"))
			} else {
				parts = append(parts, phpQueryEscape(k)+"="+phpQueryEscape("0"))
			}
			continue
		}
	}
	return strings.Join(parts, "&"), len(parts) > 0
}

func jsonObjectStringKeyOrder(data []byte) ([]string, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	t, err := dec.Token()
	if err != nil {
		return nil, err
	}
	delim, ok := t.(json.Delim)
	if !ok || delim != '{' {
		return nil, fmt.Errorf("want json object")
	}
	var keys []string
	for {
		t, err := dec.Token()
		if err != nil {
			return nil, err
		}
		if d, ok := t.(json.Delim); ok && d == '}' {
			break
		}
		key, ok := t.(string)
		if !ok {
			return nil, fmt.Errorf("want string key")
		}
		keys = append(keys, key)
		if err := skipJSONValueDecoder(dec); err != nil {
			return nil, err
		}
	}
	return keys, nil
}

func skipJSONValueDecoder(dec *json.Decoder) error {
	t, err := dec.Token()
	if err != nil {
		return err
	}
	switch v := t.(type) {
	case json.Delim:
		switch v {
		case '[':
			for dec.More() {
				if err := skipJSONValueDecoder(dec); err != nil {
					return err
				}
			}
			if _, err := dec.Token(); err != nil { // ]
				return err
			}
		case '{':
			for dec.More() {
				if _, err := dec.Token(); err != nil { // key
					return err
				}
				if err := skipJSONValueDecoder(dec); err != nil {
					return err
				}
			}
			if _, err := dec.Token(); err != nil { // }
				return err
			}
		}
	}
	return nil
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
