package webhooks

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProcessFystackPayment credits ledger for completed legacy flat payment rows.
func ProcessFystackPayment(ctx context.Context, pool *pgxpool.Pool, paymentID string) error {
	var raw []byte
	var userID *string
	var status string
	err := pool.QueryRow(ctx, `SELECT raw::text, user_id::text, status FROM fystack_payments WHERE id = $1`, paymentID).Scan(&raw, &userID, &status)
	if err != nil {
		return err
	}
	if userID == nil || *userID == "" {
		return nil
	}
	st := strings.ToLower(status)
	if st != "completed" && st != "succeeded" && st != "paid" && st != "success" {
		return nil
	}
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	amount := int64(0)
	if v, ok := m["amount_minor"].(float64); ok {
		amount = int64(v)
	}
	if amount <= 0 {
		if s := strings.TrimSpace(str(m["amount"])); s != "" {
			if n, e := strconv.ParseInt(s, 10, 64); e == nil {
				amount = n
			}
		}
	}
	if amount <= 0 {
		amount = 1
	}
	ccy := strings.TrimSpace(str(m["currency"]))
	if ccy == "" {
		ccy = "USDT"
	}
	_, err = ledger.ApplyCredit(ctx, pool, *userID, ccy, "deposit.credit", "fystack:pay:"+paymentID, amount, m)
	return err
}
