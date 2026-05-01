import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { DefinitionTable, OpsToolbar } from '../components/ops'
import { humanFieldLabel } from '../lib/adminFormatting'

type Rec = {
  id: string
  title: string
  reason: string
  wizard_preset?: string
  bonus_type?: string
  suggested_copy?: string
}

function formatSignalValue(v: unknown): ReactNode {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') {
    try {
      return <code className="small text-break d-inline-block">{JSON.stringify(v)}</code>
    } catch {
      return '—'
    }
  }
  return String(v)
}

function signalDefinitionRows(signals: Record<string, unknown>) {
  return Object.entries(signals).map(([k, v]) => ({
    field: humanFieldLabel(k),
    value: formatSignalValue(v),
    mono: typeof v === 'string' || typeof v === 'number',
  }))
}

export default function BonusRecommendationsPage() {
  const { apiFetch } = useAdminAuth()
  const [signals, setSignals] = useState<Record<string, unknown> | null>(null)
  const [recs, setRecs] = useState<Rec[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/recommendations')
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        setRecs([])
        setSignals(null)
        return
      }
      const j = (await res.json()) as { signals?: Record<string, unknown>; recommendations?: Rec[] }
      setSignals(j.signals ?? null)
      setRecs(Array.isArray(j.recommendations) ? j.recommendations : [])
    } catch {
      setErr('Network error')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const signalRows = useMemo(() => (signals ? signalDefinitionRows(signals) : []), [signals])

  const wizardHref = (r: Rec) => {
    const t = (r.bonus_type ?? 'deposit_match').trim() || 'deposit_match'
    const preset = (r.wizard_preset ?? '').trim()
    const q = new URLSearchParams()
    q.set('type', t)
    if (preset) q.set('preset', preset)
    return `/bonushub/wizard/new?${q.toString()}`
  }

  return (
    <>
      <PageMeta
        title="Bonus Engine · Smart suggestions"
        description="Engagement-oriented promotion ideas from recent platform signals."
      />
      <PageBreadcrumb
        pageTitle="Smart suggestions"
        subtitle="Heuristic promotion ideas from recent sign-ups and deposit volume."
      />

      <OpsToolbar
        title="Recommendations"
        subtitle="Deposit-match bonuses run on the Fystack deposit path (bonus_payment_settled worker), not on Blue Ocean game callbacks."
        actions={
          <button type="button" className="btn btn-sm btn-outline-primary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <div className="d-flex flex-wrap gap-2 mb-3">
        <Link to="/bonushub" className="btn btn-sm btn-outline-secondary">
          Promotions
        </Link>
        <Link to="/bonushub/operations?tab=simulate" className="btn btn-sm btn-outline-secondary">
          Simulate payment
        </Link>
      </div>

      {err ? (
        <div className="alert alert-danger small d-flex flex-wrap align-items-center justify-content-between gap-2">
          <span className="mb-0">{err}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      {signals && signalRows.length > 0 ? (
        <ComponentCard title="Signals (7d / snapshot)" desc="Lightweight counts for ops; extend with analytics later.">
          <DefinitionTable rows={signalRows} flush />
        </ComponentCard>
      ) : null}

      <ComponentCard title="Recommended promotions" desc="Each opens the create wizard with bonus type pre-selected.">
        {loading && recs.length === 0 ? (
          <div className="placeholder-glow">
            <span className="placeholder col-12 mb-2" />
            <span className="placeholder col-9" />
          </div>
        ) : recs.length === 0 ? (
          <p className="text-secondary small mb-0">No recommendations returned.</p>
        ) : (
          <div className="list-group list-group-flush border rounded overflow-hidden">
            {recs.map((r) => (
              <div key={r.id} className="list-group-item">
                <h3 className="h6 mb-1">{r.title}</h3>
                <p className="small text-secondary mb-2">{r.reason}</p>
                {r.suggested_copy ? <p className="small text-body-secondary mb-2">{r.suggested_copy}</p> : null}
                <div className="d-flex flex-wrap gap-2">
                  <Link to={wizardHref(r)} className="btn btn-primary btn-sm">
                    Create with wizard
                  </Link>
                  <Link to="/bonushub/operations?tab=simulate" className="btn btn-outline-secondary btn-sm">
                    Test in Simulate
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </ComponentCard>
    </>
  )
}
