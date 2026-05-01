import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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

const UTC_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function buildUtcMonthGridCells(year: number, monthIndex0: number): ({ kind: 'pad' } | { kind: 'day'; day: number })[] {
  const firstDow = new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
  const cells: ({ kind: 'pad' } | { kind: 'day'; day: number })[] = []
  for (let i = 0; i < firstDow; i++) cells.push({ kind: 'pad' })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ kind: 'day', day: d })
  while (cells.length % 7 !== 0) cells.push({ kind: 'pad' })
  return cells
}

function chunk7<T>(items: T[]): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += 7) rows.push(items.slice(i, i + 7))
  return rows
}

/** Whether the promotion grant window overlaps this UTC calendar day. */
function calendarEventsForUtcDay(events: CalEvent[], y: number, m: number, day: number): CalEvent[] {
  const dayStart = Date.UTC(y, m, day)
  const dayEnd = Date.UTC(y, m, day, 23, 59, 59, 999)
  return events.filter((ev) => {
    const ws =
      ev.valid_from != null && String(ev.valid_from).trim() !== ''
        ? new Date(ev.valid_from).getTime()
        : Number.NEGATIVE_INFINITY
    const we =
      ev.valid_to != null && String(ev.valid_to).trim() !== ''
        ? new Date(ev.valid_to).getTime()
        : Number.POSITIVE_INFINITY
    return ws <= dayEnd && we >= dayStart
  })
}

export default function BonusCalendarPage() {
  const { apiFetch } = useAdminAuth()
  const [searchParams] = useSearchParams()
  const promoFilterRaw = searchParams.get('promo')
  const promoFilter = promoFilterRaw ? parseInt(promoFilterRaw, 10) : NaN
  const promoFilterId = Number.isFinite(promoFilter) && promoFilter > 0 ? promoFilter : null

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

  const visibleEvents = useMemo(() => {
    if (promoFilterId == null) return events
    return events.filter((ev) => ev.promotion_id === promoFilterId)
  }, [events, promoFilterId])

  const gridCells = useMemo(() => buildUtcMonthGridCells(y, m), [y, m])
  const gridRows = useMemo(() => chunk7(gridCells), [gridCells])

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

  const today = new Date()
  const isUtcToday = (day: number) =>
    y === today.getUTCFullYear() && m === today.getUTCMonth() && day === today.getUTCDate()

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
        <div className="d-flex flex-wrap gap-2">
          {promoFilterId != null ? (
            <Link to={`/bonushub/promotions/${promoFilterId}`} className="btn btn-sm btn-outline-secondary">
              Promotion hub
            </Link>
          ) : null}
          <Link to="/bonushub" className="btn btn-sm btn-outline-primary">
            Promotions
          </Link>
        </div>
      </div>

      {promoFilterId != null ? (
        <div className="alert alert-secondary small py-2 mb-3" role="status">
          Showing calendar rows for <strong>promotion #{promoFilterId}</strong> only.{' '}
          <Link to="/bonushub/calendar" className="alert-link">
            Clear filter
          </Link>
        </div>
      ) : null}

      <div className="mb-4 d-flex flex-wrap align-items-center gap-2">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={prevMonth}>
          ← Prev
        </button>
        <span className="fw-semibold text-body px-1">
          {monthNames[m]} {y}
        </span>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={nextMonth}>
          Next →
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      <ComponentCard
        title="Month view (UTC)"
        desc="Each cell is one UTC day. Chips are published offers whose grant window overlaps that day. Drafts never appear until you publish from Schedule & deliver."
      >
        {loading && events.length === 0 ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : visibleEvents.length === 0 ? (
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p>
              {promoFilterId != null
                ? `No published windows for promotion #${promoFilterId} overlap this UTC month (or the offer is still a draft).`
                : 'No published promotions overlap this month in UTC.'}
            </p>
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
          <div className="table-responsive rounded border">
            <table className="table table-bordered table-sm mb-0">
              <thead className="table-light">
                <tr>
                  {UTC_WEEKDAYS.map((w) => (
                    <th key={w} scope="col" className="text-center small text-secondary py-2">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => {
                      if (cell.kind === 'pad') {
                        return (
                          <td key={`pad-${ri}-${ci}`} className="bg-body-secondary p-0" style={{ height: '6.5rem' }} />
                        )
                      }
                      const day = cell.day
                      const dayEvents = calendarEventsForUtcDay(visibleEvents, y, m, day)
                      const todayCell = isUtcToday(day)
                      return (
                        <td
                          key={day}
                          className={`align-top p-1 small ${todayCell ? 'bg-primary-subtle' : ''}`}
                          style={{ height: '6.5rem', width: '14.28%', verticalAlign: 'top' }}
                        >
                          <div className="d-flex justify-content-between align-items-start mb-1">
                            <span className={`fw-semibold ${todayCell ? 'text-primary' : 'text-body'}`}>{day}</span>
                          </div>
                          <div className="d-flex flex-column gap-1">
                            {dayEvents.slice(0, 4).map((ev) => (
                              <Link
                                key={`${day}-${ev.promotion_version_id}`}
                                to={`/bonushub/promotions/${ev.promotion_id}/delivery`}
                                className="text-truncate d-block rounded px-1 py-0 text-decoration-none border border-secondary-subtle bg-body-secondary text-body"
                                style={{ fontSize: '0.68rem', lineHeight: 1.25 }}
                                title={`${ev.name} · v${ev.promotion_version_id} · ${fmt(ev.valid_from)} → ${fmt(ev.valid_to)}`}
                              >
                                {ev.name}
                              </Link>
                            ))}
                            {dayEvents.length > 4 ? (
                              <span className="text-muted" style={{ fontSize: '0.65rem' }}>
                                +{dayEvents.length - 4} more
                              </span>
                            ) : null}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ComponentCard>

      {visibleEvents.length > 0 ? (
        <ComponentCard title="All windows this month" desc="Same data as the grid: full valid_from / valid_to for each offer.">
          <ul className="list-group list-group-flush">
            {visibleEvents.map((ev) => (
              <li
                key={`${ev.promotion_version_id}-${ev.promotion_id}`}
                className="list-group-item calendar-offer-row px-0 py-3 border-secondary"
              >
                <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                  <div className="min-w-0">
                    <p className="fw-medium text-body mb-1">{ev.name}</p>
                    <p className="mb-1 small text-secondary">
                      Version #{ev.promotion_version_id} · Published {fmt(ev.published_at)}
                    </p>
                    <p className="mb-0 small text-body-secondary">
                      Window: {fmt(ev.valid_from)} → {fmt(ev.valid_to)}
                    </p>
                  </div>
                  <Link
                    to={`/bonushub/promotions/${ev.promotion_id}/delivery`}
                    className="btn btn-sm btn-link text-nowrap shrink-0"
                  >
                    Schedule & deliver
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </ComponentCard>
      ) : null}
    </>
  )
}
