package bonus

import (
	"testing"
)

func TestPublicizeStoredAssetURL(t *testing.T) {
	t.Setenv("API_PUBLIC_BASE", "https://api.example.com")
	if g, w := PublicizeStoredAssetURL("/v1/uploads/x.png"), "https://api.example.com/v1/uploads/x.png"; g != w {
		t.Fatalf("got %q want %q", g, w)
	}
	if g := PublicizeStoredAssetURL("https://cdn.example.com/a.jpg"); g != "https://cdn.example.com/a.jpg" {
		t.Fatalf("https passthrough: got %q", g)
	}
	t.Setenv("API_PUBLIC_BASE", "")
	if g, w := PublicizeStoredAssetURL("/v1/uploads/x.png"), "/v1/uploads/x.png"; g != w {
		t.Fatalf("no base: got %q want %q", g, w)
	}
}
