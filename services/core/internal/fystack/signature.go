package fystack

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

// SignAccessSign computes Fystack ACCESS-SIGN per https://docs.fystack.io/authentication
// canonical = method={METHOD}&path={PATH}&timestamp={TIMESTAMP}&body={BODY}
// HMAC-SHA256 -> hex string -> base64 encode the hex string.
func SignAccessSign(apiSecret, method, path, body string) (timestamp string, accessSign string, err error) {
	if apiSecret == "" {
		return "", "", fmt.Errorf("fystack: empty api secret")
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	canonical := "method=" + method + "&path=" + path + "&timestamp=" + ts + "&body=" + body
	mac := hmac.New(sha256.New, []byte(apiSecret))
	_, _ = mac.Write([]byte(canonical))
	hexDigest := hex.EncodeToString(mac.Sum(nil))
	accessSign = base64.StdEncoding.EncodeToString([]byte(hexDigest))
	return ts, accessSign, nil
}
