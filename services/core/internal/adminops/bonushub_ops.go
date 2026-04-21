package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/go-chi/chi/v5"
)

type simulatePaymentBody struct {
	DryRun             bool   `json:"dry_run"`
	UserID             string `json:"user_id"`
	AmountMinor        int64  `json:"amount_minor"`
	Currency           string `json:"currency"`
	Channel            string `json:"channel"`
	ProviderResourceID string `json:"provider_resource_id"`
	Country            string `json:"country"` // optional ISO-3166 alpha-2 for segment geo tests
	DepositIndex       int64  `json:"deposit_index"`
	FirstDeposit       bool   `json:"first_deposit"`
}

func (h *Handler) bonusHubSimulatePaymentSettled(w http.ResponseWriter, r *http.Request) {
	var body simulatePaymentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	ev := bonus.PaymentSettled{
		UserID: body.UserID, AmountMinor: body.AmountMinor, Currency: body.Currency, Channel: body.Channel,
		ProviderResourceID: body.ProviderResourceID, Country: strings.TrimSpace(body.Country),
		DepositIndex: body.DepositIndex, FirstDeposit: body.FirstDeposit,
	}
	if ev.UserID == "" || ev.ProviderResourceID == "" || ev.AmountMinor <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "user_id, provider_resource_id, amount_minor required")
		return
	}
	ctx := r.Context()
	if body.DryRun {
		matches, err := bonus.PreviewPaymentMatches(ctx, h.Pool, ev)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "preview_failed", err.Error())
			return
		}
		writeJSON(w, map[string]any{"dry_run": true, "promotion_matches": matches})
		return
	}
	if err := bonus.EvaluatePaymentSettled(ctx, h.Pool, ev); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "evaluate_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) bonusHubRetryWorkerFailedJob(w http.ResponseWriter, r *http.Request) {
	if h.Redis == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "no_redis", "job queue not configured")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	ctx := r.Context()
	var jobType string
	var payload []byte
	err = h.Pool.QueryRow(ctx, `
		SELECT job_type, payload FROM worker_failed_jobs WHERE id = $1 AND resolved_at IS NULL
	`, id).Scan(&jobType, &payload)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "failed job not found or already resolved")
		return
	}
	var enqueueErr error
	switch jobType {
	case "bonus_payment_settled":
		enqueueErr = jobs.Enqueue(ctx, h.Redis, jobs.Job{Type: jobType, Data: payload})
	default:
		var j jobs.Job
		if json.Unmarshal(payload, &j) == nil && j.Type != "" {
			enqueueErr = jobs.Enqueue(ctx, h.Redis, j)
		} else {
			adminapi.WriteError(w, http.StatusBadRequest, "unsupported_job", "cannot retry this job type automatically")
			return
		}
	}
	if enqueueErr != nil {
		adminapi.WriteError(w, http.StatusBadGateway, "enqueue_failed", enqueueErr.Error())
		return
	}
	_, _ = h.Pool.Exec(ctx, `UPDATE worker_failed_jobs SET resolved_at = now() WHERE id = $1`, id)
	writeJSON(w, map[string]any{"ok": true, "enqueued": true})
}
