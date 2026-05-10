package mail

import (
	"strings"
	"testing"
)

func TestVerificationEmailBodies_HTMLContainsHrefAndEscaping(t *testing.T) {
	plain, html := VerificationEmailBodies("VybeBet & Co", "https://player.example.com/verify-email?token=abc+123")
	if !strings.Contains(plain, "VybeBet & Co") || !strings.Contains(plain, "https://player.example.com/verify-email?token=abc+123") {
		t.Fatalf("plain text missing URL or brand: %q", plain)
	}
	if !strings.Contains(html, "verify-email") || !strings.Contains(html, `href="`) {
		t.Fatalf("expected verify link anchor in HTML")
	}
	if !strings.Contains(html, `VybeBet &amp; Co`) {
		t.Fatalf("site name should be HTML-escaped in body copy")
	}
	if strings.Contains(html, `<script`) {
		t.Fatal("unexpected script in HTML")
	}
}
