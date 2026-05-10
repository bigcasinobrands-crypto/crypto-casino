package mail

import (
	"fmt"
	"html/template"
	"strings"
)

// VerificationEmailBodies returns plain-text and HTML bodies for account email verification.
// verifyURL must be an absolute HTTPS URL to the player verify-email route (token already appended).
func VerificationEmailBodies(siteName, verifyURL string) (plain string, html string) {
	siteName = strings.TrimSpace(siteName)
	if siteName == "" {
		siteName = "VybeBet"
	}
	verifyURL = strings.TrimSpace(verifyURL)

	plain = fmt.Sprintf(
		"Verify your email at %s\n\nOpen this link (expires in 24 hours):\n%s\n\nIf you didn't create an account, you can ignore this email.\n",
		siteName,
		verifyURL,
	)

	const tmpl = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>Verify your email</title>
</head>
<body style="margin:0;padding:0;background:#0c0a12;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0c0a12;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#16141f;border-radius:14px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;font-size:20px;font-weight:700;color:#fafafa;">
              Verify your email
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 20px 28px;font-size:14px;color:#9ca3af;">
              Thanks for joining {{.SiteName}}. Confirm your email address to finish setting up your account.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;text-align:center;">
              <a href="{{.VerifyURLHref}}" style="display:inline-block;background:#ea5806;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;">
                Verify email
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 12px 28px;font-size:12px;color:#6b7280;word-break:break-all;">
              Or paste this link into your browser:<br>
              <span style="color:#9ca3af;">{{.VerifyURLText}}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 28px 28px;font-size:12px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);">
              This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#6b7280;">{{.SiteName}}</p>
      </td>
    </tr>
  </table>
</body>
</html>`

	type data struct {
		SiteName      string
		VerifyURLHref template.URL
		VerifyURLText string
	}
	buf := &strings.Builder{}
	t := template.Must(template.New("verify").Parse(tmpl))
	_ = t.Execute(buf, data{
		SiteName:      siteName,
		VerifyURLHref: template.URL(verifyURL),
		VerifyURLText: verifyURL,
	})
	html = buf.String()
	return plain, html
}
