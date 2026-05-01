package blueocean

import "testing"

func TestFormatUserIDForXAPI(t *testing.T) {
	u := "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	if got := FormatUserIDForXAPI(u, false); got != u {
		t.Fatalf("compact off: got %q want %q", got, u)
	}
	want := "a1b2c3d4e5f67890abcdef1234567890"
	if got := FormatUserIDForXAPI(u, true); got != want {
		t.Fatalf("compact on: got %q want %q", got, want)
	}
	if got := FormatUserIDForXAPI("plain-player-id", true); got != "plain-player-id" {
		t.Fatalf("non-uuid: got %q", got)
	}
	if got := AlternateUUIDForm(u); got != want {
		t.Fatalf("AlternateUUIDForm dashed: got %q want %q", got, want)
	}
	if got := AlternateUUIDForm(want); got != u {
		t.Fatalf("AlternateUUIDForm compact: got %q want %q", got, u)
	}
	if AlternateUUIDForm("nope") != "" {
		t.Fatal("expected empty")
	}
}
