package staffauth

import (
	"errors"
)

// NeedMFAError is returned from Login when password is valid but WebAuthn MFA must complete next.
type NeedMFAError struct {
	MFAToken string
}

func (e *NeedMFAError) Error() string { return "mfa_webauthn_required" }

// ErrMFAEnforcedNoCredential means mfa_webauthn_enforced is set but the user has no enrolled credentials.
var ErrMFAEnforcedNoCredential = errors.New("mfa enforced without webauthn credential; enroll a key or ask superadmin to disable enforcement")
