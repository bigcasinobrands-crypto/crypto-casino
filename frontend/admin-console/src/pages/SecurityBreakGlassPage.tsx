import { useCallback, useEffect, useState } from 'react'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { StatusBadge } from '../components/dashboard'

type Grant = {
  id: string
  resource_key: string
  justification: string
  requester_staff_id: string
  approver_staff_id: string
  status: string
  reject_reason: string
  requested_at: string
  approved_at?: string
  expires_at?: string
  consumed_at?: string
  is_expired?: boolean
}

function statusVariant(
  g: Grant,
): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (g.status === 'approved' && g.is_expired) return 'warning'
  if (g.status === 'approved') return 'success'
  if (g.status === 'pending') return 'info'
  if (g.status === 'rejected') return 'error'
  if (g.status === 'consumed') return 'neutral'
  return 'neutral'
}

export default function SecurityBreakGlassPage() {
  const { apiFetch, role } = useAdminAuth()
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [newKey, setNewKey] = useState('')
  const [newJust, setNewJust] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const [ttlById, setTtlById] = useState<Record<string, string>>({})
  const [rejectById, setRejectById] = useState<Record<string, string>>({})
  const [consumeNoteById, setConsumeNoteById] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/security/break-glass/grants')
      if (!res.ok) {
        const err = await readApiError(res)
        setError(err?.message || 'Failed to load grants')
        setGrants([])
        return
      }
      const j = (await res.json()) as { grants?: Grant[] }
      setGrants(j.grants ?? [])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (role === 'superadmin') void load()
  }, [load, role])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (role !== 'superadmin') return
    setCreateBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/v1/admin/security/break-glass/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource_key: newKey.trim(),
          justification: newJust.trim(),
        }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        setError(err?.message || 'Create failed')
        return
      }
      setNewKey('')
      setNewJust('')
      await load()
    } finally {
      setCreateBusy(false)
    }
  }

  const approve = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      const raw = ttlById[id]?.trim()
      const ttlMinutes = raw ? parseInt(raw, 10) : 0
      const res = await apiFetch(`/v1/admin/security/break-glass/grants/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_minutes: Number.isFinite(ttlMinutes) ? ttlMinutes : 0 }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        setError(err?.message || 'Approve failed')
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (id: string) => {
    const reason = (rejectById[id] || '').trim()
    if (reason.length < 3) {
      setError('Rejection reason must be at least 3 characters.')
      return
    }
    setBusyId(id)
    setError(null)
    try {
      const res = await apiFetch(`/v1/admin/security/break-glass/grants/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        setError(err?.message || 'Reject failed')
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const consume = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      const note = (consumeNoteById[id] || '').trim()
      const res = await apiFetch(`/v1/admin/security/break-glass/grants/${encodeURIComponent(id)}/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        setError(err?.message || 'Consume failed')
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (role !== 'superadmin') {
    return (
      <>
        <PageMeta
          title="Break-glass · Admin"
          description="Dual-control emergency access grants require a superadmin session."
        />
        <PageBreadcrumb
          pageTitle="Break-glass"
          subtitle="Limited to superadmin accounts."
        />
        <div className="content">
          <div className="alert alert-warning mb-0">
            Break-glass grants are limited to <strong>superadmin</strong> accounts. Use a superadmin session to open or
            approve grants.
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageMeta
        title="Break-glass grants · Admin"
        description="Request, approve, and close time-boxed break-glass access with dual superadmin control."
      />
      <PageBreadcrumb
        pageTitle="Break-glass grants"
        subtitle="Request access, second superadmin approves, then consume when complete."
      />
      <div className="content">
        <p className="text-body-secondary small">
          Dual-control: one superadmin requests, a <em>different</em> superadmin approves. Grants expire per TTL; close
          with consume when work is done.
        </p>
        {error ? <div className="alert alert-danger py-2 small">{error}</div> : null}

        <div className="card card-primary card-outline mb-3">
          <div className="card-header">
            <h3 className="card-title">New grant request</h3>
          </div>
          <div className="card-body">
            <form onSubmit={onCreate} className="row g-2 align-items-end">
              <div className="col-12 col-md-4">
                <label className="form-label small mb-0">Resource key</label>
                <input
                  className="form-control form-control-sm"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="e.g. cloud:aws:break-glass-console"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="col-12 col-md-5">
                <label className="form-label small mb-0">Justification (≥10 chars)</label>
                <input
                  className="form-control form-control-sm"
                  value={newJust}
                  onChange={(e) => setNewJust(e.target.value)}
                  placeholder="Why access is needed"
                  required
                  minLength={10}
                  autoComplete="off"
                />
              </div>
              <div className="col-12 col-md-3">
                <button type="submit" className="btn btn-primary btn-sm" disabled={createBusy}>
                  {createBusy ? 'Submitting…' : 'Request grant'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent grants (90 days)</h3>
            <div className="card-tools">
              <button type="button" className="btn btn-tool btn-sm" onClick={() => void load()} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>
          <div className="card-body table-responsive p-0">
            <table className="table table-hover table-sm mb-0">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Resource</th>
                  <th>Requested</th>
                  <th>Expires</th>
                  <th className="d-none d-md-table-cell">Justification</th>
                  <th style={{ minWidth: 220 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-secondary small py-4 text-center">
                      Loading…
                    </td>
                  </tr>
                ) : !grants?.length ? (
                  <tr>
                    <td colSpan={6} className="text-secondary small py-4 text-center">
                      No grants yet.
                    </td>
                  </tr>
                ) : (
                  grants.map((g) => {
                    const disabled = busyId === g.id
                    const showApproveReject = g.status === 'pending'
                    const showConsume = g.status === 'approved' && !g.is_expired && !g.consumed_at
                    return (
                      <tr key={g.id}>
                        <td>
                          <StatusBadge
                            variant={statusVariant(g)}
                            label={`${g.status}${g.is_expired ? ' (expired)' : ''}`}
                          />
                        </td>
                        <td className="small text-break">{g.resource_key}</td>
                        <td className="small text-nowrap">{g.requested_at?.replace('T', ' ').slice(0, 19)}Z</td>
                        <td className="small text-nowrap">{g.expires_at ? g.expires_at.replace('T', ' ').slice(0, 19) : '—'}</td>
                        <td className="small d-none d-md-table-cell text-break">{g.justification}</td>
                        <td className="small">
                          {showApproveReject ? (
                            <div className="d-flex flex-column gap-1">
                              <div className="input-group input-group-sm">
                                <span className="input-group-text">TTL min</span>
                                <input
                                  type="number"
                                  min={5}
                                  max={1440}
                                  className="form-control"
                                  placeholder="240"
                                  value={ttlById[g.id] ?? ''}
                                  onChange={(e) => setTtlById((m) => ({ ...m, [g.id]: e.target.value }))}
                                  disabled={disabled}
                                />
                                <button
                                  type="button"
                                  className="btn btn-outline-success"
                                  disabled={disabled}
                                  onClick={() => void approve(g.id)}
                                >
                                  Approve
                                </button>
                              </div>
                              <div className="input-group input-group-sm">
                                <input
                                  type="text"
                                  className="form-control"
                                  placeholder="Reject reason"
                                  value={rejectById[g.id] ?? ''}
                                  onChange={(e) => setRejectById((m) => ({ ...m, [g.id]: e.target.value }))}
                                  disabled={disabled}
                                />
                                <button
                                  type="button"
                                  className="btn btn-outline-danger"
                                  disabled={disabled}
                                  onClick={() => void reject(g.id)}
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {showConsume ? (
                            <div className="input-group input-group-sm mt-1">
                              <input
                                type="text"
                                className="form-control"
                                placeholder="Optional note"
                                value={consumeNoteById[g.id] ?? ''}
                                onChange={(e) => setConsumeNoteById((m) => ({ ...m, [g.id]: e.target.value }))}
                                disabled={disabled}
                              />
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={disabled}
                                onClick={() => void consume(g.id)}
                              >
                                Consume
                              </button>
                            </div>
                          ) : null}
                          {!showApproveReject && !showConsume ? (
                            <span className="text-body-secondary">—</span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
