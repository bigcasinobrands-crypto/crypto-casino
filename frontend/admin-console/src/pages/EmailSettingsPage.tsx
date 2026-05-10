import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { formatApiError, readApiError } from '../api/errors'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { Toggle } from '../components/common/Toggle'
import { StatusBadge } from '../components/dashboard'

type TransactionalSpec = {
  verification: { enabled: boolean; subject?: string }
  password_reset: { enabled: boolean; subject?: string }
}

type EmailStatus = {
  backend: string
  from_configured: boolean
  from_masked_preview?: string
  public_player_url: string
  transactional: TransactionalSpec
  mail_brand_site_name?: string
  resend_template_verify_configured?: boolean
  resend_template_password_reset_configured?: boolean
}

const inputCls = 'form-control form-control-sm'

function backendVariant(backend: string): 'success' | 'warning' | 'neutral' {
  if (backend === 'resend' || backend === 'smtp') return 'success'
  if (backend === 'log') return 'warning'
  return 'neutral'
}

export default function EmailSettingsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [loading, setLoading] = useState(true)
  const [saveBusy, setSaveBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [draft, setDraft] = useState<TransactionalSpec | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testTemplate, setTestTemplate] = useState<'verification' | 'password_reset'>('verification')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/email/status')
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, 'Could not load email status'))
        return
      }
      const body = (await res.json()) as EmailStatus
      setStatus(body)
      setDraft(body.transactional)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!draft || !isSuper) return
    setSaveBusy(true)
    try {
      const res = await apiFetch('/v1/admin/email/transactional', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, 'Save failed'))
        return
      }
      toast.success('Email rules saved')
      await load()
    } finally {
      setSaveBusy(false)
    }
  }

  async function sendTest() {
    if (!isSuper || !testTo.trim()) {
      toast.error('Enter a recipient address')
      return
    }
    setTestBusy(true)
    try {
      const res = await apiFetch('/v1/admin/email/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: testTemplate, to: testTo.trim() }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, 'Test send failed'))
        return
      }
      toast.success('Test message queued — check inbox')
    } finally {
      setTestBusy(false)
    }
  }

  const bv = status ? backendVariant(status.backend) : 'neutral'

  return (
    <div className="container-fluid py-3">
      <PageMeta title="Email" description="Transactional delivery status, toggles, and test sends." />
      <PageBreadcrumb pageTitle="Email" subtitle="Transactional delivery status, toggles, and test sends." trail={[{ label: 'System', to: '/settings' }]} />

      <div className="d-flex justify-content-end mb-3">
        {!isSuper ? (
          <span className="badge text-bg-secondary">View-only — superadmin changes toggles &amp; tests</span>
        ) : null}
      </div>

      {loading || !status || !draft ? (
        <div className="placeholder-glow rounded bg-body-secondary w-100" style={{ height: 220 }} />
      ) : (
        <>
          <div className="card mb-3 shadow-sm">
            <div className="card-header fw-semibold">Delivery &amp; validation</div>
            <div className="card-body row g-3 small">
              <div className="col-md-4">
                <div className="text-secondary mb-1">Backend</div>
                <StatusBadge label={status.backend} variant={bv} />
                <div className="text-muted mt-2">
                  Set <code>RESEND_API_KEY</code> + <code>SMTP_FROM</code> or <code>RESEND_FROM</code> on the API host (
                  <code>log</code> only echoes to server stdout — nothing delivers).
                </div>
              </div>
              <div className="col-md-4">
                <div className="text-secondary mb-1">Sender identity</div>
                <div>{status.from_configured ? status.from_masked_preview || '(configured)' : 'Not configured'}</div>
              </div>
              <div className="col-md-4">
                <div className="text-secondary mb-1">Player UI origin</div>
                <code className="small user-select-all">{status.public_player_url}</code>
                <div className="text-muted mt-2">
                  Links in mail append <code>/verify-email?token=…</code> and <code>/reset-password?token=…</code> —
                  must match production player SPA (<code>PUBLIC_PLAYER_URL</code>).
                </div>
              </div>
              {status.backend === 'resend' ? (
                <div className="col-12">
                  <div className="text-secondary mb-1">Resend HTML templates</div>
                  <div className="small">
                    Verify template:{' '}
                    <StatusBadge
                      label={status.resend_template_verify_configured ? 'configured' : 'plain text'}
                      variant={status.resend_template_verify_configured ? 'success' : 'neutral'}
                    />
                    <span className="mx-2 text-muted">·</span>
                    Password reset template:{' '}
                    <StatusBadge
                      label={status.resend_template_password_reset_configured ? 'configured' : 'plain text'}
                      variant={status.resend_template_password_reset_configured ? 'success' : 'neutral'}
                    />
                  </div>
                  <div className="text-muted mt-2">
                    Optional: set <code>RESEND_TEMPLATE_VERIFY_EMAIL</code> and <code>RESEND_TEMPLATE_PASSWORD_RESET</code>{' '}
                    to published template ids (same template id for both is fine). Variables:{' '}
                    <code>SITE_NAME</code>, <code>PREHEADER</code>, <code>PRIMARY_HEADLINE</code>, <code>PRIMARY_BODY</code>,{' '}
                    <code>ACTION_URL</code>, <code>BUTTON_LABEL</code>, <code>EXPIRY_LINE</code>, <code>SECONDARY_NOTE</code>.
                    Brand: <code>{status.mail_brand_site_name ?? 'VybeBet'}</code> (<code>MAIL_BRAND_SITE_NAME</code>).
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card mb-3 shadow-sm">
            <div className="card-header fw-semibold d-flex justify-content-between align-items-center">
              <span>Email types</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={!isSuper || saveBusy} onClick={() => void save()}>
                {saveBusy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
            <div className="card-body">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Send</th>
                    <th>Subject override</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="fw-medium">Email verification</div>
                      <div className="text-muted small">Signup welcome verify link &amp; “Resend” from profile</div>
                    </td>
                    <td>
                      <Toggle
                        checked={draft.verification.enabled}
                        disabled={!isSuper}
                        onChange={(v) =>
                          setDraft((d) => (d ? { ...d, verification: { ...d.verification, enabled: v } } : d))
                        }
                      />
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <input
                        className={inputCls}
                        placeholder="Verify your email"
                        value={draft.verification.subject ?? ''}
                        disabled={!isSuper}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, verification: { ...d.verification, subject: e.target.value } } : d,
                          )
                        }
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="fw-medium">Password reset</div>
                      <div className="text-muted small">Forgot-password flow (never confirms whether address exists)</div>
                    </td>
                    <td>
                      <Toggle
                        checked={draft.password_reset.enabled}
                        disabled={!isSuper}
                        onChange={(v) =>
                          setDraft((d) => (d ? { ...d, password_reset: { ...d.password_reset, enabled: v } } : d))
                        }
                      />
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <input
                        className={inputCls}
                        placeholder="Reset your password"
                        value={draft.password_reset.subject ?? ''}
                        disabled={!isSuper}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, password_reset: { ...d.password_reset, subject: e.target.value } } : d,
                          )
                        }
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-muted small mb-0 mt-3">
                When verification sends are off, tokens are still issued but no outbound mail is sent — useful during cutovers.
                When password reset is off, no reset tokens are created.
              </p>
            </div>
          </div>

          <div className="card shadow-sm">
            <div className="card-header fw-semibold">Send test</div>
            <div className="card-body">
              <p className="small text-secondary mb-3">
                Sends a non-functional demo link with subject prefix <code>[TEST]</code>. Requires a live backend (
                <code>resend</code> or <code>smtp</code>).
              </p>
              <div className="row g-2 align-items-end flex-wrap">
                <div className="col-auto">
                  <label className="form-label small mb-1">Template</label>
                  <select
                    className={inputCls}
                    style={{ minWidth: 180 }}
                    disabled={!isSuper}
                    value={testTemplate}
                    onChange={(e) => setTestTemplate(e.target.value as typeof testTemplate)}
                  >
                    <option value="verification">Verification</option>
                    <option value="password_reset">Password reset</option>
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label small mb-1">Recipient</label>
                  <input
                    type="email"
                    className={inputCls}
                    placeholder="you@yourdomain.com"
                    disabled={!isSuper}
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                  />
                </div>
                <div className="col-auto">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    disabled={!isSuper || testBusy || status.backend === 'log'}
                    onClick={() => void sendTest()}
                  >
                    {testBusy ? 'Sending…' : 'Send test'}
                  </button>
                </div>
              </div>
              {!isSuper ? (
                <p className="text-warning small mb-0 mt-2">Superadmin role required for save &amp; test actions.</p>
              ) : null}
              {status.backend === 'log' ? (
                <p className="text-warning small mb-0 mt-2">
                  Backend is <code>log</code> — configure Resend or SMTP on the API to deliver tests.
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
