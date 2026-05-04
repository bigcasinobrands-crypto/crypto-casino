package riskassessment

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertFromEvent stores a Fingerprint Get Event (and compact ledger snapshot) for staff audit.
// raw may be the full API response; large payloads are still bounded by PostgreSQL and API size.
func InsertFromEvent(ctx context.Context, pool *pgxpool.Pool, userID, source, fpRequestID, fpVisitorID string, raw map[string]any, ledgerSnapshot map[string]any) error {
	if pool == nil {
		return nil
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	var rawB, snapB []byte
	if raw != nil {
		b, err := json.Marshal(raw)
		if err != nil {
			return err
		}
		rawB = b
	} else {
		rawB = []byte("{}")
	}
	if ledgerSnapshot != nil {
		b, err := json.Marshal(ledgerSnapshot)
		if err != nil {
			return err
		}
		snapB = b
	} else {
		snapB = []byte("{}")
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO risk_assessments (user_id, source, fingerprint_request_id, fingerprint_visitor_id, ledger_snapshot, raw_event)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb)
	`, userID, strings.TrimSpace(source), strings.TrimSpace(fpRequestID), strings.TrimSpace(fpVisitorID), snapB, rawB)
	return err
}
