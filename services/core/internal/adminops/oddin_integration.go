package adminops

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/oddin"
)

// OddinIntegrationStatus returns non-secret Oddin diagnostics for admin (requires admin JWT).
func (h *Handler) OddinIntegrationStatus(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil || h.Cfg == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	out, err := oddin.IntegrationStatusJSON(r.Context(), h.Pool, h.Cfg)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not load oddin status")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
