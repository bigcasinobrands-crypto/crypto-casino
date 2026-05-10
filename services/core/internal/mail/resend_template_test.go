package mail

import (
	"context"
	"testing"
)

func TestTryResendPublishedTemplateSkips(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	sent, err := TryResendPublishedTemplate(&LogSender{}, ctx, "u@example.com", "Subj", "tpl-id", map[string]string{"X": "y"})
	if sent || err != nil {
		t.Fatalf("want skipped, got sent=%v err=%v", sent, err)
	}
	sent, err = TryResendPublishedTemplate(&ResendSender{APIKey: "k", From: "a@b"}, ctx, "u@example.com", "Subj", "", map[string]string{})
	if sent || err != nil {
		t.Fatalf("want skipped without template id, got sent=%v err=%v", sent, err)
	}
}
