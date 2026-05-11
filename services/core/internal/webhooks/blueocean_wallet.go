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
	"time"
	"unicode"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/challenges"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fingerprint"
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
	"tid",
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
	return false
}

func applyBOSeamlessWithRetry(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID, ccy string, multiCurrency, allowNeg, skipBonusBetGuards bool, action, remote, txnWire, ledgerTxn string, amount int64, gameID string) (balance int64, status int, msg string, err error) {
	var sum int64
	var st int
	var boMsg string
	var lastErr error
	for attempt := 0; attempt < boWalletTxMaxAttempts; attempt++ {
		if attempt > 0 {
			shift := min(attempt-1, 6)
			backoff := time.Duration(1<<shift) * time.Millisecond
			if backoff > 100*time.Millisecond {
				backoff = 100 * time.Millisecond
			}
			select {
			case <-ctx.Done():
				return sum, st, boMsg, context.Cause(ctx)
			case <-time.After(backoff):
			}
		}
		sum, st, boMsg, lastErr = applyBOSeamless(ctx, pool, rdb, userID, ccy, multiCurrency, allowNeg, skipBonusBetGuards, action, remote, txnWire, ledgerTxn, amount, gameID)
		if lastErr == nil {
			return sum, st, boMsg, nil
		}
		if !isBOWalletTxRetryable(lastErr) {
			return sum, st, boMsg, lastErr
		}
		log.Printf("blueocean wallet: transient DB error, retrying (%d/%d): %v", attempt+1, boWalletTxMaxAttempts, lastErr)
	}
	return sum, st, boMsg, lastErr
}

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
		if !verifyBlueOceanWalletKey(r, q, salt, wantKey) {
			log.Printf("blueocean wallet: invalid key from %s", r.RemoteAddr)
			http.Error(w, "invalid key", http.StatusUnauthorized)
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

		// Do not use "tid" here — many BO/live callbacks set tid to a shared session value, which would
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
				if ok && amt == 0 {
					sum, berr := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
					if berr != nil {
						writeBOWalletJSON(w, 500, 0, boWalletErrInternal)
						return
					}
					writeBOWalletJSON(w, 200, sum, "")
					return
				}
				if !ok || amt < 0 {
					sum, _ := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
					writeBOWalletJSON(w, 403, sum, "Invalid amount")
					return
				}
			}
			if action == "credit" {
				if ok && amt == 0 {
					sum, berr := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
					if berr != nil {
						writeBOWalletJSON(w, 500, 0, boWalletErrInternal)
						return
					}
					writeBOWalletJSON(w, 200, sum, "")
					return
				}
				if !ok || amt <= 0 {
					sum, _ := ledger.BalancePlayableSeamless(ctx, pool, userID, walletCCY, cfg.BlueOceanMulticurrency)
					writeBOWalletJSON(w, 403, sum, "Invalid amount")
					return
				}
			}

			sum, st, boMsg, err := applyBOSeamlessWithRetry(ctx, pool, rdb, userID, walletCCY, cfg.BlueOceanMulticurrency, cfg.BlueOceanWalletAllowNegativeBalance, cfg.BlueOceanWalletSkipBonusBetGuards, action, remote, txnID, ledgerTxnID, amt, gameID)
			if err != nil {
				log.Printf("blueocean wallet: %v", err)
				writeBOWalletJSON(w, 500, sum, boWalletErrInternal)
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
			writeBOWalletJSON(w, st, sum, boMsg)
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

// boGameDebitRollbackScanKeys lists idempotency keys that participate in debit net / bet rollback sums.
// Includes legacy 2-segment keys (remote:txn) and user-scoped 3-segment keys (userID:remote:txn) because
// idempotency_key is UNIQUE globally — two players can otherwise share remote+txn in edge configs and collide.
func boGameDebitRollbackScanKeys(userID, remote, txnID string) []string {
	remote = strings.TrimSpace(remote)
	txnID = strings.TrimSpace(txnID)
	if remote == "" || txnID == "" {
		return nil
	}
	leg := []string{
		fmt.Sprintf("bo:game:debit:cash:%s:%s", remote, txnID),
		fmt.Sprintf("bo:game:debit:bonus:%s:%s", remote, txnID),
		fmt.Sprintf("bo:game:rollback:cash:%s:%s", remote, txnID),
		fmt.Sprintf("bo:game:rollback:bonus:%s:%s", remote, txnID),
	}
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return dedupeBOLedgerKeys(leg)
	}
	v2 := []string{
		fmt.Sprintf("bo:game:debit:cash:%s:%s:%s", uid, remote, txnID),
		fmt.Sprintf("bo:game:debit:bonus:%s:%s:%s", uid, remote, txnID),
		fmt.Sprintf("bo:game:rollback:cash:%s:%s:%s", uid, remote, txnID),
		fmt.Sprintf("bo:game:rollback:bonus:%s:%s:%s", uid, remote, txnID),
	}
	return dedupeBOLedgerKeys(append(leg, v2...))
}

func boCreditScanKeys(userID, remote, tid string) []string {
	remote = strings.TrimSpace(remote)
	tid = strings.TrimSpace(tid)
	if remote == "" || tid == "" {
		return nil
	}
	leg := fmt.Sprintf("bo:game:credit:%s:%s", remote, tid)
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return []string{leg}
	}
	v2 := fmt.Sprintf("bo:game:credit:%s:%s:%s", uid, remote, tid)
	return dedupeBOLedgerKeys([]string{v2, leg})
}

func boWinRollbackScanKeys(userID, remote, tid string) []string {
	remote = strings.TrimSpace(remote)
	tid = strings.TrimSpace(tid)
	if remote == "" || tid == "" {
		return nil
	}
	leg := fmt.Sprintf("bo:game:rollback:win:%s:%s", remote, tid)
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return []string{leg}
	}
	v2 := fmt.Sprintf("bo:game:rollback:win:%s:%s:%s", uid, remote, tid)
	return dedupeBOLedgerKeys([]string{v2, leg})
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
	return sumLedgerKeysIN(ctx, tx, keys)
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
			if b := debitMagnitudeByIdem(ctx, tx, bLeg); b > bonus {
				bonus = b
			}
			if c := debitMagnitudeByIdem(ctx, tx, cLeg); c > cash {
				cash = c
			}
			if uid != "" {
				bV2 := fmt.Sprintf("bo:game:debit:bonus:%s:%s:%s", uid, remote, tid)
				cV2 := fmt.Sprintf("bo:game:debit:cash:%s:%s:%s", uid, remote, tid)
				if b := debitMagnitudeByIdem(ctx, tx, bV2); b > bonus {
					bonus = b
				}
				if c := debitMagnitudeByIdem(ctx, tx, cV2); c > cash {
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

func applyBOSeamless(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID, ccy string, multiCurrency, allowNeg, skipBonusBetGuards bool, action, remote, txnWire, ledgerTxn string, amount int64, gameID string) (balance int64, status int, msg string, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 500, "", err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, userID); err != nil {
		return 0, 500, "", err
	}
	keyRemote := boWalletKeyRemoteTx(ctx, tx, userID, remote)
	altRemote := strings.TrimSpace(remote)
	if altRemote != "" && boWalletRemoteNorm(altRemote) == boWalletRemoteNorm(keyRemote) {
		altRemote = ""
	}

	bal, err := ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
	if err != nil {
		return 0, 500, "", err
	}

	meta := map[string]any{"remote_id": remote, "txn": txnWire, "game_id": gameID}
	if err := fingerprint.MergeTrafficAttributionTx(ctx, tx, userID, time.Now().UTC(), meta); err != nil {
		return bal, 500, "", err
	}

	var notifyWageringProgress bool

	switch action {
	case "debit":
		if amount == 0 {
			bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if err != nil {
				return 0, 500, "", err
			}
			return bal, 200, "", nil
		}
		net, nerr := boTxnNetLedgerMinor(ctx, tx, userID, keyRemote, altRemote, txnWire, ledgerTxn)
		if nerr != nil {
			return bal, 500, "", nerr
		}
		if net < 0 {
			if amount != -net {
				return bal, 403, "Invalid amount", nil
			}
			bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if err != nil {
				return 0, 500, "", err
			}
			return bal, 200, "", nil
		}
		if !skipBonusBetGuards {
			srcRef := userID + ":" + keyRemote + ":" + ledgerTxn
			if err := bonus.CheckBetAllowedTx(ctx, tx, userID, gameID, amount, srcRef); err != nil {
				if errors.Is(err, bonus.ErrExcludedGame) || errors.Is(err, bonus.ErrMaxBetExceeded) {
					return bal, 403, "", nil
				}
				return bal, 500, "", err
			}
		}
		if !allowNeg && bal < amount {
			return bal, 403, "Insufficient funds", nil
		}
		bonusBal, err := ledger.BalanceBonusLockedSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
		if err != nil {
			return bal, 500, "", err
		}
		cashBal, err := ledger.BalanceCashSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
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
			if !allowNeg {
				return bal, 403, "Insufficient funds", nil
			}
			fromBonus = bonusBal
			fromCash = amount - fromBonus
		}
		if fromCash > 0 {
			idemC := fmt.Sprintf("bo:game:debit:cash:%s:%s:%s", userID, keyRemote, ledgerTxn)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemC, fromCash, ledger.PocketCash, meta)
			if err != nil {
				return bal, 500, "", err
			}
		}
		if fromBonus > 0 {
			idemB := fmt.Sprintf("bo:game:debit:bonus:%s:%s:%s", userID, keyRemote, ledgerTxn)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemB, fromBonus, ledger.PocketBonusLocked, meta)
			if err != nil {
				return bal, 500, "", err
			}
		}
		// Ensure the full stake posted (cash+bonus lines). ON CONFLICT DO NOTHING on one pocket but not the other
		// would under-debit while still committing — BO concurrent/idempotency drills then show wrong end balances.
		netAfter, nErr := boTxnNetLedgerMinor(ctx, tx, userID, keyRemote, altRemote, txnWire, ledgerTxn)
		if nErr != nil {
			return bal, 500, "", nErr
		}
		if netAfter != -amount {
			return bal, 500, "", fmt.Errorf("blueocean wallet: debit ledger net %d != -%d (txn %s)", netAfter, amount, txnWire)
		}
		wrUpdated, werr := bonus.ApplyPostBetWagering(ctx, tx, userID, gameID, amount)
		if werr != nil {
			return bal, 500, "", werr
		}
		notifyWageringProgress = wrUpdated
	case "credit":
		if amount == 0 {
			bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if err != nil {
				return 0, 500, "", err
			}
			return bal, 200, "", nil
		}
		idemP := fmt.Sprintf("bo:game:credit:%s:%s:%s", userID, keyRemote, ledgerTxn)
		if _, err = ledger.ApplyCreditTx(ctx, tx, userID, ccy, "game.credit", idemP, amount, meta); err != nil {
			return bal, 500, "", err
		}
		sumC, sErr := sumLedgerKeysIN(ctx, tx, boCreditScanKeysAggregate(userID, keyRemote, altRemote, txnWire, ledgerTxn))
		if sErr != nil {
			return bal, 500, "", sErr
		}
		// Strict: aggregated credit lines for this txn namespace must equal the requested win (detect double-keys / drift).
		if sumC != amount {
			return bal, 500, "", fmt.Errorf("blueocean wallet: credit ledger sum %d != amount %d (txn %s)", sumC, amount, txnWire)
		}
	case "rollback":
		// BO: empty amount on rollback — reverse using stored movements only.
		// 1) Bet rollback: reverse prior debit (bonus + cash lines).
		// 2) Win rollback: reverse prior credit for this transaction_id (tests: "rollback previous win").
		winRBKeyP := fmt.Sprintf("bo:game:rollback:win:%s:%s:%s", userID, keyRemote, ledgerTxn)

		creditSum, rerr := sumLedgerKeysIN(ctx, tx, boCreditScanKeysAggregate(userID, keyRemote, altRemote, txnWire, ledgerTxn))
		if rerr != nil {
			return bal, 500, "", rerr
		}
		winReversedSum, rerr := sumLedgerKeysIN(ctx, tx, boWinRollbackScanKeysAggregate(userID, keyRemote, altRemote, txnWire, ledgerTxn))
		if rerr != nil {
			return bal, 500, "", rerr
		}
		outstandingWin := creditSum + winReversedSum // e.g. +1000 + (-1000) after win rollback

		fb, fc := maxDebitMagBonusCash(ctx, tx, userID, keyRemote, altRemote, txnWire, ledgerTxn)

		if fb+fc == 0 && creditSum == 0 {
			return bal, 404, "TRANSACTION_NOT_FOUND", nil
		}

		if fb+fc > 0 {
			var wrRollbackStake int64
			if fb > 0 {
				idemRB := fmt.Sprintf("bo:game:rollback:bonus:%s:%s:%s", userID, keyRemote, ledgerTxn)
				ins, rerr := ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRB, fb, ledger.PocketBonusLocked, meta)
				if rerr != nil {
					return bal, 500, "", rerr
				}
				if ins {
					wrRollbackStake += fb
					if err := bonus.ReverseVIPAccrualForBonusRollbackTx(ctx, tx, userID, fb, idemRB); err != nil {
						return bal, 500, "", err
					}
				}
			}
			if fc > 0 {
				idemRC := fmt.Sprintf("bo:game:rollback:cash:%s:%s:%s", userID, keyRemote, ledgerTxn)
				ins, rerr := ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRC, fc, ledger.PocketCash, meta)
				if rerr != nil {
					return bal, 500, "", rerr
				}
				if ins {
					wrRollbackStake += fc
					if err := bonus.ReverseVIPAccrualForCashRollbackTx(ctx, tx, userID, fc, idemRC); err != nil {
						return bal, 500, "", err
					}
				}
			}
			if wrRollbackStake > 0 {
				wrRbUpdated, werr := bonus.ApplyPostBetRollbackWagering(ctx, tx, userID, gameID, wrRollbackStake)
				if werr != nil {
					return bal, 500, "", werr
				}
				if wrRbUpdated {
					notifyWageringProgress = true
				}
			}
		}

		if outstandingWin > 0 {
			// Balance after any bet-rollback credits (opening bal would be stale here).
			curBal, cerr := ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if cerr != nil {
				return bal, 500, "", cerr
			}
			if curBal < outstandingWin {
				return curBal, 403, "Insufficient funds", nil
			}
			_, err = ledger.ApplyDebitTx(ctx, tx, userID, ccy, ledger.EntryTypeGameWinRollback, winRBKeyP, outstandingWin, meta)
			if err != nil {
				return curBal, 500, "", err
			}
		}
	}

	bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
	if err != nil {
		return 0, 500, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return bal, 500, "", err
	}
	// After commit: notify subscribers when WR progress changed (full stake counts toward WR while active).
	if (action == "debit" || action == "rollback") && notifyWageringProgress && rdb != nil {
		if pubErr := bonus.PublishWageringProgressFromPool(ctx, pool, rdb, userID); pubErr != nil {
			log.Printf("blueocean wallet: redis publish wagering progress: %v", pubErr)
		}
	}
	// Re-read balance from primary after commit so the JSON matches BO's ledger (avoids any in-tx vs settled skew;
	// must stay aligned with standalone balance requests per seamless wallet contract).
	postBal, perr := ledger.BalancePlayableSeamless(ctx, pool, userID, ccy, multiCurrency)
	if perr != nil {
		return 0, 500, "", perr
	}
	return postBal, 200, "", nil
}

// formatBOBalanceMinor formats ledger minor units for Blue Ocean JSON balance strings.
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
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	type body struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
		Msg     string `json:"msg,omitempty"`
	}
	// Blue Ocean public examples use string status and string balance, e.g. {"status":"200","balance":"300"}.
	// Emitting the same types on every call avoids strict equality failures in BO staging tools (mixed number/string).
	out := body{
		Status:  strconv.Itoa(status),
		Balance: formatBOBalanceMinor(balanceMinor),
	}
	if strings.TrimSpace(msg) != "" {
		out.Msg = msg
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(out)
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
