package safepath

import (
	"path/filepath"
	"strings"
)

// Within reports whether target is root itself or a path inside root (after filepath.Clean).
// Used to prevent directory traversal when combining trusted roots with derived filenames.
func Within(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, "..") && !strings.Contains(rel, ".."))
}
