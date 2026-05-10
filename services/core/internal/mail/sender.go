package mail

import (
	"context"
	"fmt"
	"log"
	"net/smtp"
	"strings"
)

// Sender sends transactional email.
type Sender interface {
	Send(ctx context.Context, to, subject, textBody string) error
}

// LogSender logs the message (dev when SMTP is not configured).
type LogSender struct {
	Logger *log.Logger
}

func (s *LogSender) Send(_ context.Context, to, subject, textBody string) error {
	if s.Logger != nil {
		s.Logger.Printf("mail to=%s subject=%s\n%s\n", to, subject, textBody)
	} else {
		log.Printf("mail to=%s subject=%s\n%s\n", to, subject, textBody)
	}
	return nil
}

// SendTransactional logs HTML length when present (dev / CI).
func (s *LogSender) SendTransactional(ctx context.Context, to, subject, textPlain, htmlBody string) error {
	if strings.TrimSpace(htmlBody) == "" {
		return s.Send(ctx, to, subject, textPlain)
	}
	htmlLen := len(htmlBody)
	if s.Logger != nil {
		s.Logger.Printf("mail to=%s subject=%s html_bytes=%d\n%s\n", to, subject, htmlLen, textPlain)
	} else {
		log.Printf("mail to=%s subject=%s html_bytes=%d\n%s\n", to, subject, htmlLen, textPlain)
	}
	return nil
}

// SMTPSender sends via plain SMTP (STARTTLS when port 587).
type SMTPSender struct {
	Host     string
	Port     string
	User     string
	Password string
	From     string
}

func (s *SMTPSender) Configured() bool {
	return strings.TrimSpace(s.Host) != "" && strings.TrimSpace(s.From) != ""
}

func (s *SMTPSender) Send(_ context.Context, to, subject, textBody string) error {
	if !s.Configured() {
		return fmt.Errorf("smtp not configured")
	}
	addr := s.Host + ":" + strings.TrimSpace(s.Port)
	if strings.TrimSpace(s.Port) == "" {
		addr = s.Host + ":587"
	}
	msg := []byte(fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", s.From, to, subject, textBody))
	var auth smtp.Auth
	if s.User != "" {
		auth = smtp.PlainAuth("", s.User, s.Password, s.Host)
	}
	return smtp.SendMail(addr, auth, s.From, []string{to}, msg)
}

// SendTransactional sends multipart/alternative when htmlBody is non-empty.
func (s *SMTPSender) SendTransactional(_ context.Context, to, subject, textPlain, htmlBody string) error {
	htmlBody = strings.TrimSpace(htmlBody)
	if htmlBody == "" {
		return s.Send(context.Background(), to, subject, textPlain)
	}
	if !s.Configured() {
		return fmt.Errorf("smtp not configured")
	}
	msg, err := BuildMultipartAlternativeRFC822(s.From, to, subject, textPlain, htmlBody)
	if err != nil {
		return err
	}
	addr := s.Host + ":" + strings.TrimSpace(s.Port)
	if strings.TrimSpace(s.Port) == "" {
		addr = s.Host + ":587"
	}
	var auth smtp.Auth
	if s.User != "" {
		auth = smtp.PlainAuth("", s.User, s.Password, s.Host)
	}
	return smtp.SendMail(addr, auth, s.From, []string{to}, msg)
}

// SendTransactional sends multipart HTML when supported by the concrete sender; otherwise plain text only.
func SendTransactional(ctx context.Context, s Sender, to, subject, textPlain, htmlBody string) error {
	switch v := s.(type) {
	case *ResendSender:
		return v.SendTransactional(ctx, to, subject, textPlain, htmlBody)
	case *SMTPSender:
		return v.SendTransactional(ctx, to, subject, textPlain, htmlBody)
	case *LogSender:
		return v.SendTransactional(ctx, to, subject, textPlain, htmlBody)
	default:
		return s.Send(ctx, to, subject, textPlain)
	}
}

// ChooseSender returns SMTP when configured, otherwise LogSender.
func ChooseSender(host, port, user, pass, from string) Sender {
	sm := &SMTPSender{Host: host, Port: port, User: user, Password: pass, From: from}
	if sm.Configured() {
		return sm
	}
	return &LogSender{}
}

// ChooseTransactionalSender prefers Resend when API key and from address are set,
// then SMTP, otherwise LogSender. Parameter mailFrom should be RESEND_FROM if set, else SMTP_FROM.
func ChooseTransactionalSender(resendAPIKey, mailFrom, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom string) Sender {
	rs := &ResendSender{APIKey: strings.TrimSpace(resendAPIKey), From: strings.TrimSpace(mailFrom)}
	if rs.Configured() {
		return rs
	}
	return ChooseSender(smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom)
}

// BackendSummary names the active transactional backend for startup logs (no secrets).
func BackendSummary(s Sender) string {
	switch v := s.(type) {
	case *ResendSender:
		if v.Configured() {
			return "resend"
		}
	case *SMTPSender:
		if v.Configured() {
			return "smtp"
		}
	case *LogSender:
		return "log"
	default:
		return fmt.Sprintf("%T", s)
	}
	return "log"
}
