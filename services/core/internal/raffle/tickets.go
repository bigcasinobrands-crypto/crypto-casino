package raffle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	idemWagerPrefix   = "raffle:wager:"
	idemReversePrefix = "raffle:reverse:"
)

var ErrNoActiveCampaign = errors.New("raffle: no active campaign")

// SystemEnabled returns global kill-switch from raffle_settings.
func SystemEnabled(ctx context.Context, pool *pgxpool.Pool) bool {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM raffle_settings WHERE key = 'system_enabled' LIMIT 1`).Scan(&raw)
	if err != nil || len(raw) == 0 {
		return true
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return true
	}
	b, _ := m["enabled"].(bool)
	return b
}

type stakeLedgerRow struct {
	UserID     string
	AmountMinor int64
	Currency   string
	EntryType  string
	Pocket     string
	Meta       map[string]any
	CreatedAt  time.Time
}

func loadLedgerStake(ctx context.Context, pool *pgxpool.Pool, idempotencyKey string) (*stakeLedgerRow, error) {
	var r stakeLedgerRow
	var meta []byte
	err := pool.QueryRow(ctx, `
		SELECT user_id::text, amount_minor, upper(trim(currency)), entry_type,
		       COALESCE(NULLIF(trim(pocket), ''), 'cash'), COALESCE(metadata, '{}'::jsonb), created_at
		FROM ledger_entries WHERE idempotency_key = $1
	`, idempotencyKey).Scan(&r.UserID, &r.AmountMinor, &r.Currency, &r.EntryType, &r.Pocket, &meta, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	if len(meta) > 0 {
		_ = json.Unmarshal(meta, &r.Meta)
	}
	return &r, nil
}

func productFromEntryType(entryType string) string {
	switch entryType {
	case ledger.EntryTypeGameDebit:
		return "casino"
	case ledger.EntryTypeSportsbookDebit:
		return "sportsbook"
	default:
		return ""
	}
}

func playerEligible(ctx context.Context, pool *pgxpool.Pool, userID string, at time.Time) (bool, string, error) {
	var selfExcl, closed *time.Time
	err := pool.QueryRow(ctx, `
		SELECT self_excluded_until, account_closed_at FROM users WHERE id = $1::uuid
	`, userID).Scan(&selfExcl, &closed)
	if err != nil {
		return false, "", err
	}
	if closed != nil && !closed.After(at) {
		return false, "account_closed", nil
	}
	if selfExcl != nil && selfExcl.After(at) {
		return false, "self_excluded", nil
	}
	return true, "", nil
}

// TicketRate describes integer-safe earning: tickets = floor(stake_minor / threshold_minor) * tickets_per_threshold.
type TicketRate struct {
	ThresholdMinor       int64 `json:"threshold_minor"`
	TicketsPerThreshold  int64 `json:"tickets_per_threshold"`
}

type ticketRateConfig struct {
	Casino      TicketRate `json:"casino"`
	Sportsbook  TicketRate `json:"sportsbook"`
}

func parseTicketRates(raw []byte) ticketRateConfig {
	def := ticketRateConfig{
		Casino:     TicketRate{ThresholdMinor: 10000, TicketsPerThreshold: 1},
		Sportsbook: TicketRate{ThresholdMinor: 10000, TicketsPerThreshold: 3},
	}
	if len(raw) == 0 {
		return def
	}
	var m ticketRateConfig
	if json.Unmarshal(raw, &m) != nil {
		return def
	}
	if m.Casino.ThresholdMinor <= 0 {
		m.Casino = def.Casino
	}
	if m.Casino.TicketsPerThreshold <= 0 {
		m.Casino.TicketsPerThreshold = 1
	}
	if m.Sportsbook.ThresholdMinor <= 0 {
		m.Sportsbook = def.Sportsbook
	}
	if m.Sportsbook.TicketsPerThreshold <= 0 {
		m.Sportsbook.TicketsPerThreshold = 1
	}
	return m
}

func computeTickets(product string, stakeMinor int64, cfg ticketRateConfig) int64 {
	var tr TicketRate
	switch product {
	case "casino":
		tr = cfg.Casino
	case "sportsbook":
		tr = cfg.Sportsbook
	default:
		return 0
	}
	if tr.ThresholdMinor <= 0 {
		return 0
	}
	floored := stakeMinor / tr.ThresholdMinor
	if floored <= 0 {
		return 0
	}
	return floored * tr.TicketsPerThreshold
}

func jsonStringSlice(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var out []string
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	r := make([]string, 0, len(out))
	for _, s := range out {
		t := strings.TrimSpace(s)
		if t != "" {
			r = append(r, t)
		}
	}
	return r
}

func campaignEligibleForStake(gameID, currency, product string, pocket string, includeBonus bool, minStake int64, stakeMinor int64,
	eligibleProducts []byte, eligibleCurrencies []byte, excludedGames []byte, includedGames []byte, excludedProviders []byte, includedProviders []byte,
) bool {
	if stakeMinor < minStake {
		return false
	}
	prods := jsonStringSlice(eligibleProducts)
	if len(prods) > 0 {
		ok := false
		for _, p := range prods {
			if strings.EqualFold(strings.TrimSpace(p), product) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	ccys := jsonStringSlice(eligibleCurrencies)
	if len(ccys) > 0 {
		ok := false
		cu := strings.ToUpper(strings.TrimSpace(currency))
		for _, c := range ccys {
			if strings.ToUpper(strings.TrimSpace(c)) == cu {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if !includeBonus && strings.EqualFold(pocket, ledger.PocketBonusLocked) {
		return false
	}
	incG := jsonStringSlice(includedGames)
	if len(incG) > 0 && gameID != "" {
		ok := false
		for _, g := range incG {
			if g == gameID {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	excG := jsonStringSlice(excludedGames)
	for _, g := range excG {
		if g == gameID && gameID != "" {
			return false
		}
	}
	// Provider filters require joining games — skipped in v1 if arrays empty
	_ = excludedProviders
	_ = includedProviders
	return true
}

// IssueTicketsFromStakeLedgerKey runs post-commit; idempotent per raffle:wager:{ledgerKey}.
func IssueTicketsFromStakeLedgerKey(ctx context.Context, pool *pgxpool.Pool, ledgerIdempotencyKey string) {
	if !SystemEnabled(ctx, pool) {
		return
	}
	row, err := loadLedgerStake(ctx, pool, ledgerIdempotencyKey)
	if err != nil {
		return
	}
	if row.AmountMinor >= 0 {
		return
	}
	stakeMinor := -row.AmountMinor
	product := productFromEntryType(row.EntryType)
	if product == "" {
		return
	}
	gameID, _ := row.Meta["game_id"].(string)
	gameID = strings.TrimSpace(gameID)

	ok, reason, err := playerEligible(ctx, pool, row.UserID, row.CreatedAt.UTC())
	if err != nil || !ok {
		if reason != "" {
			slog.Debug("raffle stake skipped user", slog.String("reason", reason), slog.String("user_id", row.UserID))
		}
		return
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		slog.Error("raffle begin tx", slog.Any("err", err))
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		campaignID            string
		ticketCfgRaw          []byte
		minWager              int64
		includeBonus          bool
		eligibleProducts      []byte
		eligibleCurrencies    []byte
		excludedGames         []byte
		includedGames         []byte
		excludedProviders     []byte
		includedProviders     []byte
		maxPerUser            *int64
		maxGlobal             *int64
	)
	q := `
		SELECT id::text, ticket_rate_config, min_wager_amount_minor, include_bonus_wagers,
		       eligible_products, eligible_currencies,
		       COALESCE(excluded_game_ids, '[]'::jsonb), COALESCE(included_game_ids, '[]'::jsonb),
		       COALESCE(excluded_provider_ids, '[]'::jsonb), COALESCE(included_provider_ids, '[]'::jsonb),
		       max_tickets_per_user, max_tickets_global
		FROM raffle_campaigns
		WHERE status = 'active'
		  AND $1 >= start_at AND $1 <= end_at
		ORDER BY start_at DESC
		LIMIT 1
	`
	err = tx.QueryRow(ctx, q, row.CreatedAt.UTC()).Scan(
		&campaignID, &ticketCfgRaw, &minWager, &includeBonus,
		&eligibleProducts, &eligibleCurrencies,
		&excludedGames, &includedGames, &excludedProviders, &includedProviders,
		&maxPerUser, &maxGlobal,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return
		}
		slog.Error("raffle load campaign", slog.Any("err", err))
		return
	}

	if !campaignEligibleForStake(gameID, row.Currency, product, row.Pocket, includeBonus, minWager, stakeMinor,
		eligibleProducts, eligibleCurrencies, excludedGames, includedGames, excludedProviders, includedProviders) {
		return
	}

	rates := parseTicketRates(ticketCfgRaw)
	nTickets := computeTickets(product, stakeMinor, rates)
	if nTickets <= 0 {
		return
	}

	idem := idemWagerPrefix + ledgerIdempotencyKey

	var globalSum, userSum int64
	_ = tx.QueryRow(ctx, `SELECT COALESCE(SUM(ticket_count), 0) FROM raffle_tickets WHERE campaign_id = $1::uuid AND status = 'posted'`, campaignID).Scan(&globalSum)
	if maxGlobal != nil && *maxGlobal > 0 && globalSum+nTickets > *maxGlobal {
		return
	}
	_ = tx.QueryRow(ctx, `SELECT COALESCE(total_tickets, 0) FROM raffle_user_totals WHERE campaign_id = $1::uuid AND user_id = $2::uuid`, campaignID, row.UserID).Scan(&userSum)
	if maxPerUser != nil && *maxPerUser > 0 && userSum+nTickets > *maxPerUser {
		nTickets = *maxPerUser - userSum
		if nTickets <= 0 {
			return
		}
	}

	metaJ, _ := json.Marshal(map[string]any{"ledger_idempotency_key": ledgerIdempotencyKey})
	ct, err := tx.Exec(ctx, `
		INSERT INTO raffle_tickets (
		  campaign_id, user_id, ticket_count, source, source_ref_type, source_ref_id,
		  wager_amount_minor, currency, product, idempotency_key, status, metadata
		) VALUES (
		  $1::uuid, $2::uuid, $3, 'wager', 'ledger_entry', $4,
		  $5, $6, $7, $8, 'posted', $9::jsonb
		)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, campaignID, row.UserID, nTickets, ledgerIdempotencyKey, stakeMinor, row.Currency, product, idem, metaJ)
	if err != nil {
		slog.Error("raffle insert ticket", slog.Any("err", err))
		return
	}
	if ct.RowsAffected() == 0 {
		return
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO raffle_user_totals (campaign_id, user_id, total_tickets, wager_tickets, eligible_wager_amount_minor, last_ticket_at, updated_at)
		VALUES ($1::uuid, $2::uuid, $3, $3, $4, now(), now())
		ON CONFLICT (campaign_id, user_id) DO UPDATE SET
		  total_tickets = raffle_user_totals.total_tickets + EXCLUDED.total_tickets,
		  wager_tickets = raffle_user_totals.wager_tickets + EXCLUDED.wager_tickets,
		  eligible_wager_amount_minor = raffle_user_totals.eligible_wager_amount_minor + EXCLUDED.eligible_wager_amount_minor,
		  last_ticket_at = now(),
		  updated_at = now()
	`, campaignID, row.UserID, nTickets, stakeMinor)
	if err != nil {
		slog.Error("raffle totals", slog.Any("err", err))
		return
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("raffle commit", slog.Any("err", err))
	}
}

// ReverseTicketsForRollbackLedgerKey maps rollback ledger row back to original debit idempotency key.
func ReverseTicketsForRollbackLedgerKey(ctx context.Context, pool *pgxpool.Pool, rollbackLedgerKey string) {
	if !SystemEnabled(ctx, pool) {
		return
	}
	debitKey, ok := resolveDebitIdempotencyFromRollback(ctx, pool, rollbackLedgerKey)
	if !ok {
		return
	}
	reversalIdem := idemReversePrefix + rollbackLedgerKey

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var campaignID, userID string
	var ticketCount int64
	err = tx.QueryRow(ctx, `
		SELECT campaign_id::text, user_id::text, ticket_count
		FROM raffle_tickets
		WHERE idempotency_key = $1 AND source = 'wager' AND status = 'posted'
	`, idemWagerPrefix+debitKey).Scan(&campaignID, &userID, &ticketCount)
	if err != nil {
		return
	}

	var drawDone bool
	_ = tx.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM raffle_draws d
		  WHERE d.campaign_id = $1::uuid AND d.status IN ('completed','published','running')
		)
	`, campaignID).Scan(&drawDone)
	if drawDone {
		_, _ = tx.Exec(ctx, `
			INSERT INTO raffle_audit_logs (campaign_id, player_user_id, action, entity_type, entity_id, after_data)
			VALUES ($1::uuid, $2::uuid, 'rollback_after_draw_flag', 'ledger', $3, $4::jsonb)
		`, campaignID, userID, rollbackLedgerKey, []byte(fmt.Sprintf(`{"debit_key":%q}`, debitKey)))
		_ = tx.Commit(ctx)
		return
	}

	metaJ, _ := json.Marshal(map[string]any{"original_wager_idempotency": debitKey, "rollback_key": rollbackLedgerKey})
	_, err = tx.Exec(ctx, `
		INSERT INTO raffle_tickets (
		  campaign_id, user_id, ticket_count, source, source_ref_type, source_ref_id,
		  wager_amount_minor, currency, product, idempotency_key, status, metadata
		) VALUES (
		  $1::uuid, $2::uuid, $3, 'reversal', 'ledger_entry', $4,
		  NULL, NULL, NULL, $5, 'posted', $6::jsonb
		)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, campaignID, userID, -ticketCount, rollbackLedgerKey, reversalIdem, metaJ)
	if err != nil {
		return
	}

	_, err = tx.Exec(ctx, `
		UPDATE raffle_user_totals SET
		  total_tickets = total_tickets + $3,
		  wager_tickets = wager_tickets + $3,
		  updated_at = now()
		WHERE campaign_id = $1::uuid AND user_id = $2::uuid
	`, campaignID, userID, -ticketCount)
	if err != nil {
		return
	}
	_ = tx.Commit(ctx)
}

func resolveDebitIdempotencyFromRollback(ctx context.Context, pool *pgxpool.Pool, rollbackKey string) (string, bool) {
	const oddinRb = "oddin:sportsbook:rollback:"
	if strings.HasPrefix(rollbackKey, oddinRb) {
		var meta []byte
		_ = pool.QueryRow(ctx, `SELECT COALESCE(metadata, '{}'::jsonb) FROM ledger_entries WHERE idempotency_key = $1`, rollbackKey).Scan(&meta)
		var m map[string]any
		if json.Unmarshal(meta, &m) == nil {
			if ref, _ := m["stake_transaction_id"].(string); strings.TrimSpace(ref) != "" {
				return fmt.Sprintf("oddin:sportsbook:debit:%s", strings.TrimSpace(ref)), true
			}
		}
		return fmt.Sprintf("oddin:sportsbook:debit:%s", strings.TrimPrefix(rollbackKey, oddinRb)), true
	}
	if strings.Contains(rollbackKey, ":rollback:") && strings.HasPrefix(rollbackKey, "blueocean:") {
		return strings.Replace(rollbackKey, ":rollback:", ":debit:", 1), true
	}
	return "", false
}
