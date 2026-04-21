import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type CalEvent = {
  promotion_version_id: number
  promotion_id: number
  name: string
  valid_from: string | null
  valid_to: string | null
  published_at: string | null
}

/** UTC calendar month bounds (inclusive) for overlap with timestamptz rows. */
function utcMonthBounds(year: number, monthIndex0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0))
  const to = new Date(Date.UTC(year, monthIndex0 + 1, 0, 23, 59, 59, 999))
  return { from: from.toISOString(), to: to.toISOString() }
}

function utcMonthAnchor(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0, 1, 12, 0, 0, 0))
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const btnSecondary =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10'

export default function BonusCalendarPage() {
  const { apiFetch } = useAdminAuth()
  const now = new Date()
  const [cursor, setCursor] = useState(() =>
    utcMonthAnchor(now.getUTCFullYear(), now.getUTCMonth()),
  )
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const y = cursor.getUTCFullYear()
  const m = cursor.getUTCMonth()
  const { from, to } = useMemo(() => utcMonthBounds(y, m), [y, m])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await apiFetch(`/v1/admin/bonushub/promotions/calendar?${params.toString()}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Calendar load failed (${res.status})`))
        setEvents([])
        return
      }
      const j = (await res.json()) as { events?: CalEvent[] }
      setEvents(Array.isArray(j.events) ? j.events : [])
    } catch {
      setErr('Network error')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const prevMonth = () => setCursor(utcMonthAnchor(y, m - 1))
  const nextMonth = () => setCursor(utcMonthAnchor(y, m + 1))

  const fmt = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  return (
    <>
      <PageMeta title="Bonus Engine · Calendar" description="Published promotions overlapping the selected UTC month." />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Calendar</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Published offers whose grant window overlaps <strong className="text-gray-700 dark:text-gray-200">UTC</strong>{' '}
            {monthNames[m]} {y}. Draft promotions are not listed — publish from{' '}
            <Link to="/bonushub" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Promotions
            </Link>{' '}
            or create one first.
          </p>
        </div>
        <Link to="/bonushub" className={btnSecondary}>
          Promotions
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button type="button" className={btnSecondary} onClick={prevMonth}>
          ← Prev
        </button>
        <span className="text-base font-semibold text-gray-900 dark:text-white">
          {monthNames[m]} {y}
        </span>
        <button type="button" className={btnSecondary} onClick={nextMonth}>
          Next →
        </button>
        <button type="button" className={btnSecondary} onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      <ComponentCard
        title="Offers this month"
        desc="Only published versions with a schedule overlapping this UTC month appear here."
      >
        {loading && events.length === 0 ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : events.length === 0 ? (
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p>No published promotions overlap this month in UTC.</p>
            <p className="text-gray-500 dark:text-gray-400">
              Drafts never appear on the calendar until you publish a version from Schedule &amp; deliver.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/bonushub/wizard/new" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                Create promotion
              </Link>
              <span className="text-gray-400">·</span>
              <Link to="/bonushub" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                Open promotions catalog
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {events.map((ev) => (
              <li key={`${ev.promotion_version_id}-${ev.promotion_id}`} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{ev.name}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Version #{ev.promotion_version_id} · Published {fmt(ev.published_at)}
                    </p>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      Window: {fmt(ev.valid_from)} → {fmt(ev.valid_to)}
                    </p>
                  </div>
                  <Link
                    to={`/bonushub/promotions/${ev.promotion_id}/delivery`}
                    className="shrink-0 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Schedule & deliver
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
