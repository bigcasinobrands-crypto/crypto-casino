import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { formatApiError, readApiError, apiErrFromBody } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type CampaignRow = {
  id: string
  slug: string
  title: string
  status: string
  visibility: string
  start_at?: string | null
  end_at?: string | null
  draw_at?: string | null
  completed_at?: string | null
  updated_at?: string | null
}

function fmtWhen(v: string | null | undefined): string {
  if (v == null || v === '') return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'active') return 'text-bg-success'
  if (s === 'scheduled') return 'text-bg-secondary'
  if (s === 'draft') return 'text-bg-secondary'
  if (s === 'drawing') return 'text-bg-warning text-dark'
  if (s === 'completed') return 'text-bg-primary'
  return 'text-bg-secondary'
}

export default function RafflesCampaignsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [systemEnabled, setSystemEnabled] = useState<boolean | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/raffles/settings')
      const j = (await res.json()) as { system_enabled?: boolean }
      if (res.ok) setSystemEnabled(Boolean(j.system_enabled))
      else setSystemEnabled(null)
    } catch {
      setSystemEnabled(null)
    }
  }, [apiFetch])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/raffles')
      let j: { campaigns?: CampaignRow[] } | null = null
      try {
        j = (await res.json()) as { campaigns?: CampaignRow[] }
      } catch {
        j = null
      }
      if (!res.ok) {
        setErr(formatApiError(await readApiError(res), `Could not load raffles (${res.status})`))
        setRows([])
        return
      }
      setRows(Array.isArray(j?.campaigns) ? j!.campaigns! : [])
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const toggleSystem = async () => {
    if (!isSuper || systemEnabled === null) return
    setSettingsBusy(true)
    try {
      const res = await apiFetch('/v1/admin/raffles/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !systemEnabled }),
      })
      let j: { system_enabled?: boolean } | null = null
      try {
        j = (await res.json()) as { system_enabled?: boolean }
      } catch {
        j = null
      }
      if (!res.ok) {
        toast.error(formatApiError(apiErrFromBody(j, res.status), `Update failed (${res.status})`))
        return
      }
      const next = typeof j?.system_enabled === 'boolean' ? j.system_enabled : !systemEnabled
      setSystemEnabled(next)
      toast.success(next ? 'Player raffle API enabled.' : 'Player raffle API disabled.')
    } finally {
      setSettingsBusy(false)
    }
  }

  useEffect(() => {
    if (err) toast.error(err)
  }, [err])

  return (
    <>
      <PageMeta title="Raffles · Campaigns" description="Raffle campaigns and scheduling." />
      <ComponentCard
        title="Player-facing raffle"
        tone="info"
        desc="Kill-switch for /v1/raffles/* on the player app. Scheduled campaigns still need dates inside the wager window and status scheduled → active via worker."
      >
        <div className="d-flex flex-wrap align-items-center gap-3">
          <span className="small text-secondary">
            Global raffle API:{' '}
            <strong className={systemEnabled === false ? 'text-warning' : 'text-success'}>
              {systemEnabled === null ? 'unknown' : systemEnabled ? 'ON' : 'OFF'}
            </strong>
          </span>
          {isSuper ? (
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={settingsBusy || systemEnabled === null} onClick={() => void toggleSystem()}>
              {settingsBusy ? 'Updating…' : systemEnabled ? 'Disable player raffle' : 'Enable player raffle'}
            </button>
          ) : (
            <span className="small text-secondary">Superadmin only.</span>
          )}
        </div>
      </ComponentCard>
      <ComponentCard
        title="Campaigns"
        desc="Create a scheduled campaign so the player lobby shows an active raffle when the worker promotes it and the window is open."
        headerActions={
          isSuper ? (
            <Link to="/raffles/new" className="btn btn-sm btn-primary">
              New campaign
            </Link>
          ) : null
        }
      >
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading} onClick={() => void load()}>
            Refresh
          </button>
          {isSuper ? (
            <Link to="/raffles/new" className="btn btn-outline-primary btn-sm">
              Create campaign
            </Link>
          ) : null}
        </div>

        {loading ? (
          <p className="text-secondary small mb-0">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-secondary small mb-0">
            No raffle campaigns yet. {isSuper ? 'Use Create campaign to add one (superadmin).' : ''}
          </p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Ends</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="fw-medium">{r.title}</td>
                    <td>
                      <code className="small user-select-all">{r.slug}</code>
                    </td>
                    <td>
                      <span className={`badge rounded-pill ${statusBadgeClass(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="text-secondary small">{r.visibility}</td>
                    <td className="text-secondary small text-nowrap">{fmtWhen(r.end_at)}</td>
                    <td className="text-secondary small text-nowrap">{fmtWhen(r.updated_at)}</td>
                    <td className="text-end">
                      <Link className="btn btn-sm btn-outline-primary" to={`/raffles/${encodeURIComponent(r.id)}`}>
                        Open
                      </Link>
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
