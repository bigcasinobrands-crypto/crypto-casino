import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type Flagged = {
  id: string
  challenge_id: string
  user_id: string
  status: string
  challenge_title: string
  risk_score?: number
  flag_reasons?: string[]
}

function errBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) return { code: err.code, message: err.message ?? '', status }
  }
  return null
}

export default function ChallengesFlaggedPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [rows, setRows] = useState<Flagged[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/challenges/flagged')
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), 'Load failed'))
        setRows([])
        return
      }
      const list = (j as { entries?: Flagged[] })?.entries
      setRows(Array.isArray(list) ? list : [])
    } catch {
      setErr('Network error')
      setRows([])
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const clearFlags = async (challengeId: string, entryId: string) => {
    if (!isSuper) return
    try {
      const res = await apiFetch(
        `/v1/admin/challenges/${encodeURIComponent(challengeId)}/entries/${encodeURIComponent(entryId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear_flags: true }),
        },
      )
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), 'Clear failed'))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    }
  }

  return (
    <>
      <PageMeta title="Challenges · Flagged" description="Entries flagged for review (max bet, risk, etc.)." />
      <div className="mb-3">
        <Link to="/engagement/challenges" className="small link-secondary">
          ← Challenges
        </Link>
      </div>
      <h2 className="h5 mb-3">Flagged entries</h2>
      {err ? <div className="alert alert-danger py-2 small">{err}</div> : null}
      <ComponentCard title="Queue">
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>Challenge</th>
                <th>User</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Reasons</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.challenge_title}</td>
                  <td className="font-monospace small">{r.user_id.slice(0, 8)}…</td>
                  <td>{r.status}</td>
                  <td>{r.risk_score != null ? r.risk_score : '—'}</td>
                  <td className="small">{r.flag_reasons?.join(', ') ?? '—'}</td>
                  <td className="text-end">
                    <Link to={`/engagement/challenges/${r.challenge_id}`} className="btn btn-sm btn-outline-primary me-1">
                      Open
                    </Link>
                    {isSuper ? (
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void clearFlags(r.challenge_id, r.id)}>
                        Clear flags
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="text-secondary small mt-2 mb-0">No flagged entries.</p> : null}
        </div>
      </ComponentCard>
    </>
  )
}
