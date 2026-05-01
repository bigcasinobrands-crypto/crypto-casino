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
      <PageBreadcrumb
        pageTitle="All players"
        subtitle="Directory, funnel snapshot, and quick links to player records"
      />

      <div className="row row-cols-1 row-cols-md-2 row-cols-xl-5 g-3 mb-3">
        <div className="col">
          <StatCard
            label="Total registered"
            value={playerStats ? formatCompact(playerStats.total_registered) : '—'}
            iconClass="bi bi-people"
            variant="primary"
          />
        </div>
        <div className="col">
          <StatCard
            label="With deposit"
            value={playerStats ? formatCompact(playerStats.total_with_deposit) : '—'}
            iconClass="bi bi-wallet2"
            variant="success"
          />
        </div>
        <div className="col">
          <StatCard
            label="Active (7d)"
            value={playerStats ? formatCompact(playerStats.total_active_7d) : '—'}
            iconClass="bi bi-activity"
            variant="info"
          />
        </div>
        <div className="col">
          <StatCard
            label="Avg LTV"
            value={playerStats ? formatCurrency(playerStats.avg_ltv_minor) : '—'}
            iconClass="bi bi-currency-dollar"
            variant="secondary"
          />
        </div>
        <div className="col">
          <StatCard
            label="Deposit conversion"
            value={playerStats ? formatPct(playerStats.deposit_conversion_rate) : '—'}
            iconClass="bi bi-percent"
            variant="warning"
          />
        </div>
      </div>

      {playerStats && playerStats.top_depositors.length > 0 ? (
        <ComponentCard title="Top depositors" desc="By lifetime deposit volume (top 10)">
          <ul className="list-group list-group-flush">
            {playerStats.top_depositors.slice(0, 10).map((d, i) => (
              <li
                key={d.id}
                className="list-group-item d-flex align-items-center justify-content-between gap-2 flex-wrap"
              >
                <div className="d-flex align-items-center gap-2 min-w-0">
                  <span className="badge text-bg-primary rounded-pill">{i + 1}</span>
                  <Link to={`/support/player/${d.id}`} className="fw-medium text-truncate link-primary">
                    {d.email}
                  </Link>
                </div>
                <span className="font-monospace small text-nowrap">{formatCurrency(d.total_minor)}</span>
              </li>
            ))}
          </ul>
        </ComponentCard>
      ) : null}

      <ComponentCard title="Player directory" desc={`${players.length} loaded (max 500)`}>
        {loading ? (
          <div className="placeholder-glow py-5 text-center">
            <span className="placeholder col-6" />
          </div>
        ) : error ? (
          <div className="alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2 mb-0">
            <span>{error}</span>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : players.length === 0 ? (
          <p className="text-secondary small mb-0 py-4 text-center">No players found.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Email</th>
                  <th scope="col">ID</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id}>
                    <td className="text-nowrap">
                      <Link
                        to={`/support/player/${p.id}`}
                        className="d-flex align-items-center gap-2 text-decoration-none"
                      >
                        <span className="rounded-circle bg-body-secondary d-flex align-items-center justify-content-center overflow-hidden flex-shrink-0" style={{ width: 32, height: 32 }}>
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt="" className="w-100 h-100 object-fit-cover" />
                          ) : (
                            <span className="small text-secondary fw-bold">
                              {(p.username ?? p.email ?? '?')[0]?.toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="fw-medium text-body">{p.username ?? p.email.split('@')[0]}</span>
                      </Link>
                    </td>
                    <td className="small text-secondary text-nowrap">{p.email}</td>
                    <td className="font-monospace small">
                      <Link to={`/support/player/${p.id}`} className="link-primary">
                        {p.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="small text-secondary text-nowrap">
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
