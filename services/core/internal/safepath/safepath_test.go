package safepath

import (
	"path/filepath"
	"testing"
)

func TestWithin(t *testing.T) {
	root := filepath.Join("data", "avatars")
	okPath := filepath.Join(root, "uuid-here.png")
	if !Within(root, okPath) {
		t.Fatal("expected child under root")
	}
	evil := filepath.Join(root, "..", "..", "etc", "passwd")
	if Within(root, evil) {
		t.Fatal("escaped root")
	}
}
