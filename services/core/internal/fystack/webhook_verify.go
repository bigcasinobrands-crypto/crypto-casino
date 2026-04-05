package fystack

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// VerifyWorkspaceWebhook checks x-webhook-signature (hex) over canonical JSON body per Fystack webhooks doc.
func VerifyWorkspaceWebhook(publicKeyHex string, body []byte, signatureHex string) error {
	publicKeyHex = strings.TrimSpace(publicKeyHex)
	signatureHex = strings.TrimSpace(signatureHex)
	if publicKeyHex == "" || signatureHex == "" {
		return fmt.Errorf("fystack webhook: missing public key or signature")
	}
	pub, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return fmt.Errorf("fystack webhook: bad public key")
	}
	sig, err := hex.DecodeString(signatureHex)
	if err != nil {
		return fmt.Errorf("fystack webhook: bad signature hex")
	}
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("fystack webhook: body json: %w", err)
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return err
	}
	if !ed25519.Verify(pub, []byte(canonical), sig) {
		return fmt.Errorf("fystack webhook: signature mismatch")
	}
	return nil
}
