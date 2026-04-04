package adminapi

import (
	"encoding/json"
	"net/http"
)

type errBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	var b errBody
	b.Error.Code = code
	b.Error.Message = message
	_ = json.NewEncoder(w).Encode(b)
}
