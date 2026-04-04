import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { formatApiError, readApiError } from '../api/errors'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type Row = {
  id: string
  title: string
  provider: string
  category: string
  hidden: boolean
  bog_game_id?: number
}

export default function GamesCatalogPage() {
  const { apiFetch, role } = useAdminAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const res = await apiFetch('/v1/admin/games?limit=500')
    if (!res.ok) {
      setErr(formatApiError(await readApiError(res), `HTTP ${res.status}`))
      setRows([])
      setLoading(false)
      return
    }
    const j = (await res.json()) as { games: Row[] }
    setRows(j.games ?? [])
    setLoading(false)
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const patchHidden = async (id: string, hidden: boolean) => {
    const res = await apiFetch(`/v1/admin/games/${encodeURIComponent(id)}/hidden`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: !hidden, reason: '' }),
    })
    if (!res.ok) {
      setErr(formatApiError(await readApiError(res), 'Update failed'))
      return
    }
    void load()
  }

  const isAdmin = role === 'admin'

  return (
    <>
      <PageMeta title="Games catalog · Admin" description="Blue Ocean catalog rows" />
      <PageBreadcrumb pageTitle="Games catalog" />
      <ComponentCard title="Games" desc="GET /v1/admin/games — hide toggle requires admin role">
        {err ? (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">
            {err}{' '}
            <button type="button" className="underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">BOG id</th>
                  <th className="px-3 py-2 font-medium">Hidden</th>
                  {isAdmin ? <th className="px-3 py-2 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs">{r.title}</td>
                    <td className="px-3 py-2 text-xs">{r.provider}</td>
                    <td className="px-3 py-2 text-xs">{r.category}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.bog_game_id ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.hidden ? 'yes' : 'no'}</td>
                    {isAdmin ? (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-brand-600 underline dark:text-brand-400"
                          onClick={() => void patchHidden(r.id, r.hidden)}
                        >
                          {r.hidden ? 'Show in lobby' : 'Hide from lobby'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ComponentCard>
    </>
  )
}
