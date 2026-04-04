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

// ChooseSender returns SMTP when configured, otherwise LogSender.
func ChooseSender(host, port, user, pass, from string) Sender {
	sm := &SMTPSender{Host: host, Port: port, User: user, Password: pass, From: from}
	if sm.Configured() {
		return sm
	}
	return &LogSender{}
}
