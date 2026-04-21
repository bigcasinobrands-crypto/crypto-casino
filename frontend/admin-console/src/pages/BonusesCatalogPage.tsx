import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type PromotionRow = {
  id: number
  name: string
  slug: string
  status: string
  created_at: string
  latest_version: number
  grants_paused?: boolean
  bonus_type?: string
}

const primaryBtn =
  'rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50'

export default function BonusesCatalogPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'archived'>('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [rows, setRows] = useState<PromotionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (debouncedQ) params.set('q', debouncedQ)
      const res = await apiFetch(`/v1/admin/bonushub/promotions?${params.toString()}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        setRows([])
        return
      }
      const j = (await res.json()) as { promotions?: PromotionRow[] }
      setRows(Array.isArray(j.promotions) ? j.promotions : [])
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, statusFilter, debouncedQ])

  useEffect(() => {
    void load()
  }, [load])

  const setArchived = async (id: number, archived: boolean) => {
    if (!isSuper) return
    setBusyId(id)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'archived' : 'draft' }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageMeta
        title="Bonus Engine · Promotions"
        description="All promotions: filter by status, search, archive or restore."
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Promotions</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Draft promotions become eligible when a version is published from{' '}
            <strong className="text-gray-700 dark:text-gray-200">Schedule &amp; deliver</strong>. Archived promotions
            are excluded from grants. Use <strong className="text-gray-700 dark:text-gray-200">Operations</strong> for
            versions, performance, risk review, and advanced tools.
          </p>
        </div>
        <Link to="/bonushub/wizard/new" className={primaryBtn}>
          Create promotion
        </Link>
      </div>

      <ComponentCard title="Catalog" desc="Filter and manage promotions. Edit rules on a draft version from each row when available.">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Status</label>
            <select
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'draft' | 'archived')}
            >
              <option value="all">All</option>
              <option value="draft">Draft (active)</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Search</label>
            <input
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              placeholder="Name or slug"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button type="button" className={primaryBtn} onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {err ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {loading && rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No promotions match. Create one to get started.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Slug</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Ver.</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Grants</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{p.id}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{p.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{p.slug}</td>
                    <td className="px-3 py-2 capitalize">{p.status}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {p.bonus_type ?? '—'}
                    </td>
                    <td className="px-3 py-2">{p.latest_version ?? '—'}</td>
                    <td className="px-3 py-2">{p.grants_paused ? 'paused' : 'on'}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        to={`/bonushub/promotions/${p.id}/delivery`}
                        className="mr-2 text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Schedule & deliver
                      </Link>
                      <Link
                        to={`/bonushub/promotions/${p.id}/rules`}
                        className="mr-2 text-sm text-gray-700 hover:underline dark:text-gray-300"
                      >
                        Edit rules
                      </Link>
                      <Link
                        to={`/bonushub/operations?tab=promotions&promo=${p.id}`}
                        className="mr-2 text-xs text-gray-500 hover:underline dark:text-gray-400"
                      >
                        Operations
                      </Link>
                      {isSuper ? (
                        p.status === 'archived' ? (
                          <button
                            type="button"
                            className="text-sm text-brand-600 hover:underline dark:text-brand-400"
                            disabled={busyId === p.id}
                            onClick={() => void setArchived(p.id, false)}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-sm text-amber-700 hover:underline dark:text-amber-400"
                            disabled={busyId === p.id}
                            onClick={() => void setArchived(p.id, true)}
                          >
                            Archive
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isSuper ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">Archive/restore requires superadmin.</p>
        ) : null}
      </ComponentCard>
    </>
  )
}
