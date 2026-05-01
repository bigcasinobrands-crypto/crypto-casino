import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { formatRelativeTime } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type StaffRow = {
  id: string
  email: string
  role: string
  mfa_webauthn_enforced: boolean
  created_at: string
}

const ROLES = ['admin', 'support', 'superadmin'] as const

export default function StaffUsersPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<(typeof ROLES)[number]>('admin')
  const [createBusy, setCreateBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/staff-users')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        setStaff([])
        return
      }
      const j = (await res.json()) as { staff?: StaffRow[] }
      const rows = Array.isArray(j.staff) ? j.staff : []
      setStaff(
        rows.map((r) => ({
          ...r,
          mfa_webauthn_enforced: Boolean(r.mfa_webauthn_enforced),
        })),
      )
    } catch {
      setErr('Network error')
      setStaff([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const createStaff = async () => {
    if (!isSuper) return
    const email = newEmail.trim().toLowerCase()
    if (!email || newPassword.length < 8) {
      toast.error('Email and password (min 8 chars) required')
      return
    }
    setCreateBusy(true)
    try {
      const res = await apiFetch('/v1/admin/staff-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: newPassword, role: newRole }),
      })
      if (!res.ok) {
        toast.error(`Create failed (${res.status})`)
        return
      }
      toast.success('Staff user created')
      setNewEmail('')
      setNewPassword('')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setCreateBusy(false)
    }
  }

  const patchRole = async (id: string, nextRole: string) => {
    if (!isSuper) return
    setBusyId(id)
    try {
      const res = await apiFetch(`/v1/admin/staff-users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      if (!res.ok) {
        toast.error(`Update failed (${res.status})`)
        return
      }
      toast.success('Role updated')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setBusyId(null)
    }
  }

  const patchMfaEnforced = async (id: string, enforced: boolean) => {
    if (!isSuper) return
    setBusyId(id)
    try {
      const res = await apiFetch(`/v1/admin/staff-users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_webauthn_enforced: enforced }),
      })
      if (!res.ok) {
        toast.error(`MFA update failed (${res.status})`)
        return
      }
      toast.success(enforced ? 'WebAuthn MFA required for this user' : 'WebAuthn MFA no longer enforced')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageMeta title="Staff users · Admin" description="Admin and support accounts" />
      <PageBreadcrumb
        pageTitle="Staff users"
        subtitle="Admin and support accounts that can sign in to this console."
      />
      {isSuper ? (
        <ComponentCard
          className="mb-6"
          title="Invite staff"
          desc="Superadmin only. Password is set once at creation; share via your secure channel."
        >
          <div className="row g-3 align-items-end">
            <div className="col-md-4 col-lg-3">
              <label className="form-label small mb-1">Email</label>
              <input
                className="form-control form-control-sm"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="col-md-4 col-lg-3">
              <label className="form-label small mb-1">Password</label>
              <input
                type="password"
                className="form-control form-control-sm"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="col-md-4 col-lg-3">
              <label className="form-label small mb-1">Role</label>
              <select
                className="form-select form-select-sm"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as (typeof ROLES)[number])}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4 col-lg-3">
              <button
                type="button"
                disabled={createBusy}
                className="btn btn-primary btn-sm"
                onClick={() => void createStaff()}
              >
                {createBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </ComponentCard>
      ) : (
        <div className="alert alert-warning small py-2 mb-4">Superadmin only: staff creation and role changes.</div>
      )}

      <ComponentCard title="Directory" desc="Staff accounts that can sign in to this console.">
        {err ? <div className="alert alert-danger small py-2 mb-3">{err}</div> : null}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th className="small">Email</th>
                  <th className="small">Role</th>
                  <th className="small">MFA WebAuthn</th>
                  <th className="small">Created</th>
                  <th className="small">Change role</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="font-monospace small">{s.email}</td>
                    <td className="small">{s.role}</td>
                    <td className="small">
                      {isSuper ? (
                        <div className="form-check form-switch mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            id={`mfa-${s.id}`}
                            checked={Boolean(s.mfa_webauthn_enforced)}
                            disabled={busyId === s.id}
                            onChange={(e) => void patchMfaEnforced(s.id, e.target.checked)}
                          />
                          <label className="form-check-label small" htmlFor={`mfa-${s.id}`}>
                            Enforced
                          </label>
                        </div>
                      ) : s.mfa_webauthn_enforced ? (
                        <span className="badge text-bg-info">on</span>
                      ) : (
                        <span className="text-secondary">off</span>
                      )}
                    </td>
                    <td className="text-secondary text-nowrap small" title={s.created_at}>
                      {formatRelativeTime(s.created_at)}
                    </td>
                    <td className="small">
                      {isSuper ? (
                        <select
                          className="form-select form-select-sm"
                          style={{ maxWidth: 160 }}
                          value={s.role}
                          disabled={busyId === s.id}
                          onChange={(e) => void patchRole(s.id, e.target.value)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" className="btn btn-outline-secondary btn-sm mt-3" onClick={() => void load()}>
          Refresh
        </button>
      </ComponentCard>
    </>
  )
}
