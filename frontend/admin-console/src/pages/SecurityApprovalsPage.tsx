import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { StatusBadge } from '../components/dashboard'

type ApprovalReq = {
  id: string
  requester_staff_id: string
  resource_type: string
  before_state: unknown
  after_state: unknown
  status: string
  approver_staff_id: string
  comment: string
  created_at: string
  resolved_at?: string
}

function statusVariant(status: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (status === 'approved') return 'success'
  if (status === 'pending') return 'info'
  if (status === 'rejected') return 'error'
  if (status === 'cancelled') return 'neutral'
  return 'neutral'
}

export default function SecurityApprovalsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [rows, setRows] = useState<ApprovalReq[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [resType, setResType] = useState('')
  const [beforeJson, setBeforeJson] = useState('{}')
  const [afterJson, setAfterJson] = useState('{}')
  const [createBusy, setCreateBusy] = useState(false)

  const [rejectComment, setRejectComment] = useState<Record<string, string>>({})
  const [approveComment, setApproveComment] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = statusFilter === 'all' ? '' : `?status=${encodeURIComponent(statusFilter)}`
      const res = await apiFetch(`/v1/admin/security/approvals${q}`)
      if (!res.ok) {
        const err = await readApiError(res)
        toast.error(err?.message || 'Failed to load requests')
        setRows([])
        return
      }
      const j = (await res.json()) as { requests?: ApprovalReq[] }
      setRows(j.requests ?? [])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    let beforeState: unknown
    let afterState: unknown
    try {
      beforeState = JSON.parse(beforeJson || 'null') as unknown
    } catch {
      toast.error('Before state must be valid JSON')
      return
    }
    try {
      afterState = JSON.parse(afterJson || 'null') as unknown
    } catch {
      toast.error('After state must be valid JSON')
      return
    }
    setCreateBusy(true)
    try {
      const res = await apiFetch('/v1/admin/security/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource_type: resType.trim(),
          before_state: beforeState,
          after_state: afterState,
        }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        toast.error(err?.message || 'Create failed')
        return
      }
      toast.success('Approval request created')
      setResType('')
      setBeforeJson('{}')
      setAfterJson('{}')
      await load()
    } finally {
      setCreateBusy(false)
    }
  }

  const approve = async (id: string) => {
    setBusyId(id)
    try {
      const res = await apiFetch(`/v1/admin/security/approvals/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: approveComment[id]?.trim() ?? '' }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        toast.error(err?.message || 'Approve failed')
        return
      }
      toast.success('Approved')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (id: string) => {
    const c = (rejectComment[id] || '').trim()
    if (c.length < 3) {
      toast.error('Rejection comment must be at least 3 characters')
      return
    }
    setBusyId(id)
    try {
      const res = await apiFetch(`/v1/admin/security/approvals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: c }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        toast.error(err?.message || 'Reject failed')
        return
      }
      toast.success('Rejected')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageMeta
        title="4-eyes approvals · Admin"
        description="Dual-control change requests: a different superadmin must approve before execution."
      />
      <PageBreadcrumb
        pageTitle="4-eyes approvals"
        subtitle="Pending changes with before/after payload. Superadmins approve or reject; you cannot approve your own request."
      />

      <div className="content">
        <div className="card card-outline card-secondary mb-3">
          <div className="card-header d-flex flex-wrap align-items-center gap-2">
            <h3 className="card-title mb-0">Filter</h3>
            <select
              className="form-select form-select-sm"
              style={{ maxWidth: 200 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>

        <div className="card card-primary card-outline mb-3">
          <div className="card-header">
            <h3 className="card-title">New request</h3>
          </div>
          <div className="card-body">
            <form onSubmit={onCreate} className="row g-2">
              <div className="col-12 col-md-4">
                <label className="form-label small mb-0">Resource type</label>
                <input
                  className="form-control form-control-sm"
                  value={resType}
                  onChange={(e) => setResType(e.target.value)}
                  placeholder="e.g. integration_binding, payout_limit"
                  required
                  minLength={2}
                />
              </div>
              <div className="col-12 col-md-4">
                <label className="form-label small mb-0">Before (JSON)</label>
                <textarea
                  className="form-control form-control-sm font-monospace"
                  rows={4}
                  value={beforeJson}
                  onChange={(e) => setBeforeJson(e.target.value)}
                />
              </div>
              <div className="col-12 col-md-4">
                <label className="form-label small mb-0">After (JSON)</label>
                <textarea
                  className="form-control form-control-sm font-monospace"
                  rows={4}
                  value={afterJson}
                  onChange={(e) => setAfterJson(e.target.value)}
                />
              </div>
              <div className="col-12">
                <button type="submit" className="btn btn-primary btn-sm" disabled={createBusy}>
                  {createBusy ? 'Submitting…' : 'Submit for approval'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Inbox (180 days)</h3>
          </div>
          <div className="card-body table-responsive p-0">
            <table className="table table-hover table-sm mb-0">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Resource</th>
                  <th>Requester</th>
                  <th>Created</th>
                  <th className="d-none d-lg-table-cell">Diff</th>
                  <th style={{ minWidth: 240 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-secondary small py-4 text-center">
                      Loading…
                    </td>
                  </tr>
                ) : !rows?.length ? (
                  <tr>
                    <td colSpan={6} className="text-secondary small py-4 text-center">
                      No requests.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const disabled = busyId === row.id
                    const showActions = row.status === 'pending' && isSuper
                    const diff = JSON.stringify(
                      { before: row.before_state, after: row.after_state },
                      null,
                      2,
                    )
                    return (
                      <tr key={row.id}>
                        <td>
                          <StatusBadge variant={statusVariant(row.status)} label={row.status} />
                        </td>
                        <td className="small text-break">{row.resource_type}</td>
                        <td className="small font-monospace">{row.requester_staff_id.slice(0, 8)}…</td>
                        <td className="small text-nowrap">{row.created_at?.replace('T', ' ').slice(0, 19)}</td>
                        <td className="small d-none d-lg-table-cell">
                          <pre className="mb-0 small text-wrap" style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>
                            {diff.length > 400 ? `${diff.slice(0, 400)}…` : diff}
                          </pre>
                        </td>
                        <td className="small">
                          {showActions ? (
                            <div className="d-flex flex-column gap-1">
                              <div className="input-group input-group-sm">
                                <input
                                  type="text"
                                  className="form-control"
                                  placeholder="Approve note (optional)"
                                  value={approveComment[row.id] ?? ''}
                                  onChange={(e) =>
                                    setApproveComment((m) => ({ ...m, [row.id]: e.target.value }))
                                  }
                                  disabled={disabled}
                                />
                                <button
                                  type="button"
                                  className="btn btn-outline-success"
                                  disabled={disabled}
                                  onClick={() => void approve(row.id)}
                                >
                                  Approve
                                </button>
                              </div>
                              <div className="input-group input-group-sm">
                                <input
                                  type="text"
                                  className="form-control"
                                  placeholder="Reject reason"
                                  value={rejectComment[row.id] ?? ''}
                                  onChange={(e) =>
                                    setRejectComment((m) => ({ ...m, [row.id]: e.target.value }))
                                  }
                                  disabled={disabled}
                                />
                                <button
                                  type="button"
                                  className="btn btn-outline-danger"
                                  disabled={disabled}
                                  onClick={() => void reject(row.id)}
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ) : row.status === 'pending' && !isSuper ? (
                            <span className="text-body-secondary">Awaiting superadmin</span>
                          ) : row.status !== 'pending' ? (
                            <span className="text-body-secondary">
                              {row.resolved_at?.replace('T', ' ').slice(0, 19) ?? '—'}
                            </span>
                          ) : (
                            <span className="text-body-secondary">—</span>
                          )}
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
