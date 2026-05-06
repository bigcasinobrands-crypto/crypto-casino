package webhooks

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/payments/passimpay"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HandlePassimpayWebhook processes PassimPay deposit notifications (POST JSON + x-signature).
// Credits ONLY via ledger; idempotent per logical funding key orderId + txhash (fallback orderId + body digest).
//
// https://passimpay.gitbook.io/passimpay-api/webhook
func HandlePassimpayWebhook(pool *pgxpool.Pool, cfg *config.Config, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if cfg == nil || !cfg.UsesPassimpay() || !cfg.PassimPayConfigured() {
			http.Error(w, "passimpay inactive", http.StatusNotFound)
			return
		}

		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}

		sum := sha256.Sum256(raw)
		bodyDigest := hex.EncodeToString(sum[:])

		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		sigHdr := strings.TrimSpace(r.Header.Get("x-signature"))
		sigOK := passimpay.VerifyInboundBodyMap(cfg.PassimpayPlatformID, cfg.PassimpayWebhookSecret, m, sigHdr)
		if !sigOK && cfg.PassimpayFailClosed {
			log.Printf("passimpay webhook: invalid signature digest=%s", bodyDigest[:16])
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		if !sigOK && !cfg.PassimpayFailClosed {
			log.Printf("passimpay webhook: WARN invalid signature digest=%s env not fail-closed — processing anyway", bodyDigest[:16])
		}

		cbType := strings.ToLower(strings.TrimSpace(fmt.Sprint(m["type"])))
		plPid := intFromAny(m["platformId"])
		if cfg.PassimpayPlatformID != 0 && plPid != 0 && plPid != cfg.PassimpayPlatformID {
			log.Printf("passimpay webhook: platform mismatch got=%d want=%d", plPid, cfg.PassimpayPlatformID)
			http.Error(w, "platform mismatch", http.StatusBadRequest)
			return
		}

		if cbType != "" && cbType != "deposit" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = fmt.Fprintf(w, `{"ok":true,"ignored":"%s"}`, cbType)
			return
		}

		orderID := strClean(m["orderId"])
		if orderID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":false,"reason":"missing_order_id"}`))
			return
		}

		txhash := strings.TrimSpace(fmt.Sprint(m["txhash"]))
		fundKey := ledgerFundingDedupKey(orderID, txhash, bodyDigest)
		deliveryUUID := uuid.NewString()

		headersMini := compactHeaders(r)
		amtRawForLog := passimCoalesceStr(strings.TrimSpace(fmt.Sprint(m["amountReceive"])), strings.TrimSpace(fmt.Sprint(m["amount"])))
		payloadForLog := json.RawMessage(bytes.Clone(raw))

		insertTxhash := nullableTxhashForAudit(pool, r.Context(), txhash)

		var payIDSQL any
		if pid := intFromAny(m["paymentId"]); pid != 0 {
			payIDSQL = strconv.Itoa(pid)
		}

		logErr := insertDepositCallback(pool, r.Context(), depositCallbackInsert{
			DeliveryID:     deliveryUUID,
			OrderID:        orderID,
			Txhash:         insertTxhash,
			PaymentID:      payIDSQL,
			AmountRaw:      nullableStr(amtRawForLog),
			Payload:        payloadForLog,
			Headers:        headersMini,
			SignatureValid: sigOK,
		})
		if logErr != nil && !strings.Contains(strings.ToLower(logErr.Error()), "duplicate") &&
			!strings.Contains(strings.ToLower(logErr.Error()), "unique") {
			log.Printf("passimpay callback log: %v", logErr)
		}

		ctx := r.Context()

		var intentUser, intentCcy string
		var providerPID string
		err = pool.QueryRow(ctx, `
			SELECT user_id::text, currency, COALESCE(NULLIF(provider_payment_id,''), '')
			FROM payment_deposit_intents
			WHERE provider = 'passimpay' AND provider_order_id = $1
			LIMIT 1
		`, orderID).Scan(&intentUser, &intentCcy, &providerPID)
		if err != nil || intentUser == "" {
			log.Printf("passimpay webhook: orphan orderId=%s err=%v", orderID, err)
			_, _ = pool.Exec(ctx, `
				UPDATE payment_deposit_callbacks SET processing_status='ORPHAN_INTENT', error='no_matching_intent'
				WHERE provider_event_id = $1 AND provider='passimpay'
			`, deliveryUUID)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"note":"intent_not_found"}`))
			return
		}

		if providerPID == "" && intFromAny(m["paymentId"]) != 0 {
			providerPID = strconv.Itoa(intFromAny(m["paymentId"]))
		}

		amtSrc := passimCoalesceStr(strings.TrimSpace(fmt.Sprint(m["amountReceive"])), strings.TrimSpace(fmt.Sprint(m["amount"])))
		if amtSrc == "" {
			http.Error(w, "missing amount", http.StatusBadRequest)
			return
		}

		decimals := decimalsForPaymentCurrency(ctx, pool, providerPID)
		minor, perr := decimalStringToMinor(amtSrc, decimals)
		if perr != nil || minor < 1 {
			log.Printf("passimpay webhook: parse amount=%q decimals=%d err=%v", amtSrc, decimals, perr)
			http.Error(w, "bad amount", http.StatusBadRequest)
			return
		}

		idemLedger := fmt.Sprintf("passimpay:deposit:fund:%s", fundKey)

		meta := map[string]any{
			"payment_provider":   "passimpay",
			"order_id":           orderID,
			"tx_hash":             txhash,
			"funding_key":        fundKey,
			"payment_currency_id": providerPID,
			"confirmations_raw":   m["confirmations"],
			"amount_receive_raw": amtSrc,
		}

		txn, err := pool.Begin(ctx)
		if err != nil {
			http.Error(w, "server_error", http.StatusInternalServerError)
			return
		}
		defer txn.Rollback(ctx)

		inserted, err := ledger.ApplyCreditTx(ctx, txn, intentUser, strings.ToUpper(intentCcy), "deposit.credit", idemLedger, minor, meta)
		if err != nil {
			log.Printf("passimpay webhook ledger credit: %v", err)
			http.Error(w, "ledger_failed", http.StatusInternalServerError)
			return
		}

		if inserted {
			_, cErr := ledger.PostDepositInboundClearingTx(ctx, txn, ledger.HouseUserID(cfg), strings.ToUpper(intentCcy), minor, fundKey, meta)
			if cErr != nil {
				log.Printf("passimpay webhook house clearing: %v", cErr)
				http.Error(w, "ledger_clearing_failed", http.StatusInternalServerError)
				return
			}
		}

		if inserted {
			_, uerr := txn.Exec(ctx, `
				UPDATE payment_deposit_intents SET credited_amount_minor = credited_amount_minor + $2,
					status = CASE
						WHEN requested_amount_minor IS NOT NULL AND credited_amount_minor + $2 >= requested_amount_minor THEN 'CREDITED_FULL'
						ELSE 'CREDITED_PARTIALLY'
					END,
					metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_credit_tx_hash', $3),
					updated_at = now()
				WHERE provider_order_id = $1 AND provider = 'passimpay'
			`, orderID, minor, txhash)
			if uerr != nil {
				log.Printf("passimpay intent update: %v", uerr)
			}
		}

		if err := txn.Commit(ctx); err != nil {
			http.Error(w, "commit_failed", http.StatusInternalServerError)
			return
		}

		if !inserted {
			log.Printf("passimpay webhook: duplicate idempotency key=%s", idemLedger)
		} else {
			nDep, errCnt := ledger.CountSuccessfulDepositCredits(ctx, pool, intentUser)
			if errCnt != nil {
				log.Printf("passimpay deposit count: %v", errCnt)
				nDep = 1
			}
			ev := bonus.PaymentSettled{
				UserID:             intentUser,
				AmountMinor:        minor,
				Currency:           strings.ToUpper(intentCcy),
				Channel:            "on_chain_deposit",
				ProviderResourceID: orderID,
				DepositIndex:       nDep,
				FirstDeposit:       nDep == 1,
			}
			rawBonus, _ := json.Marshal(ev)
			if err := jobs.Enqueue(ctx, rdb, jobs.Job{Type: "bonus_payment_settled", Data: rawBonus}); err != nil {
				if evErr := bonus.EvaluatePaymentSettled(ctx, pool, ev); evErr != nil {
					obs.IncBonusEvalError()
					_, _ = pool.Exec(ctx, `
						INSERT INTO worker_failed_jobs (job_type, payload, error_text, attempts)
						VALUES ($1, $2::jsonb, $3, 1)
					`, "bonus_payment_settled", rawBonus, evErr.Error())
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}
}

func ledgerFundingDedupKey(orderID, txhash, bodyDigest string) string {
	if strings.TrimSpace(txhash) != "" {
		return orderID + ":" + txhash
	}
	return orderID + ":body:" + bodyDigest
}

type depositCallbackInsert struct {
	DeliveryID     string
	OrderID        string
	Txhash         *string
	PaymentID      any
	AmountRaw      any
	Payload        json.RawMessage
	Headers        json.RawMessage
	SignatureValid bool
}

func insertDepositCallback(pool *pgxpool.Pool, ctx context.Context, d depositCallbackInsert) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO payment_deposit_callbacks (
			provider, provider_event_id, provider_order_id, tx_hash, payment_id, amount_raw, payload, headers, signature_valid, processing_status
		) VALUES (
			'passimpay', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'RECEIVED'
		)
	`, d.DeliveryID, d.OrderID, d.Txhash, d.PaymentID, d.AmountRaw, d.Payload, d.Headers, d.SignatureValid)
	return err
}

func nullableStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullableTxhashForAudit(pool *pgxpool.Pool, ctx context.Context, txhash string) *string {
	t := strings.TrimSpace(txhash)
	if t == "" {
		return nil
	}
	var dup bool
	_ = pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM payment_deposit_callbacks WHERE provider='passimpay' AND tx_hash = $1)
	`, t).Scan(&dup)
	if dup {
		// Avoid violating partial unique index on tx_hash for networks that send multiple notifications per tx.
		return nil
	}
	return &t
}

func compactHeaders(r *http.Request) json.RawMessage {
	m := map[string]any{
		"x_signature_prefix": strings.TrimSpace(r.Header.Get("x-signature")),
	}
	b, _ := json.Marshal(m)
	return b
}

func decimalsForPaymentCurrency(ctx context.Context, pool *pgxpool.Pool, providerPaymentID string) int {
	if strings.TrimSpace(providerPaymentID) == "" {
		return 8
	}
	var d int
	err := pool.QueryRow(ctx, `
		SELECT decimals FROM payment_currencies
		WHERE provider = 'passimpay' AND provider_payment_id = $1 LIMIT 1
	`, providerPaymentID).Scan(&d)
	if err != nil || d < 0 || d > 18 {
		return 8
	}
	return d
}

func decimalStringToMinor(s string, decimals int) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" || decimals < 0 || decimals > 18 {
		return 0, fmt.Errorf("invalid input")
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	parts := strings.SplitN(s, ".", 2)
	wholeStr := strings.TrimSpace(parts[0])
	if wholeStr == "" {
		wholeStr = "0"
	}
	whole, err := strconv.ParseInt(wholeStr, 10, 64)
	if err != nil {
		return 0, err
	}
	frac := ""
	if len(parts) == 2 {
		frac = parts[1]
	}
	if len(frac) > decimals {
		frac = frac[:decimals]
	} else {
		frac = frac + strings.Repeat("0", decimals-len(frac))
	}
	var fracPart int64
	if frac != "" {
		if fracPart, err = strconv.ParseInt(frac, 10, 64); err != nil {
			return 0, err
		}
	}
	mult := int64(1)
	for i := 0; i < decimals; i++ {
		mult *= 10
	}
	out := whole*mult + fracPart
	if neg {
		out = -out
	}
	return out, nil
}

func strClean(v any) string {
	return strings.TrimSpace(fmt.Sprint(v))
}

func intFromAny(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case json.Number:
		i, _ := t.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(strings.TrimSpace(t))
		return i
	case int:
		return t
	case int64:
		return int(t)
	default:
		return 0
	}
}

func passimCoalesceStr(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}
