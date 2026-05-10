package mail

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/textproto"
	"strings"
)

// BuildMultipartAlternativeRFC822 builds an SMTP-ready MIME message with text/plain + text/html alternatives.
func BuildMultipartAlternativeRFC822(from, to, subject, plain, html string) ([]byte, error) {
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if from == "" || to == "" {
		return nil, fmt.Errorf("mail: empty from/to")
	}

	var inner bytes.Buffer
	mp := multipart.NewWriter(&inner)

	hPlain := make(textproto.MIMEHeader)
	hPlain.Set("Content-Type", "text/plain; charset=UTF-8")
	hPlain.Set("Content-Transfer-Encoding", "8bit")
	pw, err := mp.CreatePart(hPlain)
	if err != nil {
		return nil, err
	}
	if _, err := pw.Write([]byte(plain)); err != nil {
		return nil, err
	}

	hHTML := make(textproto.MIMEHeader)
	hHTML.Set("Content-Type", "text/html; charset=UTF-8")
	hHTML.Set("Content-Transfer-Encoding", "8bit")
	hw, err := mp.CreatePart(hHTML)
	if err != nil {
		return nil, err
	}
	if _, err := hw.Write([]byte(html)); err != nil {
		return nil, err
	}
	if err := mp.Close(); err != nil {
		return nil, err
	}

	boundary := mp.Boundary()
	var out bytes.Buffer
	fmt.Fprintf(&out, "From: %s\r\n", from)
	fmt.Fprintf(&out, "To: %s\r\n", to)
	fmt.Fprintf(&out, "Subject: %s\r\n", subject)
	fmt.Fprintf(&out, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&out, "Content-Type: multipart/alternative; boundary=%s\r\n\r\n", boundary)
	out.Write(inner.Bytes())
	return out.Bytes(), nil
}
