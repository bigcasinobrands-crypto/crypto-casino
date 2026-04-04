package playerauth

import (
	"errors"
	"unicode"
)

var ErrWeakPassword = errors.New("password does not meet policy")

// ValidatePassword requires at least 12 characters, one letter, and one digit.
func ValidatePassword(p string) error {
	if len(p) < 12 {
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
