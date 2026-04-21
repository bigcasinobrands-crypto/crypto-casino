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
      setStaff(Array.isArray(j.staff) ? j.staff : [])
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

  return (
    <>
      <PageMeta title="Staff users · Admin" description="Admin and support accounts" />
      <PageBreadcrumb pageTitle="Staff users" />
      {isSuper ? (
        <ComponentCard
          className="mb-6"
          title="Invite staff"
          desc="Superadmin only. Password is set once at creation; share via your secure channel."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Email
              <input
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Password
              <input
                type="password"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Role
              <select
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as (typeof ROLES)[number])}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                disabled={createBusy}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600 disabled:opacity-50"
                onClick={() => void createStaff()}
              >
                {createBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </ComponentCard>
      ) : (
        <p className="mb-6 text-sm text-amber-700 dark:text-amber-400">Superadmin only: staff creation and role changes.</p>
      )}

      <ComponentCard title="Directory" desc="GET /v1/admin/staff-users">
        {err ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Email</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Role</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Change role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-mono text-xs">{s.email}</td>
                    <td className="px-3 py-2">{s.role}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-400" title={s.created_at}>
                      {formatRelativeTime(s.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      {isSuper ? (
                        <select
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
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
        <button
          type="button"
          className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </ComponentCard>
    </>
  )
}
