import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'
import { ChallengeCreatePanel } from '../components/challenges/ChallengeCreatePanel'
import { formatMinorToMajor } from '../lib/format'

type EntryRow = {
  id: string
  user_id: string
  status: string
  qualifying_bets: number
  total_wagered_minor: number
  risk_score?: number
  flagged_for_review: boolean
  entered_at: string
}

function errBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) return { code: err.code, message: err.message ?? '', status }
  }
  return null
}

export default function ChallengeAdminDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [challenge, setChallenge] = useState<Record<string, unknown> | null>(null)
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    try {
      const resC = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}`)
      const jc = await resC.json().catch(() => null)
      if (!resC.ok) {
        setErr(formatApiError(errBody(resC.status, jc), 'Challenge load failed'))
        setChallenge(null)
        return
      }
      setChallenge(jc as Record<string, unknown>)
      const resE = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}/entries`)
      const je = await resE.json().catch(() => null)
      if (resE.ok && je && typeof je === 'object' && Array.isArray((je as { entries?: EntryRow[] }).entries)) {
        setEntries((je as { entries: EntryRow[] }).entries)
      } else {
        setEntries([])
      }
    } catch {
      setErr('Network error')
    }
  }, [apiFetch, id])

  useEffect(() => {
    void load()
  }, [load])

  const patchChallenge = async (body: Record<string, unknown>) => {
    if (!id || !isSuper) return
    setBusy('challenge')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), 'Update failed'))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const disqualify = async (eid: string) => {
    if (!id || !isSuper) return
    setBusy(eid)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}/entries/${encodeURIComponent(eid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'disqualified' }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), 'Patch entry failed'))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const award = async (eid: string) => {
    if (!id || !isSuper) return
    setBusy(`award-${eid}`)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}/entries/${encodeURIComponent(eid)}/award`, {
        method: 'POST',
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), 'Award failed'))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  if (id === 'new' && isSuper) {
    return (
      <>
        <PageMeta title="New challenge" description="Create a draft challenge (superadmin)." />
        <div className="mb-3">
          <Link to="/engagement/challenges" className="small link-secondary">
            ← Challenges
          </Link>
        </div>
        <ComponentCard title="New challenge">
          <ChallengeCreatePanel onCreated={(newId) => navigate(`/engagement/challenges/${newId}`, { replace: true })} />
        </ComponentCard>
      </>
    )
  }

  if (!id || id === 'new') {
    return (
      <p className="text-secondary small">
        Invalid challenge. <Link to="/engagement/challenges">Back</Link>
      </p>
    )
  }

  const title = typeof challenge?.title === 'string' ? challenge.title : id
  const status = typeof challenge?.status === 'string' ? challenge.status : '—'
  const manual =
    typeof challenge?.prize_manual_review === 'boolean' ? (challenge.prize_manual_review as boolean) : false

  return (
    <>
      <PageMeta title={`Challenges · ${title}`} description="Edit challenge and review entries." />
      <div className="mb-3">
        <Link to="/engagement/challenges" className="small link-secondary">
          ← Challenges
        </Link>
      </div>
      <h2 className="h5 mb-3 text-body">{title}</h2>
      {err ? <div className="alert alert-danger py-2 small">{err}</div> : null}

      <ComponentCard title="Lifecycle & prize">
        <div className="row g-2 align-items-end">
          <div className="col-md-4">
            <label className="form-label small text-secondary mb-1">Status</label>
            <select
              className="form-select form-select-sm"
              value={status}
              disabled={!isSuper || busy === 'challenge'}
              onChange={(e) => void patchChallenge({ status: e.target.value })}
            >
              {['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-8 form-check mt-4">
            <input
              id="manualReview"
              type="checkbox"
              className="form-check-input"
              checked={manual}
              disabled={!isSuper || busy === 'challenge'}
              onChange={(e) => void patchChallenge({ prize_manual_review: e.target.checked })}
            />
            <label htmlFor="manualReview" className="form-check-label small">
              Prize requires manual review (blocks auto wallet credit until staff awards)
            </label>
          </div>
        </div>
        <dl className="row small mt-3 mb-0">
          <dt className="col-sm-3 text-secondary">Type</dt>
          <dd className="col-sm-9">{String(challenge?.challenge_type ?? '—')}</dd>
          <dt className="col-sm-3 text-secondary">Prize</dt>
          <dd className="col-sm-9">
            {String(challenge?.prize_type ?? '—')}{' '}
            {typeof challenge?.prize_amount_minor === 'number'
              ? `· ${formatMinorToMajor(challenge.prize_amount_minor as number)}`
              : ''}
          </dd>
          <dt className="col-sm-3 text-secondary">Target multiplier</dt>
          <dd className="col-sm-9">{String(challenge?.target_multiplier ?? '—')}</dd>
        </dl>
      </ComponentCard>

      <ComponentCard title="Entries">
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Wagered</th>
                <th>Risk</th>
                <th>Flagged</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="font-monospace small">{e.user_id.slice(0, 8)}…</td>
                  <td>{e.status}</td>
                  <td>{formatMinorToMajor(e.total_wagered_minor)}</td>
                  <td>{e.risk_score != null ? Number(e.risk_score).toFixed(1) : '—'}</td>
                  <td>{e.flagged_for_review ? 'yes' : '—'}</td>
                  <td className="text-end">
                    {isSuper ? (
                      <div className="btn-group btn-group-sm">
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          disabled={busy !== null}
                          onClick={() => void disqualify(e.id)}
                        >
                          DQ
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-success"
                          disabled={busy !== null}
                          onClick={() => void award(e.id)}
                        >
                          Award
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 ? <p className="text-secondary small mt-2 mb-0">No entries yet.</p> : null}
        </div>
      </ComponentCard>
    </>
  )
}
