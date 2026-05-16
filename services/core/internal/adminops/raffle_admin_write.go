package adminops

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/raffle"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var slugRaffleRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type rafflePrizeWrite struct {
	RankOrder        int    `json:"rank_order"`
	PrizeType        string `json:"prize_type"`
	AmountMinor      int64  `json:"amount_minor"`
	Currency         string `json:"currency"`
	WinnerSlots      int    `json:"winner_slots"`
	AutoPayout       bool   `json:"auto_payout"`
	RequiresApproval bool   `json:"requires_approval"`
}

// raffleCampaignWrite is the body for POST /raffles and PATCH /raffles/{id} (full replacement when editable).
type raffleCampaignWrite struct {
	Slug               string             `json:"slug"`
	Title              string             `json:"title"`
	Description        string             `json:"description"`
	ImageURL           *string            `json:"image_url"`
	Status             string             `json:"status"`
	Visibility         string             `json:"visibility"`
	StartAt            string             `json:"start_at"`
	EndAt              string             `json:"end_at"`
	DrawAt             *string            `json:"draw_at"`
	EligibleProducts   []string           `json:"eligible_products"`
	EligibleCurrencies []string           `json:"eligible_currencies"`
	TicketRateConfig   json.RawMessage    `json:"ticket_rate_config"`
	PurchaseEnabled    bool               `json:"purchase_enabled"`
	PurchaseConfig     json.RawMessage    `json:"purchase_config"`
	MaxTicketsPerUser  *int64             `json:"max_tickets_per_user"`
	MaxTicketsGlobal   *int64             `json:"max_tickets_global"`
	MaxWinsPerUser     *int               `json:"max_wins_per_user"`
	TermsText          string             `json:"terms_text"`
	ResponsibleNotice  string             `json:"responsible_notice"`
	Prizes             []rafflePrizeWrite `json:"prizes"`
}

func (h *Handler) getRaffleSettingsAdmin(w http.ResponseWriter, r *http.Request) {
	enabled := raffle.SystemEnabled(r.Context(), h.Pool)
	writeJSON(w, map[string]any{"system_enabled": enabled})
}

func (h *Handler) patchRaffleSettingsAdmin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "expected {\"enabled\": boolean}")
		return
	}
	raw, err := json.Marshal(map[string]any{"enabled": body.Enabled})
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "encode_failed", err.Error())
		return
	}
	staff, _ := adminapi.StaffIDFromContext(ctx)
	var staffArg interface{}
	if staff != "" {
		staffArg = staff
	}
	_, err = h.Pool.Exec(ctx, `
		INSERT INTO raffle_settings (key, value, updated_by_staff_id, updated_at)
		VALUES ('system_enabled', $1::jsonb, $2::uuid, now())
		ON CONFLICT (key) DO UPDATE SET
		  value = EXCLUDED.value,
		  updated_by_staff_id = EXCLUDED.updated_by_staff_id,
		  updated_at = now()
	`, raw, staffArg)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, map[string]any{"system_enabled": body.Enabled})
}

func raffleTicketSumPosted(ctx context.Context, pool *pgxpool.Pool, campaignID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ticket_count), 0)::bigint FROM raffle_tickets
		WHERE campaign_id = $1::uuid AND status = 'posted'
	`, campaignID).Scan(&sum)
	return sum, err
}

func parseRFC3339Ptr(s *string) (*time.Time, error) {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(*s))
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func parseRFC3339Required(s string) (time.Time, error) {
	return time.Parse(time.RFC3339, strings.TrimSpace(s))
}

func normalizeSlug(slug string) string {
	return strings.ToLower(strings.TrimSpace(slug))
}

func validateRaffleWrite(w *raffleCampaignWrite, isCreate bool) error {
	slug := normalizeSlug(w.Slug)
	if isCreate {
		if slug == "" || len(slug) > 96 || !slugRaffleRE.MatchString(slug) {
			return fmt.Errorf("invalid_slug")
		}
	} else if slug != "" && (len(slug) > 96 || !slugRaffleRE.MatchString(slug)) {
		return fmt.Errorf("invalid_slug")
	}
	title := strings.TrimSpace(w.Title)
	if title == "" || len(title) > 500 {
		return fmt.Errorf("invalid_title")
	}
	st := strings.TrimSpace(strings.ToLower(w.Status))
	if st != "draft" && st != "scheduled" {
		return fmt.Errorf("invalid_status")
	}
	vis := strings.TrimSpace(strings.ToLower(w.Visibility))
	if vis != "public" && vis != "hidden" {
		return fmt.Errorf("invalid_visibility")
	}
	if len(w.Prizes) == 0 {
		return fmt.Errorf("prizes_required")
	}
	allowedPrize := map[string]bool{
		"cash": true, "bonus": true, "free_spins": true, "points": true, "manual": true,
	}
	for _, p := range w.Prizes {
		pt := strings.TrimSpace(strings.ToLower(p.PrizeType))
		if !allowedPrize[pt] {
			return fmt.Errorf("invalid_prize_type")
		}
		if p.WinnerSlots < 1 || p.WinnerSlots > 1000 {
			return fmt.Errorf("invalid_winner_slots")
		}
		if p.AmountMinor < 0 {
			return fmt.Errorf("invalid_amount")
		}
	}
	return nil
}

func normalizeRaffleWrite(w *raffleCampaignWrite) {
	if w.Slug != "" {
		w.Slug = normalizeSlug(w.Slug)
	}
	w.Title = strings.TrimSpace(w.Title)
	w.Description = strings.TrimSpace(w.Description)
	w.Status = strings.TrimSpace(strings.ToLower(w.Status))
	w.Visibility = strings.TrimSpace(strings.ToLower(w.Visibility))
	w.TermsText = strings.TrimSpace(w.TermsText)
	w.ResponsibleNotice = strings.TrimSpace(w.ResponsibleNotice)
	if len(w.EligibleProducts) == 0 {
		w.EligibleProducts = []string{"casino", "sportsbook"}
	}
	for i := range w.EligibleProducts {
		w.EligibleProducts[i] = strings.TrimSpace(strings.ToLower(w.EligibleProducts[i]))
	}
	for i := range w.EligibleCurrencies {
		w.EligibleCurrencies[i] = strings.TrimSpace(strings.ToUpper(w.EligibleCurrencies[i]))
	}
	if len(w.TicketRateConfig) == 0 {
		w.TicketRateConfig = []byte(`{}`)
	}
	if len(w.PurchaseConfig) == 0 {
		w.PurchaseConfig = []byte(`{}`)
	}
}

func staffUUIDPtr(staff string) *string {
	if staff == "" {
		return nil
	}
	s := staff
	return &s
}

func jsonOrEmpty(raw json.RawMessage) []byte {
	if len(raw) == 0 {
		return []byte(`{}`)
	}
	return raw
}

func (h *Handler) postRaffleCampaign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	staff, _ := adminapi.StaffIDFromContext(ctx)
	var body raffleCampaignWrite
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "could not parse body")
		return
	}
	normalizeRaffleWrite(&body)
	if err := validateRaffleWrite(&body, true); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, err.Error(), err.Error())
		return
	}
	startAt, err := parseRFC3339Required(body.StartAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_start_at", "use RFC3339 / ISO-8601 (e.g. end with Z)")
		return
	}
	endAt, err := parseRFC3339Required(body.EndAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_end_at", "use RFC3339")
		return
	}
	if endAt.Before(startAt) {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_window", "end_at must be >= start_at")
		return
	}
	drawAt, err := parseRFC3339Ptr(body.DrawAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_draw_at", "use RFC3339 or omit")
		return
	}
	elProd, err := json.Marshal(body.EligibleProducts)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_eligible_products", err.Error())
		return
	}
	elCcy, err := json.Marshal(body.EligibleCurrencies)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_eligible_currencies", err.Error())
		return
	}
	var img *string
	if body.ImageURL != nil && strings.TrimSpace(*body.ImageURL) != "" {
		s := strings.TrimSpace(*body.ImageURL)
		img = &s
	}
	mxw := 1
	if body.MaxWinsPerUser != nil && *body.MaxWinsPerUser > 0 {
		mxw = *body.MaxWinsPerUser
	}

	tc := jsonOrEmpty(body.TicketRateConfig)
	pc := jsonOrEmpty(body.PurchaseConfig)

	var staffArg interface{}
	if staff != "" {
		staffArg = staff
	}

	tx, err := h.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "tx_begin", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO raffle_campaigns (
		  slug, title, description, image_url, status, visibility,
		  start_at, end_at, draw_at,
		  eligible_products, eligible_currencies,
		  ticket_rate_config, purchase_enabled, purchase_config,
		  max_tickets_per_user, max_tickets_global, max_wins_per_user,
		  terms_text, responsible_notice,
		  created_by_staff_id, updated_by_staff_id
		) VALUES (
		  $1, $2, $3, $4, $5, $6,
		  $7, $8, $9,
		  $10::jsonb, $11::jsonb,
		  $12::jsonb, $13, $14::jsonb,
		  $15, $16, $17,
		  $18, $19,
		  $20::uuid, $21::uuid
		) RETURNING id::text
	`, body.Slug, body.Title, body.Description, img, body.Status, body.Visibility,
		startAt, endAt, drawAt,
		elProd, elCcy,
		tc, body.PurchaseEnabled, pc,
		body.MaxTicketsPerUser, body.MaxTicketsGlobal, mxw,
		body.TermsText, body.ResponsibleNotice,
		staffArg, staffArg,
	).Scan(&id)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(err.Error(), "duplicate") {
			adminapi.WriteError(w, http.StatusConflict, "slug_taken", "slug already exists")
			return
		}
		adminapi.WriteError(w, http.StatusBadRequest, "insert_failed", err.Error())
		return
	}

	for _, p := range body.Prizes {
		pt := strings.TrimSpace(p.PrizeType)
		ccy := strings.TrimSpace(p.Currency)
		if ccy == "" {
			ccy = "USDT"
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO raffle_prizes (
			  campaign_id, rank_order, prize_type, amount_minor, currency, winner_slots, auto_payout, requires_approval
			) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
		`, id, p.RankOrder, pt, p.AmountMinor, ccy, p.WinnerSlots, p.AutoPayout, p.RequiresApproval)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "prize_insert_failed", err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "commit_failed", err.Error())
		return
	}

	raffle.InsertAudit(ctx, h.Pool, &id, staffUUIDPtr(staff), nil, "create_campaign", "raffle_campaign", id, nil, map[string]any{"slug": body.Slug}, "admin_create", raffleAdminReqIP(r), r.UserAgent())
	writeJSON(w, map[string]any{"id": id})
}

func (h *Handler) patchRaffleCampaign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	staff, _ := adminapi.StaffIDFromContext(ctx)

	var curStatus string
	var curSlug string
	err := h.Pool.QueryRow(ctx, `SELECT status, slug FROM raffle_campaigns WHERE id = $1::uuid`, id).Scan(&curStatus, &curSlug)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "campaign")
		return
	}

	ticketSum, err := raffleTicketSumPosted(ctx, h.Pool, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	var body raffleCampaignWrite
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "could not parse body")
		return
	}
	if body.Slug == "" {
		body.Slug = curSlug
	}
	normalizeRaffleWrite(&body)

	fullEdit := (curStatus == "draft" || curStatus == "scheduled") && ticketSum == 0
	if !fullEdit {
		if err := patchRaffleCosmeticOnly(ctx, h.Pool, id, staff, &body); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "patch_failed", err.Error())
			return
		}
		writeJSON(w, map[string]any{"id": id, "mode": "cosmetic"})
		return
	}

	if err := validateRaffleWrite(&body, false); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, err.Error(), err.Error())
		return
	}
	startAt, err := parseRFC3339Required(body.StartAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_start_at", "use RFC3339")
		return
	}
	endAt, err := parseRFC3339Required(body.EndAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_end_at", "use RFC3339")
		return
	}
	if endAt.Before(startAt) {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_window", "end_at must be >= start_at")
		return
	}
	drawAt, err := parseRFC3339Ptr(body.DrawAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_draw_at", err.Error())
		return
	}
	elProd, err := json.Marshal(body.EligibleProducts)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_eligible_products", err.Error())
		return
	}
	elCcy, err := json.Marshal(body.EligibleCurrencies)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_eligible_currencies", err.Error())
		return
	}
	var img *string
	if body.ImageURL != nil && strings.TrimSpace(*body.ImageURL) != "" {
		s := strings.TrimSpace(*body.ImageURL)
		img = &s
	}
	mxw := 1
	if body.MaxWinsPerUser != nil && *body.MaxWinsPerUser > 0 {
		mxw = *body.MaxWinsPerUser
	}

	tc := jsonOrEmpty(body.TicketRateConfig)
	pc := jsonOrEmpty(body.PurchaseConfig)

	tx, err := h.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "tx_begin", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		UPDATE raffle_campaigns SET
		  slug = $2,
		  title = $3,
		  description = $4,
		  image_url = $5,
		  status = $6,
		  visibility = $7,
		  start_at = $8,
		  end_at = $9,
		  draw_at = $10,
		  eligible_products = $11::jsonb,
		  eligible_currencies = $12::jsonb,
		  ticket_rate_config = $13::jsonb,
		  purchase_enabled = $14,
		  purchase_config = $15::jsonb,
		  max_tickets_per_user = $16,
		  max_tickets_global = $17,
		  max_wins_per_user = $18,
		  terms_text = $19,
		  responsible_notice = $20,
		  updated_by_staff_id = NULLIF($21::text, '')::uuid,
		  updated_at = now()
		WHERE id = $1::uuid
	`, id, body.Slug, body.Title, body.Description, img, body.Status, body.Visibility,
		startAt, endAt, drawAt,
		elProd, elCcy,
		tc, body.PurchaseEnabled, pc,
		body.MaxTicketsPerUser, body.MaxTicketsGlobal, mxw,
		body.TermsText, body.ResponsibleNotice,
		staff,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(err.Error(), "duplicate") {
			adminapi.WriteError(w, http.StatusConflict, "slug_taken", "slug already exists")
			return
		}
		adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
		return
	}

	_, err = tx.Exec(ctx, `DELETE FROM raffle_prizes WHERE campaign_id = $1::uuid`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "prize_delete_failed", err.Error())
		return
	}
	for _, p := range body.Prizes {
		pt := strings.TrimSpace(p.PrizeType)
		ccy := strings.TrimSpace(p.Currency)
		if ccy == "" {
			ccy = "USDT"
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO raffle_prizes (
			  campaign_id, rank_order, prize_type, amount_minor, currency, winner_slots, auto_payout, requires_approval
			) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
		`, id, p.RankOrder, pt, p.AmountMinor, ccy, p.WinnerSlots, p.AutoPayout, p.RequiresApproval)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "prize_insert_failed", err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "commit_failed", err.Error())
		return
	}

	raffle.InsertAudit(ctx, h.Pool, &id, staffUUIDPtr(staff), nil, "update_campaign", "raffle_campaign", id, nil, map[string]any{"slug": body.Slug}, "admin_patch", raffleAdminReqIP(r), r.UserAgent())
	writeJSON(w, map[string]any{"id": id, "mode": "full"})
}

func patchRaffleCosmeticOnly(ctx context.Context, pool *pgxpool.Pool, id, staff string, body *raffleCampaignWrite) error {
	var img *string
	if body.ImageURL != nil && strings.TrimSpace(*body.ImageURL) != "" {
		s := strings.TrimSpace(*body.ImageURL)
		img = &s
	}
	title := strings.TrimSpace(body.Title)
	desc := strings.TrimSpace(body.Description)
	terms := strings.TrimSpace(body.TermsText)
	resp := strings.TrimSpace(body.ResponsibleNotice)
	if title == "" {
		return fmt.Errorf("title_required")
	}
	_, err := pool.Exec(ctx, `
		UPDATE raffle_campaigns SET
		  title = $2,
		  description = $3,
		  image_url = $4,
		  terms_text = $5,
		  responsible_notice = $6,
		  updated_by_staff_id = NULLIF($7::text, '')::uuid,
		  updated_at = now()
		WHERE id = $1::uuid
	`, id, title, desc, img, terms, resp, staff)
	return err
}
