package chat

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	blocklistMu      sync.RWMutex
	blocklistTerms   []string
	blocklistFetched time.Time
)

const blocklistTTL = 30 * time.Second

// RefreshBlocklist loads enabled terms from DB (lowercased). Safe to call often.
func RefreshBlocklist(ctx context.Context, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	rows, err := pool.Query(ctx, `
		SELECT lower(trim(term)) FROM chat_blocked_terms
		WHERE enabled = true AND length(trim(term)) > 0
	`)
	if err != nil {
		return
	}
	defer rows.Close()
	var terms []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			continue
		}
		if t != "" {
			terms = append(terms, t)
		}
	}
	blocklistMu.Lock()
	blocklistTerms = terms
	blocklistFetched = time.Now()
	blocklistMu.Unlock()
}

func ensureBlocklist(ctx context.Context, pool *pgxpool.Pool) {
	blocklistMu.RLock()
	stale := time.Since(blocklistFetched) > blocklistTTL || (blocklistFetched.IsZero() && pool != nil)
	blocklistMu.RUnlock()
	if stale && pool != nil {
		RefreshBlocklist(ctx, pool)
	}
}

// MessageContainsBlockedTerm reports whether body contains a cached blocked substring.
func MessageContainsBlockedTerm(ctx context.Context, pool *pgxpool.Pool, body string) bool {
	if pool == nil || strings.TrimSpace(body) == "" {
		return false
	}
	ensureBlocklist(ctx, pool)
	lower := strings.ToLower(body)
	blocklistMu.RLock()
	defer blocklistMu.RUnlock()
	for _, t := range blocklistTerms {
		if t != "" && strings.Contains(lower, t) {
			return true
		}
	}
	return false
}
