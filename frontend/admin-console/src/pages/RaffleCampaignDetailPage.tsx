import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiErrFromBody, formatApiError, readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'
import { formatCurrency } from '../lib/format'

type PrizeRow = {
  id: string
  rank_order: number
  prize_type: string
  amount_minor: number
  currency: string
  winner_slots: number
  auto_payout: boolean
  requires_approval: boolean
}

function fmtWhen(v: unknown): string {
  if (v == null || v === '') return '—'
  const d = new Date(String(v))
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

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  if (value == null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text === '{}' || text === 'null' || text === '') return null
  return (
    <div className="mb-3">
      <div className="text-secondary small mb-1">{label}</div>
      <pre className="small bg-body-secondary border rounded p-2 mb-0 overflow-auto" style={{ maxHeight: 220 }}>
        {text}
      </pre>
    </div>
  )
}

export default function RaffleCampaignDetailPage() {
  const { id: rawId } = useParams()
  const id = rawId ? decodeURIComponent(rawId) : ''
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null)
  const [prizes, setPrizes] = useState<PrizeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [drawId, setDrawId] = useState('')
  const [drawIdManual, setDrawIdManual] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const title = useMemo(() => (typeof campaign?.title === 'string' ? campaign.title : 'Campaign'), [campaign])
  const status = typeof campaign?.status === 'string' ? campaign.status : ''
  const canFullEdit = status === 'draft' || status === 'scheduled'

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch(`/v1/admin/raffles/${encodeURIComponent(id)}`)
      const j = (await res.json()) as { campaign?: Record<string, unknown>; prizes?: PrizeRow[] }
      if (!res.ok) {
        setErr(formatApiError(await readApiError(res), `Load failed (${res.status})`))
        setCampaign(null)
        setPrizes([])
        return
      }
      setCampaign(j.campaign ?? null)
      setPrizes(Array.isArray(j.prizes) ? j.prizes : [])
    } catch {
      setErr('Network error')
      setCampaign(null)
      setPrizes([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (err) toast.error(err)
  }, [err])

  const effectiveDrawId = drawIdManual.trim() || drawId.trim()

  const postAction = async (path: string, body?: Record<string, string>) => {
    if (!id) return
    setBusy(path)
    try {
      const res = await apiFetch(`/v1/admin/raffles/${encodeURIComponent(id)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let j: Record<string, unknown> | null = null
      try {
        j = (await res.json()) as Record<string, unknown>
      } catch {
        j = null
      }
      if (!res.ok) {
        toast.error(formatApiError(apiErrFromBody(j, res.status), `Request failed (${res.status})`))
        return
      }
      if (path === '/lock-draw' && j && typeof j.draw_id === 'string') {
        setDrawId(j.draw_id)
        toast.success(`Draw locked — ID copied below.`)
      } else if (path === '/run-draw') {
        toast.success('Draw executed.')
      } else if (path === '/publish-winners') {
        toast.success('Winners published.')
      } else if (path === '/payout-winners') {
        const paid = j && typeof j.paid === 'number' ? j.paid : 0
        toast.success(`Payout complete (${paid} winner(s)).`)
      } else {
        toast.success('Done.')
      }
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(null)
    }
  }

  const onLockDraw = () => void postAction('/lock-draw')
  const onRunDraw = () => {
    if (!effectiveDrawId) {
      toast.error('Lock a draw first or paste a draw ID.')
      return
    }
    void postAction('/run-draw', { draw_id: effectiveDrawId })
  }
  const onPublish = () => {
    if (!effectiveDrawId) {
      toast.error('Draw ID required.')
      return
    }
    void postAction('/publish-winners', { draw_id: effectiveDrawId })
  }
  const onPayout = () => {
    if (!effectiveDrawId) {
      toast.error('Draw ID required.')
      return
    }
    void postAction('/payout-winners', { draw_id: effectiveDrawId })
  }

  if (!id) {
    return <p className="text-secondary small">Missing campaign id.</p>
  }

  return (
    <>
      <PageMeta title={`Raffles · ${title}`} description="Raffle campaign detail and draw tools." />

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <Link to="/raffles" className="btn btn-outline-secondary btn-sm">
          ← Campaigns
        </Link>
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
        {isSuper && id ? (
          <Link to={`/raffles/${encodeURIComponent(id)}/edit`} className="btn btn-sm btn-primary">
            {canFullEdit ? 'Edit schedule & configuration' : 'Edit player-facing copy'}
          </Link>
        ) : null}
      </div>

      {loading ? (
        <p className="text-secondary small">Loading…</p>
      ) : !campaign ? (
        <p className="text-secondary small mb-0">Campaign not found.</p>
      ) : (
        <>
          <ComponentCard
            title={title}
            desc={`Slug: ${String(campaign.slug ?? '—')} · Visibility: ${String(campaign.visibility ?? '—')}`}
            headerActions={
              status ? <span className={`badge rounded-pill ${statusBadgeClass(status)}`}>{status}</span> : null
            }
          >
            <div className="row g-3">
              <div className="col-md-6">
                <dl className="row small mb-0">
                  <dt className="col-sm-4 text-secondary">Start</dt>
                  <dd className="col-sm-8 mb-2">{fmtWhen(campaign.start_at)}</dd>
                  <dt className="col-sm-4 text-secondary">End</dt>
                  <dd className="col-sm-8 mb-2">{fmtWhen(campaign.end_at)}</dd>
                  <dt className="col-sm-4 text-secondary">Draw</dt>
                  <dd className="col-sm-8 mb-2">{fmtWhen(campaign.draw_at)}</dd>
                  <dt className="col-sm-4 text-secondary">Completed</dt>
                  <dd className="col-sm-8 mb-2">{fmtWhen(campaign.completed_at)}</dd>
                </dl>
              </div>
              <div className="col-md-6">
                <dl className="row small mb-0">
                  <dt className="col-sm-5 text-secondary">Max tickets / user</dt>
                  <dd className="col-sm-7 mb-2">{campaign.max_tickets_per_user != null ? String(campaign.max_tickets_per_user) : '—'}</dd>
                  <dt className="col-sm-5 text-secondary">Max tickets (global)</dt>
                  <dd className="col-sm-7 mb-2">{campaign.max_tickets_global != null ? String(campaign.max_tickets_global) : '—'}</dd>
                  <dt className="col-sm-5 text-secondary">Max wins / user</dt>
                  <dd className="col-sm-7 mb-2">{campaign.max_wins_per_user != null ? String(campaign.max_wins_per_user) : '—'}</dd>
                  <dt className="col-sm-5 text-secondary">Purchase enabled</dt>
                  <dd className="col-sm-7 mb-2">{String(Boolean(campaign.purchase_enabled))}</dd>
                </dl>
              </div>
            </div>

            {typeof campaign.description === 'string' && campaign.description.trim() ? (
              <p className="small text-body-secondary mt-3 mb-0">{campaign.description}</p>
            ) : null}

            <JsonBlock value={campaign.eligible_products} label="Eligible products" />
            <JsonBlock value={campaign.eligible_currencies} label="Eligible currencies" />
            <JsonBlock value={campaign.ticket_rate_config} label="Ticket rate config" />
            <JsonBlock value={campaign.purchase_config} label="Purchase config" />
            <JsonBlock value={campaign.terms_text} label="Terms" />
            <JsonBlock value={campaign.responsible_notice} label="Responsible gambling notice" />
          </ComponentCard>

          <ComponentCard title="Prize ladder" desc="Ordered prizes for this campaign.">
            {prizes.length === 0 ? (
              <p className="text-secondary small mb-0">No prizes configured.</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-striped align-middle mb-0">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Slots</th>
                      <th>Auto payout</th>
                      <th>Approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prizes.map((p) => (
                      <tr key={p.id}>
                        <td>{p.rank_order}</td>
                        <td className="text-secondary">{p.prize_type}</td>
                        <td className="text-nowrap fw-medium">{formatCurrency(p.amount_minor, p.currency || 'USD')}</td>
                        <td>{p.winner_slots}</td>
                        <td>{p.auto_payout ? 'Yes' : 'No'}</td>
                        <td>{p.requires_approval ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ComponentCard>

          <ComponentCard
            title="Draw workflow"
            tone="warning"
            desc="Superadmin-only operations. Follow order: lock draw → run draw → publish → payout. The API enforces valid campaign state."
          >
            {!isSuper ? (
              <p className="text-secondary small mb-0">
                Sign in as <strong>superadmin</strong> to run draw actions.
              </p>
            ) : (
              <>
                <div className="row g-2 align-items-end mb-3">
                  <div className="col-md-8">
                    <label className="form-label small text-secondary mb-1">Draw ID</label>
                    <input
                      type="text"
                      className="form-control form-control-sm font-monospace"
                      placeholder={drawId ? drawId : 'Lock a draw or paste an existing draw UUID'}
                      value={drawIdManual}
                      onChange={(e) => setDrawIdManual(e.target.value)}
                      autoComplete="off"
                    />
                    {drawId && !drawIdManual ? (
                      <div className="form-text">Last locked: {drawId}</div>
                    ) : null}
                  </div>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <button type="button" className="btn btn-warning btn-sm text-dark" disabled={busy !== null} onClick={onLockDraw}>
                    {busy === '/lock-draw' ? 'Working…' : '1 · Lock draw'}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={onRunDraw}>
                    {busy === '/run-draw' ? 'Working…' : '2 · Run draw'}
                  </button>
                  <button type="button" className="btn btn-outline-primary btn-sm" disabled={busy !== null} onClick={onPublish}>
                    {busy === '/publish-winners' ? 'Working…' : '3 · Publish winners'}
                  </button>
                  <button type="button" className="btn btn-success btn-sm" disabled={busy !== null} onClick={onPayout}>
                    {busy === '/payout-winners' ? 'Working…' : '4 · Payout winners'}
                  </button>
                </div>
              </>
            )}
          </ComponentCard>
        </>
      )}
    </>
  )
}
