package webhooks

import (
	"crypto/sha1"
	"fmt"
	"net/url"
	"strings"
)

// boSignGET builds a Blue Ocean–style signed query string: key = sha1(salt + urlEncode(params \ key)).
func boSignGET(salt string, params map[string]string) string {
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	sign := url.Values{}
	for k, vals := range q {
		if strings.EqualFold(k, "key") {
			continue
		}
		for _, val := range vals {
			sign.Add(k, val)
		}
	}
	// nosemgrep: go.lang.security.audit.crypto.use-of-sha1 -- BO contract
	sum := sha1.Sum([]byte(salt + sign.Encode()))
	q.Set("key", fmt.Sprintf("%x", sum))
	return q.Encode()
}
