package mail

import (
	"testing"
)

func TestChooseTransactionalSender(t *testing.T) {
	t.Parallel()
	rs := ChooseTransactionalSender("re_test", "a@b.com", "smtp.example.com", "587", "u", "p", "fallback@example.com")
	if _, ok := rs.(*ResendSender); !ok {
		t.Fatalf("want *ResendSender, got %T", rs)
	}

	sm := ChooseTransactionalSender("", "a@b.com", "smtp.example.com", "587", "u", "p", "fallback@example.com")
	if _, ok := sm.(*SMTPSender); !ok {
		t.Fatalf("want *SMTPSender when Resend key empty, got %T", sm)
	}

	log := ChooseTransactionalSender("re_test", "", "localhost", "1025", "", "", "")
	if _, ok := log.(*LogSender); !ok {
		t.Fatalf("want *LogSender when Resend missing from, got %T", log)
	}
}

func TestBackendSummary(t *testing.T) {
	t.Parallel()
	if got := BackendSummary(&ResendSender{APIKey: "x", From: "a@b"}); got != "resend" {
		t.Fatalf("got %q", got)
	}
	if got := BackendSummary(&SMTPSender{Host: "h", From: "a@b"}); got != "smtp" {
		t.Fatalf("got %q", got)
	}
	if got := BackendSummary(&LogSender{}); got != "log" {
		t.Fatalf("got %q", got)
	}
}
