import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type RiskReviewRow = {
  id: number
  user_id: string
  promotion_version_id?: number
  decision: string
  rule_codes: string[]
  inputs: unknown
  created_at: string
}

function errFromParsedBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) {
      return { code: err.code, message: err.message ?? '', status }
    }
  }
  return null
}

export default function BonusHubRiskPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [riskReviews, setRiskReviews] = useState<RiskReviewRow[]>([])
  const [riskPending, setRiskPending] = useState(0)
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskErr, setRiskErr] = useState<string | null>(null)
  const [riskResolveBusy, setRiskResolveBusy] = useState<number | null>(null)

  const loadRiskQueue = useCallback(async () => {
    setRiskErr(null)
    setRiskLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/risk-queue?limit=100')
      type RiskQueueJSON = { pending_count?: number; reviews?: RiskReviewRow[] }
      let j: RiskQueueJSON | null = null
      try {
        j = (await res.json()) as RiskQueueJSON
      } catch {
        j = null
      }
      if (!res.ok) {
        const e = errFromParsedBody(res.status, j)
        setRiskErr(formatApiError(e, `Load failed (${res.status})`))
        return
      }
      setRiskPending(j?.pending_count ?? 0)
      setRiskReviews(Array.isArray(j?.reviews) ? j!.reviews! : [])
    } catch {
      setRiskErr('Network error')
    } finally {
      setRiskLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void loadRiskQueue()
  }, [loadRiskQueue])

  const resolveRiskReview = async (id: number, decision: 'allowed' | 'denied') => {
    if (!isSuper) return
    setRiskResolveBusy(id)
    setRiskErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/risk-queue/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      let j: unknown = null
      try {
        j = await res.json()
      } catch {
        j = null
      }
      if (!res.ok) {
        const e = errFromParsedBody(res.status, j)
        setRiskErr(formatApiError(e, `Resolve failed (${res.status})`))
        return
      }
      await loadRiskQueue()
    } catch {
      setRiskErr('Network error')
    } finally {
      setRiskResolveBusy(null)
    }
  }

  return (
    <>
      <PageMeta
        title="Bonus Engine · Risk queue"
        description="Manual review queue for bonus grants flagged by risk rules."
      />
      <div className="mb-4 d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <h2 className="h5 mb-1 text-body">Risk queue</h2>
          <p className="text-secondary small mb-0">
            Deposits and grants that need a human decision. Resolve items here, then follow up in{' '}
            <Link to="/bonushub" className="link-primary">
              Promotions hub
            </Link>{' '}
            or{' '}
            <Link to="/bonushub/operations" className="link-primary">
              Tools &amp; instances
            </Link>
            .
          </p>
        </div>
        <span className="badge text-bg-warning text-dark align-self-center">
          {riskPending} pending
        </span>
      </div>

      <ComponentCard
        title="Manual reviews"
        desc="Allow or deny each row. Denied grants do not credit the player."
      >
        {!isSuper ? (
          <div className="alert alert-warning small py-2 mb-3" role="status">
            Resolve actions require superadmin.
          </div>
        ) : null}
        {riskErr ? <div className="alert alert-danger small py-2 mb-3">{riskErr}</div> : null}
        {riskLoading && riskReviews.length === 0 ? (
          <p className="text-secondary small mb-0">Loading…</p>
        ) : riskReviews.length === 0 ? (
          <p className="text-secondary small mb-0">No items in manual review.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-secondary">
                <tr>
                  <th className="small">ID</th>
                  <th className="small">User</th>
                  <th className="small">Promo ver.</th>
                  <th className="small">Rules</th>
                  <th className="small">Created</th>
                  <th className="small">Actions</th>
                </tr>
              </thead>
              <tbody>
                {riskReviews.map((row) => (
                  <tr key={row.id}>
                    <td className="text-nowrap font-monospace small">{row.id}</td>
                    <td className="text-truncate font-monospace small" style={{ maxWidth: 140 }} title={row.user_id}>
                      {row.user_id}
                    </td>
                    <td className="text-nowrap font-monospace small">{row.promotion_version_id ?? '—'}</td>
                    <td className="text-truncate small" style={{ maxWidth: 280 }} title={(row.rule_codes || []).join(', ')}>
                      {(row.rule_codes || []).join(', ')}
                    </td>
                    <td className="text-nowrap text-secondary small">{row.created_at}</td>
                    <td className="text-nowrap">
                      <div className="d-flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          disabled={!isSuper || riskResolveBusy === row.id}
                          onClick={() => void resolveRiskReview(row.id, 'allowed')}
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={!isSuper || riskResolveBusy === row.id}
                          onClick={() => void resolveRiskReview(row.id, 'denied')}
                        >
                          Deny
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mt-3"
          onClick={() => void loadRiskQueue()}
          disabled={riskLoading}
        >
          {riskLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </ComponentCard>
    </>
  )
}
