package ledger_test

import (
	"strings"
	"testing"

	"github.com/crypto-casino/core/internal/ledger"
)

func TestSettledStakeAmountCaseSQLUsesAlias(t *testing.T) {
	t.Parallel()
	s := ledger.SettledStakeAmountCaseSQL("le")
	if !strings.Contains(s, "le.") {
		t.Fatalf("expected alias le in expression: %s", s)
	}
	if !strings.Contains(s, "game.debit") {
		t.Fatal("expected debit types")
	}
}
