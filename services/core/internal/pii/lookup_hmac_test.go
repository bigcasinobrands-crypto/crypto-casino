package pii

import "testing"

func TestEmailLookupHMAC(t *testing.T) {
	h := EmailLookupHMAC("secret", "User@Example.com")
	if h == "" {
		t.Fatal("expected digest")
	}
	if h != EmailLookupHMAC("secret", "user@example.com") {
		t.Fatal("email should normalize case")
	}
	if EmailLookupHMAC("", "a@b.co") != "" {
		t.Fatal("empty secret")
	}
	if EmailLookupHMAC("s", "") != "" {
		t.Fatal("empty email")
	}
	b := EmailLookupHMACBytes("secret", "User@Example.com")
	if len(b) != 32 {
		t.Fatalf("expected 32-byte SHA256 HMAC, got %d", len(b))
	}
	if EmailLookupHMACBytes("", "a@b.co") != nil {
		t.Fatal("nil without secret")
	}
}
