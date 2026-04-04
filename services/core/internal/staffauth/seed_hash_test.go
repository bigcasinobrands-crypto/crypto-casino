package staffauth

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// Ensures migration seed bcrypt matches the documented dev password (testadmin123).
func TestSeedMigrationPasswordHash(t *testing.T) {
	t.Parallel()
	hash := []byte("$2a$10$hSHumS8Eh4A5qL3LfpTRheQwBJPU3jOeo8hJIM6P6Kg8waxdSNt5C")
	if err := bcrypt.CompareHashAndPassword(hash, []byte("testadmin123")); err != nil {
		t.Fatalf("migration hash does not match testadmin123: %v", err)
	}
}
