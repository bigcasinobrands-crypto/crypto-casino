import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type RunRow = {
  id: string
  pipeline: string
  status: string
  window_start: string
  window_end: string
  started_at: string
  finished_at?: string
  trigger_kind: string
  stats?: unknown
  error_message?: string
}

export default function VipDeliveryRunsPage() {
  const { apiFetch } = useAdminAuth()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/delivery/runs?limit=100')
      if (!res.ok) {
        setRuns([])
        return
      }
      const j = (await res.json()) as { runs?: RunRow[] }
      setRuns(Array.isArray(j.runs) ? j.runs : [])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <PageMeta title="VIP — Delivery runs" description="Automated VIP batch delivery audit log." />
      <PageBreadcrumb pageTitle="Delivery runs" trail={[{ label: 'Engagement' }, { label: 'VIP', to: '/engagement/vip' }]} />
      <p className="text-secondary small">
        Audit log of automated VIP delivery windows (weekly / monthly / future pipelines). Populated as batch jobs run.
      </p>
      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-secondary">No runs yet. Enable schedules and workers to record batches.</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-striped table-dark">
            <thead>
              <tr>
                <th>Started</th>
                <th>Pipeline</th>
                <th>Status</th>
                <th>Window (UTC)</th>
                <th>Trigger</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="text-nowrap small">{r.started_at}</td>
                  <td>{r.pipeline}</td>
                  <td>{r.status}</td>
                  <td className="small">
                    {r.window_start} → {r.window_end}
                  </td>
                  <td className="small">{r.trigger_kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
