package raffle

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/privacy"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// MountPlayer registers /v1/raffles/* (caller mounts under /v1).
func MountPlayer(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, iss *jwtissuer.Issuer, rev *jtiredis.Revoker, accessCookieName string) {
	r.Route("/raffles", func(sr chi.Router) {
		sr.Get("/active", activeHandler(pool))
		sr.Get("/history", historyHandler(pool))
		sr.With(playerapi.OptionalBearerMiddleware(iss, rev, accessCookieName)).Get("/{slug}", detailHandler(pool))
		sr.With(playerapi.BearerMiddleware(iss, rev, accessCookieName)).Get("/{campaignID:[0-9a-fA-F-]{36}}/my-tickets", myTicketsHandler(pool))
		sr.With(playerapi.BearerMiddleware(iss, rev, accessCookieName)).Post("/{campaignID:[0-9a-fA-F-]{36}}/purchase-tickets", purchaseHandler(pool, cfg))
	})
}

func activeHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if !SystemEnabled(ctx, pool) {
			writeJSON(w, http.StatusOK, map[string]any{"active": nil, "system_enabled": false})
			return
		}
		var (
			id, slug, title, desc, imageURL, status, visibility string
			startAt, endAt, drawAt                                *time.Time
		)
		err := pool.QueryRow(ctx, `
			SELECT id::text, slug, title, description, COALESCE(image_url,''), status, visibility,
			       start_at, end_at, draw_at
			FROM raffle_campaigns
			WHERE visibility = 'public'
			  AND (
			    (status = 'active' AND start_at <= now() AND end_at >= now())
			    OR status = 'drawing'
			  )
			ORDER BY start_at DESC
			LIMIT 1
		`).Scan(&id, &slug, &title, &desc, &imageURL, &status, &visibility, &startAt, &endAt, &drawAt)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"active": nil, "system_enabled": true})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"system_enabled": true,
			"active": map[string]any{
				"id": id, "slug": slug, "title": title, "description": desc,
				"image_url": imageURL, "status": status, "visibility": visibility,
				"start_at": formatRFC(startAt), "end_at": formatRFC(endAt), "draw_at": formatRFC(drawAt),
			},
		})
	}
}

func formatRFC(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func historyHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if !SystemEnabled(ctx, pool) {
			writeJSON(w, http.StatusOK, map[string]any{"winners": []any{}})
			return
		}
		rows, err := pool.Query(ctx, `
			SELECT w.rank_slot, w.prize_amount_minor, w.prize_currency, w.prize_type,
			       c.slug, c.title, w.created_at, COALESCE(u.username, '')
			FROM raffle_winners w
			JOIN raffle_campaigns c ON c.id = w.campaign_id
			JOIN users u ON u.id = w.user_id
			WHERE w.published = true AND c.visibility = 'public'
			ORDER BY w.created_at DESC
			LIMIT 80
		`)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"winners": []any{}})
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var rank int
			var amt int64
			var ccy, ptype, slug, title, uname string
			var created time.Time
			if err := rows.Scan(&rank, &amt, &ccy, &ptype, &slug, &title, &created, &uname); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"rank":              rank,
				"prize_amount_minor": amt,
				"prize_currency":    ccy,
				"prize_type":        ptype,
				"campaign_slug":     slug,
				"campaign_title":    title,
				"won_at":            created.UTC().Format(time.RFC3339),
				"masked_username":   privacy.MaskMiddlePublicHandle(uname),
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"winners": list})
	}
}

func detailHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		slug := chi.URLParam(r, "slug")
		if slug == "active" || slug == "history" {
			http.NotFound(w, r)
			return
		}
		if !SystemEnabled(ctx, pool) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "raffle_disabled"})
			return
		}
		var (
			id, title, desc, imageURL, status, visibility string
			startAt, endAt, drawAt                        *time.Time
			ticketCfg, eligibleProd, eligibleCcy          []byte
			minWager                                      int64
			includeBonus                                  bool
			purchaseEn                                    bool
			purchaseCfg                                   []byte
			terms, notice                                 string
		)
		err := pool.QueryRow(ctx, `
			SELECT id::text, title, description, COALESCE(image_url,''), status, visibility,
			       start_at, end_at, draw_at,
			       ticket_rate_config, eligible_products, eligible_currencies,
			       min_wager_amount_minor, include_bonus_wagers,
			       purchase_enabled, purchase_config, terms_text, responsible_notice
			FROM raffle_campaigns WHERE lower(slug) = lower($1) AND visibility = 'public'
		`, slug).Scan(&id, &title, &desc, &imageURL, &status, &visibility, &startAt, &endAt, &drawAt,
			&ticketCfg, &eligibleProd, &eligibleCcy, &minWager, &includeBonus, &purchaseEn, &purchaseCfg, &terms, &notice)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
			return
		}

		prows, err := pool.Query(ctx, `
			SELECT rank_order, prize_type, amount_minor, currency, winner_slots
			FROM raffle_prizes WHERE campaign_id = $1::uuid ORDER BY rank_order ASC
		`, id)
		var prizes []map[string]any
		if err == nil {
			for prows.Next() {
				var ro int
				var pt, ccy string
				var amt int64
				var slots int
				if err := prows.Scan(&ro, &pt, &amt, &ccy, &slots); err != nil {
					continue
				}
				prizes = append(prizes, map[string]any{
					"rank_order": ro, "prize_type": pt, "amount_minor": amt, "currency": ccy, "winner_slots": slots,
				})
			}
			prows.Close()
		}

		out := map[string]any{
			"campaign": map[string]any{
				"id": id, "slug": slug, "title": title, "description": desc,
				"image_url": imageURL, "status": status, "visibility": visibility,
				"start_at": formatRFC(startAt), "end_at": formatRFC(endAt), "draw_at": formatRFC(drawAt),
				"ticket_rate_config":     json.RawMessage(ticketCfg),
				"eligible_products":      json.RawMessage(eligibleProd),
				"eligible_currencies":    json.RawMessage(eligibleCcy),
				"min_wager_amount_minor": minWager,
				"include_bonus_wagers":   includeBonus,
				"purchase_enabled":       purchaseEn,
				"purchase_config":        json.RawMessage(purchaseCfg),
				"terms_text":             terms,
				"responsible_notice":     notice,
			},
			"prizes": prizes,
		}

		if uid, ok := playerapi.UserIDFromContext(ctx); ok && uid != "" {
			var total, wagered, purchased int64
			var lastAt *time.Time
			_ = pool.QueryRow(ctx, `
				SELECT COALESCE(total_tickets,0), COALESCE(wager_tickets,0), COALESCE(purchased_tickets,0), last_ticket_at
				FROM raffle_user_totals WHERE campaign_id = $1::uuid AND user_id = $2::uuid
			`, id, uid).Scan(&total, &wagered, &purchased, &lastAt)
			out["me"] = map[string]any{
				"total_tickets":     total,
				"wager_tickets":     wagered,
				"purchased_tickets": purchased,
				"last_ticket_at":    formatRFC(lastAt),
			}
		}

		writeJSON(w, http.StatusOK, out)
	}
}

func myTicketsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		uid, ok := playerapi.UserIDFromContext(ctx)
		if !ok || uid == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		campaignID := chi.URLParam(r, "campaignID")
		rows, err := pool.Query(ctx, `
			SELECT ticket_count, source, source_ref_id, wager_amount_minor, currency, product,
			       created_at, idempotency_key, status
			FROM raffle_tickets
			WHERE campaign_id = $1::uuid AND user_id = $2::uuid
			ORDER BY created_at DESC
			LIMIT 80
		`, campaignID, uid)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "db"})
			return
		}
		defer rows.Close()
		var entries []map[string]any
		for rows.Next() {
			var cnt int64
			var src, refID, ccy, prod, idem, st string
			var wager *int64
			var created time.Time
			if err := rows.Scan(&cnt, &src, &refID, &wager, &ccy, &prod, &created, &idem, &st); err != nil {
				continue
			}
			m := map[string]any{
				"ticket_count": cnt, "source": src, "created_at": created.UTC().Format(time.RFC3339),
				"idempotency_key": idem, "status": st,
			}
			if refID != "" {
				m["source_ref_id"] = refID
			}
			if wager != nil {
				m["wager_amount_minor"] = *wager
			}
			if ccy != "" {
				m["currency"] = ccy
			}
			if prod != "" {
				m["product"] = prod
			}
			entries = append(entries, m)
		}
		writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	}
}

type purchaseBody struct {
	Quantity       int64  `json:"quantity"`
	Currency       string `json:"currency"`
	IdempotencyKey string `json:"idempotency_key"`
}

func purchaseHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	_ = cfg
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if !SystemEnabled(ctx, pool) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "raffle_disabled"})
			return
		}
		uid, ok := playerapi.UserIDFromContext(ctx)
		if !ok || uid == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		campaignID := chi.URLParam(r, "campaignID")
		var body purchaseBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Quantity <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_body"})
			return
		}
		ccy := body.Currency
		if ccy == "" {
			ccy = "USDT"
		}
		newTot, cost, err := PurchaseTickets(ctx, pool, campaignID, uid, body.Quantity, ccy, body.IdempotencyKey)
		if err != nil {
			msg := err.Error()
			switch msg {
			case "purchase_disabled":
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": msg})
			case "over_user_purchase_cap":
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": msg})
			default:
				slog.WarnContext(ctx, "raffle_purchase_failed", slog.String("err", msg))
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "purchase_failed"})
			}
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"total_tickets": newTot, "debited_minor": cost, "currency": ccy,
		})
	}
}
