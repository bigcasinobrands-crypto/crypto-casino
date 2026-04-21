package adminops

import (
	"encoding/csv"
	"fmt"
	"net/http"
)

func wantsCSV(r *http.Request) bool {
	return r.Header.Get("Accept") == "text/csv"
}

func writeCSV(w http.ResponseWriter, filename string, headers []string, rows [][]string) {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	cw := csv.NewWriter(w)
	_ = cw.Write(headers)
	for _, row := range rows {
		_ = cw.Write(row)
	}
	cw.Flush()
}
