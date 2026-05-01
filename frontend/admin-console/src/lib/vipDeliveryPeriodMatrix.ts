/**
 * Maps VIP delivery UI grids ↔ persisted `tier_promotion_versions` + `planned_runs`.
 * Weekly: column k = first grant + k×7 days. Monthly: column k = k-th monthly slot (matches worker month advance).
 */

export type TierPvCol = Record<number, string>

export type PlannedRunPersist = {
  run_at: string
  tier_promotion_versions: Record<string, { promotion_version_id: number }>
}

function normalizeScheduledInstantIso(runAtRaw: string): string | null {
  const d = new Date(runAtRaw.trim())
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function uniquePromotionVersionsFrom(run: PlannedRunPersist['tier_promotion_versions']): Set<number> {
  const s = new Set<number>()
  for (const row of Object.values(run ?? {})) {
    const pv = row?.promotion_version_id
    if (typeof pv === 'number' && Number.isFinite(pv) && pv > 0) s.add(pv)
  }
  return s
}

/**
 * Ensures each promotion_version_id appears at most once per UTC delivery instant across
 * `planned_runs` and optional column‑0 deliveries at {@link nextRunIso}.
 */
export function duplicatePromotionAtSameInstantMessage(
  planned: PlannedRunPersist[],
  col0TierPv: Record<number, string>,
  nextRunIso?: string | null,
): string | null {
  const delim = '\u0001'
  const counts = new Map<string, number>()

  function bump(isoNorm: string, pv: number): void {
    const key = isoNorm + delim + String(pv)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  for (const pr of planned) {
    const iso = normalizeScheduledInstantIso(pr.run_at)
    if (!iso) continue
    for (const pv of uniquePromotionVersionsFrom(pr.tier_promotion_versions)) {
      bump(iso, pv)
    }
  }

  if (nextRunIso?.trim()) {
    const iso = normalizeScheduledInstantIso(nextRunIso)
    if (iso) {
      const uniq0 = new Set<number>()
      for (const pvStr of Object.values(col0TierPv)) {
        const pv = Number(pvStr)
        if (Number.isFinite(pv) && pv > 0) uniq0.add(pv)
      }
      for (const pv of uniq0) bump(iso, pv)
    }
  }

  for (const [compound, cnt] of counts) {
    if (cnt <= 1) continue
    const i = compound.indexOf(delim)
    const isoNorm = compound.slice(0, i)
    const pv = compound.slice(i + delim.length)
    try {
      const human = new Date(isoNorm).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
      return `Bonus (pv ${pv}) is assigned more than once for the same delivery time (${human}). Use a different time or promotion.`
    } catch {
      return `Promotion version ${pv} is duplicated at the same delivery instant. Adjust the schedule.`
    }
  }
  return null
}

/** `HH:mm` in 24h, UTC — used with column delivery time pickers. */
export function extractUtcHmFromIso(iso?: string): string {
  if (!iso?.trim()) return '00:00'
  const d = new Date(iso.trim())
  if (Number.isNaN(d.getTime())) return '00:00'
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** `YYYY-MM-DD` in UTC from an ISO or datetime-local–parsed instant. */
export function extractUtcDateInput(isoOrLocal: string): string {
  const d = new Date(isoOrLocal.trim())
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** RFC3339 UTC from calendar date + `HH:mm` UTC (day at 00:00 UTC + time). */
export function isoFromUtcDateAndHm(dateYYYYMMDD: string, hhmmUtc: string): string | null {
  const parts = dateYYYYMMDD.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  const day = parts[2]
  if (!y || !mo || !day) return null
  const base = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0))
  const out = applyUtcHmToUtcDate(base, hhmmUtc || '00:00')
  return out.toISOString()
}

/** Apply UTC clock (from admin `HH:mm`) to an instant (mutates calendar day in UTC only). */
export function applyUtcHmToUtcDate(d: Date, hhmmUtc: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmmUtc.trim())
  if (!m) return d
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return d
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm, 0, 0))
}

/** Per-column UTC delivery times (`HH:mm`) aligned with `weeklyCols` indices. */
export function hydrateWeeklyDeliveryUtcHm(
  anchorLocal: string,
  serverNextRunIso: string | undefined,
  planned: Array<{ runAtLocal: string }>,
  numCols: number,
): string[] {
  const out = Array.from({ length: numCols }, () => '00:00')
  out[0] = extractUtcHmFromIso(serverNextRunIso)
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return out
  for (const pr of planned) {
    const at = parseDatetimeLocal(pr.runAtLocal)
    if (!at) continue
    const idx = Math.round((at.getTime() - anchor.getTime()) / (7 * 86400000))
    if (idx >= 1 && idx < numCols) {
      out[idx] = extractUtcHmFromIso(at.toISOString())
    }
  }
  return out
}

export function hydrateMonthlyDeliveryUtcHm(
  anchorLocal: string,
  serverNextRunIso: string | undefined,
  planned: Array<{ runAtLocal: string }>,
  numCols: number,
): string[] {
  const out = Array.from({ length: numCols }, () => '12:00')
  out[0] = serverNextRunIso?.trim() ? extractUtcHmFromIso(serverNextRunIso) : '12:00'
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return out
  for (const pr of planned) {
    const at = parseDatetimeLocal(pr.runAtLocal)
    if (!at) continue
    let bestK = -1
    let bestDiff = Infinity
    for (let k = 0; k < numCols; k++) {
      const slot = monthlySlotDate(anchor, k)
      const diff = Math.abs(at.getTime() - slot.getTime())
      if (diff < bestDiff) {
        bestDiff = diff
        bestK = k
      }
    }
    if (bestK >= 1 && bestK < numCols && bestDiff < 48 * 3600000) {
      out[bestK] = extractUtcHmFromIso(at.toISOString())
    }
  }
  return out
}

/** Optional per-column UTC delivery calendar date (`YYYY-MM-DD`); empty uses grid slot from anchor. */
export function hydrateWeeklyColumnDeliveryDates(
  anchorLocal: string,
  planned: Array<{ runAtLocal: string }>,
  numCols: number,
): string[] {
  const out = Array.from({ length: numCols }, () => '')
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return out
  for (const pr of planned) {
    const at = parseDatetimeLocal(pr.runAtLocal)
    if (!at) continue
    const idx = Math.round((at.getTime() - anchor.getTime()) / (7 * 86400000))
    if (idx >= 1 && idx < numCols) {
      out[idx] = extractUtcDateInput(at.toISOString())
    }
  }
  return out
}

export function hydrateMonthlyColumnDeliveryDates(
  anchorLocal: string,
  planned: Array<{ runAtLocal: string }>,
  numCols: number,
): string[] {
  const out = Array.from({ length: numCols }, () => '')
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return out
  for (const pr of planned) {
    const at = parseDatetimeLocal(pr.runAtLocal)
    if (!at) continue
    let bestK = -1
    let bestDiff = Infinity
    for (let k = 0; k < numCols; k++) {
      const slot = monthlySlotDate(anchor, k)
      const diff = Math.abs(at.getTime() - slot.getTime())
      if (diff < bestDiff) {
        bestDiff = diff
        bestK = k
      }
    }
    if (bestK >= 1 && bestK < numCols && bestDiff < 48 * 3600000) {
      out[bestK] = extractUtcDateInput(at.toISOString())
    }
  }
  return out
}

export function buildWeeklyNextRunIsoFromAnchorLocal(anchorLocal: string, utcHm: string): string | null {
  const d = parseDatetimeLocal(anchorLocal)
  if (!d) return null
  const mon = startOfISOWeekUTC(d)
  const withT = applyUtcHmToUtcDate(mon, utcHm || '00:00')
  return withT.toISOString()
}

export function buildMonthlyNextRunIsoFromAnchorLocal(anchorLocal: string, utcHm: string): string | null {
  const d = parseDatetimeLocal(anchorLocal)
  if (!d) return null
  const slot0 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12, 0, 0, 0))
  const withT = applyUtcHmToUtcDate(slot0, utcHm || '12:00')
  return withT.toISOString()
}

/** When `next_run_at` falls on a different UTC calendar day than the grid-derived next run, surface it as an override. */
export function hydrateWeeklyColumn0NextRunUtcDateInput(
  anchorLocal: string,
  nextRunIso: string | undefined,
  utcHm: string,
): string {
  if (!nextRunIso?.trim()) return ''
  const built = buildWeeklyNextRunIsoFromAnchorLocal(anchorLocal, utcHm || '00:00')
  if (!built) return ''
  if (extractUtcDateInput(nextRunIso) === extractUtcDateInput(built)) return ''
  return extractUtcDateInput(nextRunIso)
}

export function hydrateMonthlyColumn0NextRunUtcDateInput(
  anchorLocal: string,
  nextRunIso: string | undefined,
  utcHm: string,
): string {
  if (!nextRunIso?.trim()) return ''
  const built = buildMonthlyNextRunIsoFromAnchorLocal(anchorLocal, utcHm || '12:00')
  if (!built) return ''
  if (extractUtcDateInput(nextRunIso) === extractUtcDateInput(built)) return ''
  return extractUtcDateInput(nextRunIso)
}

function parseDatetimeLocal(local: string): Date | null {
  const t = local.trim()
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toTierPromotionVersionsObject(
  map: Record<number, string>,
): Record<string, { promotion_version_id: number }> {
  const o: Record<string, { promotion_version_id: number }> = {}
  for (const [tid, pvStr] of Object.entries(map)) {
    const pv = Number(pvStr)
    const tierId = Number(tid)
    if (!Number.isFinite(pv) || pv <= 0 || !Number.isFinite(tierId)) continue
    o[String(tierId)] = { promotion_version_id: pv }
  }
  return o
}

/** How many UTC week columns the admin UI shows at once (one row). */
export const WEEK_GRID_PAGE_SIZE = 4
/** Hard cap for forward planning in the admin UI (~one year). */
export const WEEK_GRID_MAX_COLS = 52
/** Monthly columns visible at once in the admin UI. */
export const MONTH_GRID_COLS = 3
/** Upper bound for forward monthly slots in the admin UI. */
export const MONTH_GRID_MAX_COLS = 12

/**
 * How many week columns to hydrate: at least one page, enough for all planned runs, capped at {@link WEEK_GRID_MAX_COLS}.
 */
export function weeklyHydrateColumnCount(
  anchorLocal: string,
  planned: Array<{ runAtLocal: string; tierPv: Record<number, string> }>,
  minCols: number,
): number {
  const anchor = parseDatetimeLocal(anchorLocal)
  let maxIdx = minCols - 1
  if (anchor) {
    for (const pr of planned) {
      const at = parseDatetimeLocal(pr.runAtLocal)
      if (!at) continue
      const idx = Math.round((at.getTime() - anchor.getTime()) / (7 * 86400000))
      if (idx > maxIdx) maxIdx = idx
    }
  }
  const need = maxIdx + 1
  return Math.min(WEEK_GRID_MAX_COLS, Math.max(minCols, need))
}

/** True once the UTC ISO week for this column has fully ended (next Monday has begun). */
export function isWeeklyColumnElapsed(anchorLocal: string, idx: number, now: Date): boolean {
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return false
  const grantInstant = new Date(anchor.getTime() + idx * 7 * 86400000)
  const weekStart = startOfISOWeekUTC(grantInstant)
  const weekExclusiveEnd = weekStart.getTime() + 7 * 86400000
  return weekExclusiveEnd <= now.getTime()
}

/** First column index whose UTC week is still current or upcoming (for default scrolling). */
export function firstNonPastWeeklyColumnIndex(
  anchorLocal: string,
  numCols: number,
  now: Date = new Date(),
): number {
  for (let idx = 0; idx < numCols; idx++) {
    if (!isWeeklyColumnElapsed(anchorLocal, idx, now)) return idx
  }
  return Math.max(0, numCols - 1)
}

/**
 * How many month columns to hydrate: at least one window, enough for planned runs, capped at {@link MONTH_GRID_MAX_COLS}.
 */
export function monthlyHydrateColumnCount(
  anchorLocal: string,
  planned: Array<{ runAtLocal: string; tierPv: Record<number, string> }>,
  minCols: number,
): number {
  const anchor = parseDatetimeLocal(anchorLocal)
  let maxIdx = minCols - 1
  if (anchor) {
    for (const pr of planned) {
      const at = parseDatetimeLocal(pr.runAtLocal)
      if (!at) continue
      let bestK = -1
      let bestDiff = Infinity
      for (let k = 0; k < MONTH_GRID_MAX_COLS; k++) {
        const slot = monthlySlotDate(anchor, k)
        const diff = Math.abs(at.getTime() - slot.getTime())
        if (diff < bestDiff) {
          bestDiff = diff
          bestK = k
        }
      }
      if (bestK > maxIdx) maxIdx = bestK
    }
  }
  const need = maxIdx + 1
  return Math.min(MONTH_GRID_MAX_COLS, Math.max(minCols, need))
}

/** First month slot whose calendar month has not fully ended in UTC (next month not yet started). */
export function firstNonPastMonthlyColumnIndex(
  anchorLocal: string,
  numMonths: number,
  now: Date = new Date(),
): number {
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return 0
  const t = now.getTime()
  for (let idx = 0; idx < numMonths; idx++) {
    const slot = monthlySlotDate(anchor, idx)
    const ny = slot.getUTCFullYear()
    const nm = slot.getUTCMonth()
    const nextMonthStart = Date.UTC(ny, nm + 1, 1, 0, 0, 0, 0)
    if (nextMonthStart > t) return idx
  }
  return Math.max(0, numMonths - 1)
}

export function startOfISOWeekUTC(d: Date): Date {
  const day = d.getUTCDay()
  const diff = (day + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff, 0, 0, 0, 0))
}

function dateToDatetimeLocal(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Monday 00:00 UTC of the current ISO week — used to align the weekly grid and new schedules. */
export function implicitWeeklyAnchorDatetimeLocal(): string {
  return dateToDatetimeLocal(startOfISOWeekUTC(new Date()))
}

/** First day of the current month, 12:00 UTC (matches common monthly grant anchoring). */
export function implicitMonthlyAnchorDatetimeLocal(): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0, 0))
  return dateToDatetimeLocal(d)
}

/** Snap server `next_run_at` to a stable grid origin: Monday 00:00 UTC of that week. */
export function weeklyAnchorLocalForHydration(serverNextRunAtIso?: string): string {
  const t = serverNextRunAtIso?.trim()
  if (!t) return implicitWeeklyAnchorDatetimeLocal()
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return implicitWeeklyAnchorDatetimeLocal()
  return dateToDatetimeLocal(startOfISOWeekUTC(d))
}

/** Snap server `next_run_at` to 12:00 UTC on the 1st of that month. */
export function monthlyAnchorLocalForHydration(serverNextRunAtIso?: string): string {
  const t = serverNextRunAtIso?.trim()
  if (!t) return implicitMonthlyAnchorDatetimeLocal()
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return implicitMonthlyAnchorDatetimeLocal()
  const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12, 0, 0, 0))
  return dateToDatetimeLocal(a)
}

/** `YYYY-MM-DD` for the UTC Monday of the ISO week containing the anchor instant. */
export function utcWeekStartDateFromAnchorLocal(anchorLocal: string): string {
  const d = parseDatetimeLocal(anchorLocal)
  if (!d) return ''
  const mon = startOfISOWeekUTC(d)
  return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`
}

/** `YYYY-MM-DD` for the first day of the anchor month (UTC). */
export function utcMonthStartDateFromAnchorLocal(anchorLocal: string): string {
  const d = parseDatetimeLocal(anchorLocal)
  if (!d) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Build grid anchor string from a calendar date (any day in the target week) + UTC delivery clock. */
export function weeklyAnchorLocalFromWeekStartDateAndHm(dateYYYYMMDD: string, hhmmUtc: string): string {
  const parts = dateYYYYMMDD.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  const day = parts[2]
  if (!y || !mo || !day) return ''
  const pick = new Date(Date.UTC(y, mo - 1, day, 12, 0, 0, 0))
  const mon = startOfISOWeekUTC(pick)
  const out = applyUtcHmToUtcDate(mon, hhmmUtc || '00:00')
  return dateToDatetimeLocal(out)
}

/** Build monthly grid anchor from `YYYY-MM-DD` (year-month taken; day ignored beyond choosing month) + UTC clock on the 1st. */
export function monthlyAnchorLocalFromMonthStartDateAndHm(dateYYYYMMDD: string, hhmmUtc: string): string {
  const parts = dateYYYYMMDD.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  if (!y || !mo) return ''
  const day1 = new Date(Date.UTC(y, mo - 1, 1, 12, 0, 0, 0))
  const out = applyUtcHmToUtcDate(day1, hhmmUtc || '12:00')
  return dateToDatetimeLocal(out)
}

/** Worker monthly advance: first day of next calendar month UTC, same clock as anchor. */
export function advanceMonthlyUTC(d: Date): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return new Date(Date.UTC(y, m + 1, 1, d.getUTCHours(), d.getUTCMinutes(), 0, 0))
}

export function monthlySlotDate(anchor: Date, slotIndex: number): Date {
  let d = new Date(anchor.getTime())
  for (let i = 0; i < slotIndex; i++) {
    d = advanceMonthlyUTC(d)
  }
  return d
}

export function hydrateWeeklyMatrix(
  anchorLocal: string,
  defaults: Record<number, string>,
  planned: Array<{ runAtLocal: string; tierPv: Record<number, string> }>,
  numWeeks: number,
): TierPvCol[] {
  const cols: TierPvCol[] = Array.from({ length: numWeeks }, () => ({}))
  for (const [tidStr, pv] of Object.entries(defaults)) {
    const tid = Number(tidStr)
    if (pv && Number.isFinite(tid)) cols[0][tid] = pv
  }
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return cols

  for (const pr of planned) {
    const at = parseDatetimeLocal(pr.runAtLocal)
    if (!at) continue
    const idx = Math.round((at.getTime() - anchor.getTime()) / (7 * 86400000))
    if (idx < 0 || idx >= numWeeks) continue
    for (const [tidStr, pv] of Object.entries(pr.tierPv)) {
      const tid = Number(tidStr)
      if (pv && Number.isFinite(tid)) cols[idx][tid] = pv
    }
  }
  return cols
}

export function weeklyMatrixToPersist(
  cols: TierPvCol[],
  anchorLocal: string,
  columnUtcHm?: (k: number) => string | undefined,
  columnDateUtc?: (k: number) => string | undefined,
): { tierPv: Record<number, string>; planned: PlannedRunPersist[] } {
  const tierPv: Record<number, string> = { ...(cols[0] ?? {}) }
  const planned: PlannedRunPersist[] = []
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return { tierPv, planned }

  for (let k = 1; k < cols.length; k++) {
    const o = toTierPromotionVersionsObject(cols[k] ?? {})
    if (Object.keys(o).length === 0) continue
    const dateOv = columnDateUtc?.(k)?.trim()
    let base: Date
    if (dateOv && /^\d{4}-\d{2}-\d{2}$/.test(dateOv)) {
      const [y, mo, day] = dateOv.split('-').map(Number)
      base = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0))
    } else {
      base = new Date(anchor.getTime() + k * 7 * 86400000)
    }
    const hm = columnUtcHm?.(k)
    const runAt = hm != null && hm.trim() !== '' ? applyUtcHmToUtcDate(base, hm) : base
    planned.push({ run_at: runAt.toISOString(), tier_promotion_versions: o })
  }
  return { tierPv, planned }
}

export function hydrateMonthlyMatrix(
  anchorLocal: string,
  defaults: Record<number, string>,
  planned: Array<{ runAtLocal: string; tierPv: Record<number, string> }>,
  numMonths: number,
): TierPvCol[] {
  const cols: TierPvCol[] = Array.from({ length: numMonths }, () => ({}))
  for (const [tidStr, pv] of Object.entries(defaults)) {
    const tid = Number(tidStr)
    if (pv && Number.isFinite(tid)) cols[0][tid] = pv
  }
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return cols

  for (const pr of planned) {
    const at = parseDatetimeLocal(pr.runAtLocal)
    if (!at) continue
    let bestK = -1
    let bestDiff = Infinity
    for (let k = 0; k < numMonths; k++) {
      const slot = monthlySlotDate(anchor, k)
      const diff = Math.abs(at.getTime() - slot.getTime())
      if (diff < bestDiff) {
        bestDiff = diff
        bestK = k
      }
    }
    if (bestK >= 0 && bestDiff < 48 * 3600000) {
      for (const [tidStr, pv] of Object.entries(pr.tierPv)) {
        const tid = Number(tidStr)
        if (pv && Number.isFinite(tid)) cols[bestK][tid] = pv
      }
    }
  }
  return cols
}

export function monthlyMatrixToPersist(
  cols: TierPvCol[],
  anchorLocal: string,
  columnUtcHm?: (k: number) => string | undefined,
  columnDateUtc?: (k: number) => string | undefined,
): { tierPv: Record<number, string>; planned: PlannedRunPersist[] } {
  const tierPv: Record<number, string> = { ...(cols[0] ?? {}) }
  const planned: PlannedRunPersist[] = []
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return { tierPv, planned }

  for (let k = 1; k < cols.length; k++) {
    const o = toTierPromotionVersionsObject(cols[k] ?? {})
    if (Object.keys(o).length === 0) continue
    const dateOv = columnDateUtc?.(k)?.trim()
    let runAt: Date
    if (dateOv && /^\d{4}-\d{2}-\d{2}$/.test(dateOv)) {
      const [y, mo, day] = dateOv.split('-').map(Number)
      runAt = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0))
    } else {
      runAt = monthlySlotDate(anchor, k)
    }
    const hm = columnUtcHm?.(k)
    if (hm != null && hm.trim() !== '') runAt = applyUtcHmToUtcDate(runAt, hm)
    planned.push({ run_at: runAt.toISOString(), tier_promotion_versions: o })
  }
  return { tierPv, planned }
}

/** For timeline preview: synthetic planned rows from future columns. */
export function weeklyColsToTimelinePlanned(
  cols: TierPvCol[],
  anchorLocal: string,
): Array<{ id: string; runAtLocal: string; tierPv: Record<number, string> }> {
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return []
  const out: Array<{ id: string; runAtLocal: string; tierPv: Record<number, string> }> = []
  for (let k = 1; k < cols.length; k++) {
    const c = cols[k]
    if (!c || Object.keys(c).length === 0) continue
    const runAt = new Date(anchor.getTime() + k * 7 * 86400000)
    out.push({
      id: `w-preview-${k}`,
      runAtLocal: isoToDatetimeLocal(runAt.toISOString()),
      tierPv: { ...c },
    })
  }
  return out
}

export function monthlyColsToTimelinePlanned(
  cols: TierPvCol[],
  anchorLocal: string,
): Array<{ id: string; runAtLocal: string; tierPv: Record<number, string> }> {
  const anchor = parseDatetimeLocal(anchorLocal)
  if (!anchor) return []
  const out: Array<{ id: string; runAtLocal: string; tierPv: Record<number, string> }> = []
  for (let k = 1; k < cols.length; k++) {
    const c = cols[k]
    if (!c || Object.keys(c).length === 0) continue
    const runAt = monthlySlotDate(anchor, k)
    out.push({
      id: `m-preview-${k}`,
      runAtLocal: isoToDatetimeLocal(runAt.toISOString()),
      tierPv: { ...c },
    })
  }
  return out
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso.trim())
  if (Number.isNaN(d.getTime())) return ''
  return dateToDatetimeLocal(d)
}
