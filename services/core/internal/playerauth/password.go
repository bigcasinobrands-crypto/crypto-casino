package playerauth

import (
	"errors"
	"unicode"
)

var ErrWeakPassword = errors.New("password does not meet policy")
var ErrPwnedPassword = errors.New("password appears in known data breaches")

// ValidatePassword requires at least 6 characters, one letter, and one digit.
func ValidatePassword(p string) error {
	if len(p) < 6 {
		return ErrWeakPassword
	}
	var letter, digit bool
	for _, r := range p {
		if unicode.IsLetter(r) {
			letter = true
		}
		if unicode.IsDigit(r) {
			digit = true
		}
	}
	if !letter || !digit {
		return ErrWeakPassword
	}
	return nil
}
