package playerauth

import "strings"

// NormalizePlayerEmail returns a single canonical form for sign-in and sign-up:
// ASCII trim + lowercase. Prevents duplicate accounts that differ only by surrounding
// whitespace or letter case (same mailbox and password must not register twice).
func NormalizePlayerEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
