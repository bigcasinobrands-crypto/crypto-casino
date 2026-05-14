package ledger

import (
	"strings"
	"testing"
)

func TestNGRReportingFilterSQL(t *testing.T) {
	t.Parallel()
	s := NGRReportingFilterSQL("le")
	if !strings.Contains(s, "test.seed") {
		t.Fatal("expected test.seed exclusion")
	}
	if !strings.Contains(s, "debit_reset") {
		t.Fatal("expected debit_reset exclusion")
	}
	if !strings.Contains(s, "exclude_from_dashboard_analytics") {
		t.Fatal("expected user exclusion flag")
	}
	if !strings.Contains(s, "provider.fee") {
		t.Fatal("expected provider.fee bypass branch")
	}
}
