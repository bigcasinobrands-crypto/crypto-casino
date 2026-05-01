import {
  MONTH_GRID_COLS,
  MONTH_GRID_MAX_COLS,
  WEEK_GRID_MAX_COLS,
  WEEK_GRID_PAGE_SIZE,
  monthlySlotDate,
  startOfISOWeekUTC,
  type TierPvCol,
} from '../../lib/vipDeliveryPeriodMatrix'

type Promo = { name: string; latest_version_id?: number }

type Tier = { id: number; name: string; imageUrl?: string }

function TierFieldLabel({ tier }: { tier: Tier }) {
  const size = 40
  return (
    <label className="form-label small mb-1 text-secondary d-flex align-items-center gap-2">
      {tier.imageUrl ? (
        <img
          src={tier.imageUrl}
          alt={tier.name}
          className="rounded border border-secondary-subtle flex-shrink-0 bg-body-secondary"
          width={size}
          height={size}
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <span
          className="rounded border border-secondary-subtle bg-body-secondary d-inline-flex align-items-center justify-content-center flex-shrink-0 text-secondary"
          style={{ width: size, height: size }}
          aria-hidden
        >
          <i className="bi bi-person-badge" style={{ fontSize: '1.1rem' }} />
        </span>
      )}
      <span className="fw-medium text-body">{tier.name}</span>
    </label>
  )
}

type Props = {
  variant: 'weekly' | 'monthly'
  cols: TierPvCol[]
  onCellChange: (colIdx: number, tierId: number, pvId: string) => void
  anchorLocal: string
  tiers: Tier[]
  promotions: Promo[]
  disabled: boolean
  /** Per column index (same as grid column): `HH:mm` UTC delivery clock. */
  deliveryUtcHm?: string[]
  onDeliveryUtcHmChange?: (colIdx: number, hhmmUtc: string) => void
  /** Optional per-column UTC calendar date (`YYYY-MM-DD`). Empty = use grid slot for that column. */
  deliveryUtcDate?: string[]
  onDeliveryUtcDateChange?: (colIdx: number, yyyyMmDdUtc: string) => void
  /** Weekly: index of the first visible week column (0-based; navigate in steps of {@link WEEK_GRID_PAGE_SIZE}). */
  weekPageOffset?: number
  onLoadMoreWeeks?: () => void
  onLoadPreviousWeeks?: () => void
  canLoadMoreWeeks?: boolean
  canLoadPreviousWeeks?: boolean
  /** Monthly: index of the first visible month column. */
  monthPageOffset?: number
  onLoadMoreMonths?: () => void
  onLoadPreviousMonths?: () => void
  canLoadMoreMonths?: boolean
  canLoadPreviousMonths?: boolean
}

function parseAnchor(anchorLocal: string): Date | null {
  const t = anchorLocal.trim()
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtWeekRangeUTC(weekStart: Date, weekEnd: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
  const a = weekStart.toLocaleDateString('en-US', opts)
  const b = weekEnd.toLocaleDateString('en-US', opts)
  return `${a} – ${b}`
}

/** Headers: real UTC calendar weeks (Mon–Sun); anchor comes from the API-aligned grid origin. */
function weekColumnMeta(anchorLocal: string, idx: number): { title: string } {
  const parsed = parseAnchor(anchorLocal)
  let grantInstant: Date
  if (parsed) {
    grantInstant = new Date(parsed.getTime() + idx * 7 * 86400000)
  } else {
    const mondayThisWeek = startOfISOWeekUTC(new Date())
    grantInstant = new Date(mondayThisWeek.getTime() + idx * 7 * 86400000)
  }
  const weekStart = startOfISOWeekUTC(grantInstant)
  const weekEnd = new Date(weekStart.getTime() + 6 * 86400000)
  const range = fmtWeekRangeUTC(weekStart, weekEnd)
  return { title: `${range} · UTC week` }
}

function monthColumnMeta(anchorLocal: string, idx: number): { title: string } {
  const parsed = parseAnchor(anchorLocal)
  let slot: Date
  if (parsed) {
    slot = monthlySlotDate(parsed, idx)
  } else {
    const now = new Date()
    slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + idx, 1, 12, 0, 0, 0))
  }
  const monthLabel = slot.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return { title: `${monthLabel} · UTC (1st)` }
}

export default function VipDeliveryPeriodMatrix({
  variant,
  cols,
  onCellChange,
  anchorLocal,
  tiers,
  promotions,
  disabled,
  deliveryUtcHm,
  onDeliveryUtcHmChange,
  deliveryUtcDate,
  onDeliveryUtcDateChange,
  weekPageOffset,
  onLoadMoreWeeks,
  onLoadPreviousWeeks,
  canLoadMoreWeeks,
  canLoadPreviousWeeks,
  monthPageOffset,
  onLoadMoreMonths,
  onLoadPreviousMonths,
  canLoadMoreMonths,
  canLoadPreviousMonths,
}: Props) {
  const weeklyStart =
    variant === 'weekly'
      ? Math.min(
          WEEK_GRID_MAX_COLS - WEEK_GRID_PAGE_SIZE,
          Math.max(0, weekPageOffset ?? 0),
        )
      : 0
  const monthlyStart =
    variant === 'monthly'
      ? Math.min(
          MONTH_GRID_MAX_COLS - MONTH_GRID_COLS,
          Math.max(0, monthPageOffset ?? 0),
        )
      : 0
  const n = variant === 'weekly' ? WEEK_GRID_PAGE_SIZE : MONTH_GRID_COLS
  const defaultHm = variant === 'monthly' ? '12:00' : '00:00'
  const safeCols: TierPvCol[] =
    cols.length >= n ? cols : [...cols, ...Array.from({ length: n - cols.length }, (): TierPvCol => ({}))]

  if (variant === 'weekly') {
    const needLen = weeklyStart + WEEK_GRID_PAGE_SIZE
    const padded: TierPvCol[] =
      cols.length >= needLen
        ? [...cols]
        : [...cols, ...Array.from({ length: needLen - cols.length }, (): TierPvCol => ({}))]
    return (
      <div>
        <div className="row row-cols-1 g-3">
          {Array.from({ length: WEEK_GRID_PAGE_SIZE }, (_, i) => {
            const idx = weeklyStart + i
            const meta = weekColumnMeta(anchorLocal, idx)
            return (
              <div key={idx} className="col-12">
                <div className="card border-secondary-subtle shadow-sm">
                  <div className="card-header py-2 px-3 bg-body-secondary">
                    <div className="fw-semibold small">{meta.title}</div>
                    {onDeliveryUtcHmChange ? (
                      <div className="row row-cols-1 row-cols-sm-2 g-2 mt-2">
                        <div className="col">
                          <label className="form-label small mb-0 text-secondary" htmlFor={`vip-del-time-w-${idx}`}>
                            Time (UTC)
                          </label>
                          <input
                            id={`vip-del-time-w-${idx}`}
                            type="time"
                            step={60}
                            className="form-control form-control-sm mt-1 vip-native-datetime-input"
                            disabled={disabled}
                            value={deliveryUtcHm?.[idx] ?? defaultHm}
                            onChange={(e) => onDeliveryUtcHmChange(idx, e.target.value)}
                          />
                        </div>
                        {onDeliveryUtcDateChange ? (
                          <div className="col">
                            <label className="form-label small mb-0 text-secondary" htmlFor={`vip-del-date-w-${idx}`}>
                              Date override
                            </label>
                            <input
                              id={`vip-del-date-w-${idx}`}
                              type="date"
                              className="form-control form-control-sm mt-1 vip-native-datetime-input"
                              disabled={disabled}
                              value={deliveryUtcDate?.[idx] ?? ''}
                              onChange={(e) => onDeliveryUtcDateChange(idx, e.target.value)}
                              title="Optional: grant on this UTC day instead of the grid week"
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="card-body py-2 px-3 d-flex flex-column">
                    {tiers.map((t) => (
                      <div key={t.id} className="mb-2 flex-grow-0">
                        <TierFieldLabel tier={t} />
                        <select
                          className="form-select form-select-sm"
                          disabled={disabled || promotions.length === 0}
                          value={padded[idx]?.[t.id] ?? ''}
                          onChange={(e) => onCellChange(idx, t.id, e.target.value)}
                        >
                          <option value="">— none —</option>
                          {promotions.map((p) => (
                            <option key={`${idx}-${t.id}-${p.latest_version_id}`} value={String(p.latest_version_id)}>
                              {p.name} · pv {p.latest_version_id}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {((canLoadPreviousWeeks && onLoadPreviousWeeks) || (canLoadMoreWeeks && onLoadMoreWeeks)) ? (
          <div className="mt-3 d-flex justify-content-start gap-2 flex-wrap">
            {canLoadPreviousWeeks && onLoadPreviousWeeks ? (
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={disabled} onClick={onLoadPreviousWeeks}>
                Previous weeks
              </button>
            ) : null}
            {canLoadMoreWeeks && onLoadMoreWeeks ? (
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={disabled} onClick={onLoadMoreWeeks}>
                Next weeks
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const needMonthlyLen = monthlyStart + MONTH_GRID_COLS
  const monthlyPadded: TierPvCol[] =
    variant === 'monthly'
      ? cols.length >= needMonthlyLen
        ? [...cols]
        : [...cols, ...Array.from({ length: needMonthlyLen - cols.length }, (): TierPvCol => ({}))]
      : safeCols

  return (
    <div>
      <div className="row row-cols-1 g-3">
        {Array.from({ length: n }, (_, i) => {
          const idx = monthlyStart + i
          const meta = monthColumnMeta(anchorLocal, idx)
          return (
            <div key={idx} className="col-12">
              <div className="card border-secondary-subtle shadow-sm">
                <div className="card-header py-2 px-3 bg-body-secondary">
                  <div className="fw-semibold small">{meta.title}</div>
                  {onDeliveryUtcHmChange ? (
                    <div className="row row-cols-1 row-cols-sm-2 g-2 mt-2">
                      <div className="col">
                        <label className="form-label small mb-0 text-secondary" htmlFor={`vip-del-time-m-${idx}`}>
                          Time (UTC)
                        </label>
                        <input
                          id={`vip-del-time-m-${idx}`}
                          type="time"
                          step={60}
                          className="form-control form-control-sm mt-1 vip-native-datetime-input"
                          disabled={disabled}
                          value={deliveryUtcHm?.[idx] ?? defaultHm}
                          onChange={(e) => onDeliveryUtcHmChange(idx, e.target.value)}
                        />
                      </div>
                      {onDeliveryUtcDateChange ? (
                        <div className="col">
                          <label className="form-label small mb-0 text-secondary" htmlFor={`vip-del-date-m-${idx}`}>
                            Date override
                          </label>
                          <input
                            id={`vip-del-date-m-${idx}`}
                            type="date"
                            className="form-control form-control-sm mt-1 vip-native-datetime-input"
                            disabled={disabled}
                            value={deliveryUtcDate?.[idx] ?? ''}
                            onChange={(e) => onDeliveryUtcDateChange(idx, e.target.value)}
                            title="Optional: grant on this UTC day instead of the grid month slot"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="card-body py-2 px-3">
                  {tiers.map((t) => (
                    <div key={t.id} className="mb-2">
                      <TierFieldLabel tier={t} />
                      <select
                        className="form-select form-select-sm"
                        disabled={disabled || promotions.length === 0}
                        value={monthlyPadded[idx]?.[t.id] ?? ''}
                        onChange={(e) => onCellChange(idx, t.id, e.target.value)}
                      >
                        <option value="">— none —</option>
                        {promotions.map((p) => (
                          <option key={`${idx}-${t.id}-${p.latest_version_id}`} value={String(p.latest_version_id)}>
                            {p.name} · pv {p.latest_version_id}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {((canLoadPreviousMonths && onLoadPreviousMonths) || (canLoadMoreMonths && onLoadMoreMonths)) ? (
        <div className="mt-3 d-flex justify-content-start gap-2 flex-wrap">
          {canLoadPreviousMonths && onLoadPreviousMonths ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={disabled} onClick={onLoadPreviousMonths}>
              Previous months
            </button>
          ) : null}
          {canLoadMoreMonths && onLoadMoreMonths ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={disabled} onClick={onLoadMoreMonths}>
              Next months
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
