import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'

type Rec = {
  id: string
  title: string
  reason: string
  wizard_preset?: string
  bonus_type?: string
  suggested_copy?: string
}

const btnPrimary =
  'inline-flex rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600'

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Smart suggestions</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Heuristic ideas from sign-ups and deposit volume. Deposit-match bonuses run on the Fystack deposit path (
            <code className="rounded bg-gray-100 px-1 text-xs dark:bg-white/10">bonus_payment_settled</code> worker job),
            not on Blue Ocean game wallet callbacks.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      {signals ? (
        <ComponentCard title="Signals (7d / snapshot)" desc="Lightweight counts for ops; extend with analytics later.">
          <ApiResultSummary data={signals} embedded />
        </ComponentCard>
      ) : null}

      <ComponentCard title="Recommended promotions" desc="Each opens the create wizard with bonus type pre-selected.">
        {loading && recs.length === 0 ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : recs.length === 0 ? (
          <p className="text-sm text-gray-500">No recommendations returned.</p>
        ) : (
          <ul className="space-y-4">
            {recs.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40"
              >
                <h3 className="font-semibold text-gray-900 dark:text-white">{r.title}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{r.reason}</p>
                {r.suggested_copy ? (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{r.suggested_copy}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to={wizardHref(r)} className={btnPrimary}>
                    Create with wizard
                  </Link>
                  <Link
                    to="/bonushub/operations?tab=simulate"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
                  >
                    Test in Simulate
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ComponentCard>
    </>
  )
}
