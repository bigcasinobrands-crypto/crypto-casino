import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { formatApiError, readApiError } from '../api/errors'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { Toggle } from '../components/common/Toggle'
import { StatusBadge } from '../components/dashboard'

type KYCAIDSiteSettings = {
  test_mode: boolean
  form_id: string
  redirect_path_after_form: string
}

type WithdrawKYCPolicy = {
  risk_rules_enabled: boolean
  first_withdraw_risk_within_hours: number
  first_withdraw_risk_amount_min_cents: number
  daily_withdraw_count_threshold: number
  daily_withdraw_total_trigger_cents: number
}

type KYCAIDIntegrationStatus = {
  kycaid_enabled: boolean
  api_token_configured: boolean
  api_token_masked_preview?: string
  webhook_callback_url: string
  webhook_fail_closed: boolean
  withdraw_kyc_gate_dry_run: boolean
  kycaid_settings: KYCAIDSiteSettings
  withdraw_kyc_policy: WithdrawKYCPolicy
  last_webhook_received_at?: string | null
}

const inputCls = 'form-control form-control-sm'

export default function KYCAIDSettingsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [loading, setLoading] = useState(true)
  const [saveFormBusy, setSaveFormBusy] = useState(false)
  const [saveRiskBusy, setSaveRiskBusy] = useState(false)
  const [status, setStatus] = useState<KYCAIDIntegrationStatus | null>(null)
  const [formDraft, setFormDraft] = useState<KYCAIDSiteSettings | null>(null)
  const [riskDraft, setRiskDraft] = useState<WithdrawKYCPolicy | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/integrations/kycaid/status')
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, 'Could not load KYCAID status'))
        return
      }
      const body = (await res.json()) as KYCAIDIntegrationStatus
      setStatus(body)
      setFormDraft({ ...body.kycaid_settings })
      setRiskDraft({ ...body.withdraw_kyc_policy })
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  async function saveFormSettings() {
    if (!formDraft || !isSuper) return
    setSaveFormBusy(true)
    try {
      const res = await apiFetch('/v1/admin/integrations/kycaid/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_mode: formDraft.test_mode,
          form_id: formDraft.form_id,
          redirect_path_after_form: formDraft.redirect_path_after_form,
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, 'Save failed'))
        return
      }
      toast.success('KYCAID form settings saved')
      await load()
    } finally {
      setSaveFormBusy(false)
    }
  }

  async function saveRiskPolicy() {
    if (!riskDraft || !isSuper) return
    setSaveRiskBusy(true)
    try {
      const res = await apiFetch('/v1/admin/compliance/withdraw-kyc-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(riskDraft),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, 'Save failed'))
        return
      }
      toast.success('Withdraw KYC risk rules saved')
      await load()
    } finally {
      setSaveRiskBusy(false)
    }
  }

  function copyWebhook() {
    const u = status?.webhook_callback_url?.trim()
    if (!u) {
      toast.error('API_PUBLIC_BASE is not set — configure it on the core API host first.')
      return
    }
    void navigator.clipboard.writeText(u).then(
      () => toast.success('Webhook URL copied'),
      () => toast.error('Clipboard unavailable'),
    )
  }

  const envOn = status?.kycaid_enabled && status.api_token_configured

  return (
    <div className="container-fluid py-3">
      <PageMeta title="KYCAID" description="Hosted KYC forms, webhook URL, and withdrawal identity-risk rules." />
      <PageBreadcrumb
        pageTitle="KYCAID"
        subtitle="Hosted KYC, callbacks, and withdrawal identity gates."
        trail={[{ label: 'System', to: '/settings' }]}
      />

      <div className="d-flex justify-content-end mb-3">
        {!isSuper ? (
          <span className="badge text-bg-secondary">View-only — superadmin can edit settings &amp; risk rules</span>
        ) : null}
      </div>

      {loading || !status || !formDraft || !riskDraft ? (
        <div className="placeholder-glow rounded bg-body-secondary w-100" style={{ height: 220 }} />
      ) : (
        <>
          <div className="card mb-3 shadow-sm">
            <div className="card-header fw-semibold">Environment &amp; connectivity</div>
            <div className="card-body row g-3 small">
              <div className="col-md-4">
                <div className="text-secondary mb-1">KYCAID integration</div>
                <StatusBadge label={envOn ? 'ready' : 'off / incomplete'} variant={envOn ? 'success' : 'warning'} />
                <div className="text-muted mt-2">
                  Set <code>KYCAID_ENABLED=true</code> and <code>KYCAID_API_TOKEN</code> on the core API. Restart required
                  after changing env.
                </div>
              </div>
              <div className="col-md-4">
                <div className="text-secondary mb-1">API token (secret)</div>
                <div>{status.api_token_configured ? status.api_token_masked_preview || '(configured)' : 'Not set'}</div>
              </div>
              <div className="col-md-4">
                <div className="text-secondary mb-1">Webhook fail-closed</div>
                <div>{status.webhook_fail_closed ? 'yes (invalid signature → 401)' : 'no (logs warning)'}</div>
                <div className="text-muted mt-1">
                  Env: <code>KYCAID_WEBHOOK_FAIL_CLOSED</code> (defaults on in production).
                </div>
              </div>
              <div className="col-md-4">
                <div className="text-secondary mb-1">Withdraw gate dry-run</div>
                <div>{status.withdraw_kyc_gate_dry_run ? 'yes — logs only, never blocks' : 'no — enforced'}</div>
                <div className="text-muted mt-1">
                  Env: <code>WITHDRAW_KYC_GATE_DRY_RUN=true</code>
                </div>
              </div>
              <div className="col-md-8">
                <div className="text-secondary mb-1">Callback URL (paste in KYCAID dashboard)</div>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <code className="small mb-0">{status.webhook_callback_url || '(set API_PUBLIC_BASE on API host)'}</code>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => copyWebhook()}>
                    Copy
                  </button>
                </div>
              </div>
              <div className="col-md-4">
                <div className="text-secondary mb-1">Last webhook received</div>
                <div>{status.last_webhook_received_at ?? '—'}</div>
              </div>
            </div>
          </div>

          <div className="card mb-3 shadow-sm">
            <div className="card-header fw-semibold">Hosted form (site settings)</div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <div className="fw-medium mb-1">KYCAID test mode</div>
                  <div className="d-flex align-items-center gap-2">
                    <Toggle
                      checked={formDraft.test_mode}
                      onChange={(v) => setFormDraft((d) => (d ? { ...d, test_mode: v } : d))}
                      disabled={!isSuper}
                    />
                    <span className="text-muted small">Mirrors KYCAID dashboard test behaviour for this form.</span>
                  </div>
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label small mb-1">Form ID</label>
                  <input
                    className={inputCls}
                    value={formDraft.form_id}
                    disabled={!isSuper}
                    onChange={(e) => setFormDraft((d) => (d ? { ...d, form_id: e.target.value } : d))}
                    placeholder="KYCAID form id"
                  />
                </div>
                <div className="col-12">
                  <label className="form-label small mb-1">Redirect path after form</label>
                  <input
                    className={inputCls}
                    value={formDraft.redirect_path_after_form}
                    disabled={!isSuper}
                    onChange={(e) => setFormDraft((d) => (d ? { ...d, redirect_path_after_form: e.target.value } : d))}
                    placeholder="/profile?settings=verify"
                  />
                  <div className="text-muted small mt-1">Appended to Public Player URL unless an absolute https URL.</div>
                </div>
              </div>
              {isSuper ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm mt-3"
                  disabled={saveFormBusy}
                  onClick={() => void saveFormSettings()}
                >
                  {saveFormBusy ? 'Saving…' : 'Save form settings'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="card mb-3 shadow-sm">
            <div className="card-header fw-semibold">Withdrawal identity-risk rules (USD cents)</div>
            <div className="card-body">
              <div className="mb-3">
                <div className="fw-medium mb-1">Internal risk signals</div>
                <div className="d-flex align-items-center gap-2">
                  <Toggle
                    checked={riskDraft.risk_rules_enabled}
                    onChange={(v) => setRiskDraft((d) => (d ? { ...d, risk_rules_enabled: v } : d))}
                    disabled={!isSuper}
                  />
                  <span className="text-muted small">
                    Beyond the env large-withdrawal threshold (PassimPay withdrawals only).
                  </span>
                </div>
              </div>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label small mb-1">First-withdraw window (hours since signup)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    disabled={!isSuper}
                    value={riskDraft.first_withdraw_risk_within_hours}
                    onChange={(e) =>
                      setRiskDraft((d) =>
                        d ? { ...d, first_withdraw_risk_within_hours: Number(e.target.value) || 0 } : d,
                      )
                    }
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small mb-1">First-withdraw minimum (USD cents)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    disabled={!isSuper}
                    value={riskDraft.first_withdraw_risk_amount_min_cents}
                    onChange={(e) =>
                      setRiskDraft((d) =>
                        d ? { ...d, first_withdraw_risk_amount_min_cents: Number(e.target.value) || 0 } : d,
                      )
                    }
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small mb-1">Rolling 24h withdraw count threshold</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    disabled={!isSuper}
                    value={riskDraft.daily_withdraw_count_threshold}
                    onChange={(e) =>
                      setRiskDraft((d) =>
                        d ? { ...d, daily_withdraw_count_threshold: Number(e.target.value) || 0 } : d,
                      )
                    }
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small mb-1">Rolling 24h withdraw volume trigger (USD cents, incl. attempt)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    disabled={!isSuper}
                    value={riskDraft.daily_withdraw_total_trigger_cents}
                    onChange={(e) =>
                      setRiskDraft((d) =>
                        d ? { ...d, daily_withdraw_total_trigger_cents: Number(e.target.value) || 0 } : d,
                      )
                    }
                  />
                </div>
              </div>
              <p className="text-muted small mt-3 mb-0">
                Large withdrawals still use <code>KYC_LARGE_WITHDRAWAL_THRESHOLD_CENTS</code>. These rules add velocity /
                tenure checks on PassimPay withdrawals.
              </p>
              {isSuper ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm mt-3"
                  disabled={saveRiskBusy}
                  onClick={() => void saveRiskPolicy()}
                >
                  {saveRiskBusy ? 'Saving…' : 'Save risk rules'}
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
