import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import { formatApiError, readApiError } from '../api/errors'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import { StatCard } from '../components/dashboard'
import { usePlayerStats } from '../hooks/useDashboard'
import { formatCurrency, formatCompact, formatPct } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type Player = {
  id: string
  email: string
  created_at: string
  username?: string
  avatar_url?: string
}

export default function PlayersPage() {
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure } = useAdminActivityLog()
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await apiFetch('/v1/admin/users?limit=500')
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path: '/v1/admin/users' })
      setError(formatApiError(parsed, `Request failed (${res.status})`))
      setPlayers([])
      setLoading(false)
      return
    }
    const j = (await res.json()) as { users: Player[] }
    setPlayers(j.users ?? [])
    setLoading(false)
  }, [apiFetch, reportApiFailure])

  useEffect(() => {
    void load()
  }, [load])

  const { data: playerStats } = usePlayerStats()

  return (
    <>
      <PageMeta title="Players · Admin" description="All registered players" />
      <PageBreadcrumb pageTitle="Players" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Total Registered"
          value={playerStats ? formatCompact(playerStats.total_registered) : '—'}
        />
        <StatCard
          label="Total Depositors"
          value={playerStats ? formatCompact(playerStats.total_with_deposit) : '—'}
        />
        <StatCard
          label="Active (7d)"
          value={playerStats ? formatCompact(playerStats.total_active_7d) : '—'}
        />
        <StatCard
          label="Avg LTV"
          value={playerStats ? formatCurrency(playerStats.avg_ltv_minor) : '—'}
        />
        <StatCard
          label="Deposit Conversion"
          value={playerStats ? formatPct(playerStats.deposit_conversion_rate) : '—'}
        />
      </div>

      {playerStats && playerStats.top_depositors.length > 0 && (
        <ComponentCard title="Top Depositors" desc="Top 10 by total deposit volume">
          <ol className="divide-y divide-gray-100 dark:divide-gray-800">
            {playerStats.top_depositors.slice(0, 10).map((d, i) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                  {i + 1}
                </span>
                <Link
                  to={`/support/player/${d.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                >
                  {d.email}
                </Link>
                <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {formatCurrency(d.total)}
                </span>
              </li>
            ))}
          </ol>
        </ComponentCard>
      )}

      <ComponentCard title="Players" desc={`${players.length} registered`}>
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-3 font-medium text-brand-600 underline hover:text-brand-700 dark:text-brand-400"
            >
              Retry
            </button>
          </div>
        ) : players.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No players found.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">Player</th>
                  <th className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">Email</th>
                  <th className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">ID</th>
                  <th className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-white/[0.02]">
                {players.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        to={`/support/player/${p.id}`}
                        className="flex items-center gap-3 hover:opacity-80"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          {p.avatar_url ? (
                            <img
                              src={p.avatar_url}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <span className="text-xs font-bold text-gray-400 dark:text-gray-500">
                              {(p.username ?? p.email ?? '?')[0]?.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {p.username ?? p.email.split('@')[0]}
                        </span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">
                      {p.email}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                      <Link
                        to={`/support/player/${p.id}`}
                        className="text-brand-600 underline dark:text-brand-400"
                      >
                        {p.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(p.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
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
