/** Derive upcoming VIP delivery timestamps from schedule rows for tracker UI. */

export type TrackerScheduleRow = {
  pipeline: string
  enabled: boolean
  config: Record<string, unknown>
  next_run_at?: string
}

const PIPELINE_LABEL: Record<string, string> = {
  weekly_bonus: 'Weekly VIP',
  monthly_bonus: 'Monthly VIP',
}

function parseTierPromotionMap(cfg: Record<string, unknown>): Record<number, string> {
  const raw = cfg.tier_promotion_versions
  const out: Record<number, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const tid = Number(k)
    if (!Number.isFinite(tid)) continue
    let pvid = ''
    if (typeof v === 'number' && Number.isFinite(v)) pvid = String(v)
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const n = Number((v as { promotion_version_id?: unknown }).promotion_version_id)
      if (Number.isFinite(n)) pvid = String(n)
    }
    if (pvid) out[tid] = pvid
  }
  return out
}

/** Advance anchor until it is at or after `now` (matches worker advancing weekly/monthly schedules). */
export function projectNextRunForPipeline(pipeline: string, anchor: Date, now: Date): Date {
  const cutoff = now.getTime() - 60_000
  let t = new Date(anchor.getTime())
  let guard = 0
  while (t.getTime() < cutoff && guard < 120) {
    if (pipeline === 'monthly_bonus') {
      const y = t.getUTCFullYear()
      const m = t.getUTCMonth()
      const hh = t.getUTCHours()
      const mm = t.getUTCMinutes()
      const ss = t.getUTCSeconds()
      const ms = t.getUTCMilliseconds()
      t = new Date(Date.UTC(y, m + 1, 1, hh, mm, ss, ms))
    } else {
      t.setUTCDate(t.getUTCDate() + 7)
    }
    guard++
  }
  return t
}

function parsePlannedRuns(cfg: Record<string, unknown>): Array<{ run_at: string; pvIds: Set<string> }> {
  const raw = cfg.planned_runs
  if (!Array.isArray(raw)) return []
  const out: Array<{ run_at: string; pvIds: Set<string> }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const ra = typeof o.run_at === 'string' ? o.run_at : ''
    if (!ra.trim()) continue
    const inner = o.tier_promotion_versions
    const fake: Record<string, unknown> = {}
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) fake.tier_promotion_versions = inner
    const tierPv = parseTierPromotionMap(fake)
    const pvIds = new Set<string>()
    for (const pv of Object.values(tierPv)) {
      if (pv) pvIds.add(String(pv))
    }
    out.push({ run_at: ra, pvIds })
  }
  return out
}

export type ScheduleHint = {
  pipeline: string
  label: string
  at: Date
  source: 'next_run' | 'planned'
  /** Automation toggle off — delivery will not run until re-enabled. */
  deliveryPaused?: boolean
}

/** All upcoming (or current tick) delivery hints for a promotion version across VIP pipelines. */
export function collectScheduleHintsForPv(
  pvId: number,
  schedules: TrackerScheduleRow[],
  now: Date = new Date(),
): ScheduleHint[] {
  const pvStr = String(pvId)
  const nowMs = now.getTime()
  const hints: ScheduleHint[] = []

  for (const row of schedules) {
    const pipeline = row.pipeline
    if (pipeline !== 'weekly_bonus' && pipeline !== 'monthly_bonus') continue
    const label = PIPELINE_LABEL[pipeline] ?? pipeline
    const cfg = (row.config ?? {}) as Record<string, unknown>

    const defaults = parseTierPromotionMap(cfg)
    const defaultUsesPv = Object.values(defaults).some((v) => v === pvStr)

    if (defaultUsesPv && row.next_run_at) {
      const raw = new Date(row.next_run_at)
      if (!Number.isNaN(raw.getTime())) {
        const at = projectNextRunForPipeline(pipeline, raw, new Date(nowMs))
        hints.push({
          pipeline,
          label,
          at,
          source: 'next_run',
          deliveryPaused: !row.enabled,
        })
      }
    }

    for (const pr of parsePlannedRuns(cfg)) {
      if (!pr.pvIds.has(pvStr)) continue
      const t = new Date(pr.run_at)
      if (Number.isNaN(t.getTime()) || t.getTime() < nowMs - 120_000) continue
      hints.push({ pipeline, label, at: t, source: 'planned' })
    }
  }

  hints.sort((a, b) => a.at.getTime() - b.at.getTime())
  return hints
}

/** Format for tracker badges — weekday + calendar date in UTC (matches scheduling UI). */
export function formatScheduleDayUtc(isoDate: Date): string {
  return isoDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
