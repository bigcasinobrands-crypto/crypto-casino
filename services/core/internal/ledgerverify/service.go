package ledgerverify

import (
	"context"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/fingerprint"
)

// Service mirrors a small “ledger verification” layer: resolve a browser identification
// requestId to Server API event JSON and the compact ledger metadata snapshot used on lines.
// (Comparable intent to a Nest LedgerVerificationService using the same Fingerprint keys.)
type Service struct {
	FP *fingerprint.Client
}

// New returns a verification helper; fp may be nil (calls no-op / errors from FP).
func New(fp *fingerprint.Client) *Service {
	return &Service{FP: fp}
}

// SnapshotFromRequestID calls GET /events/{request_id} and returns raw event + ledger snapshot map.
func (s *Service) SnapshotFromRequestID(ctx context.Context, requestID string) (raw map[string]any, ledgerMeta map[string]any, err error) {
	if s == nil || s.FP == nil || !s.FP.Configured() {
		return nil, nil, fmt.Errorf("ledgerverify: fingerprint Server API not configured")
	}
	rid := strings.TrimSpace(requestID)
	if rid == "" {
		return nil, nil, fmt.Errorf("ledgerverify: empty request_id")
	}
	raw, err = s.FP.GetEvent(ctx, rid)
	if err != nil {
		return nil, nil, err
	}
	return raw, fingerprint.LedgerMetaFromEvent(raw), nil
}
