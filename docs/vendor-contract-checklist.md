# Vendor contract checklist (BlueOcean + Fystack)

- [ ] Commercial agreement executed.
- [ ] Sandbox / production API keys in secrets manager.
- [ ] Webhook URLs registered: `https://api.<domain>/v1/webhooks/blueocean` and `/v1/webhooks/fystack`.
- [ ] `WEBHOOK_BLUEOCEAN_SECRET` / `WEBHOOK_FYSTACK_SECRET` set; signature verification enabled.
- [ ] Event catalog mapped to `idempotency_key` strategy (document per event type).
- [ ] Status page + support contact on file.
