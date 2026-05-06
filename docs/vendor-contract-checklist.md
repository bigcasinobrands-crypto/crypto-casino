# Vendor contract checklist (BlueOcean + PassimPay)

- [ ] Commercial agreement executed.
- [ ] Sandbox / production API keys in secrets manager (PassimPay: `PASSIMPAY_*`).
- [ ] Webhook URLs registered: `https://api.<domain>/v1/webhooks/blueocean` and `/v1/webhooks/passimpay`.
- [ ] `WEBHOOK_BLUEOCEAN_SECRET` set where applicable; PassimPay webhook verification via `PASSIMPAY_WEBHOOK_SECRET`.
- [ ] Event catalog mapped to `idempotency_key` strategy (document per event type).
- [ ] Status page + support contact on file.
