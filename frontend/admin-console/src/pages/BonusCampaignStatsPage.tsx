import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { AreaChart, ChartCard, CHART_COLORS } from '../components/dashboard'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'
import { formatCurrency } from '../lib/format'

type StatRow = {
  stat_date: string
  promotion_version_id: number
  grants_count: number
  grant_volume_minor: number
  active_instances_end: number
  completed_wr: number
  forfeited: number
  cost_minor: number
}

type PromotionOption = {
  id: number
  name: string
  latest_version_id?: number
  status?: string
  has_published_version?: boolean
  grants_paused?: boolean
  player_hub_force_visible?: boolean
  latest_published_valid_from?: string
}

const TIMEFRAME_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

function promotionStatusLabel(p: PromotionOption): 'live' | 'scheduled' | 'paused' | 'draft' | 'archived' | 'other' {
  const raw = (p.status ?? '').trim().toLowerCase()
  if (raw === 'archived') return 'archived'
  if (!p.has_published_version) return raw === 'draft' || raw === '' ? 'draft' : 'other'
  if (p.grants_paused === true) return 'paused'
  if (p.player_hub_force_visible) return 'live'
  if (p.latest_published_valid_from) {
    const vf = new Date(p.latest_published_valid_from)
    if (!Number.isNaN(vf.getTime()) && vf.getTime() > Date.now()) return 'scheduled'
  }
  return 'live'
}

function statusPrefix(status: ReturnType<typeof promotionStatusLabel>): string {
  if (status === 'live') return '[LIVE]'
  if (status === 'scheduled') return '[SCHEDULED]'
  if (status === 'paused') return '[PAUSED]'
  if (status === 'archived') return '[ARCHIVED]'
  if (status === 'draft') return '[DRAFT]'
  return '[OTHER]'
}

function statusGroupLabel(status: ReturnType<typeof promotionStatusLabel>): string {
  if (status === 'live') return 'Live'
  if (status === 'scheduled') return 'Scheduled'
  if (status === 'paused') return 'Paused'
  if (status === 'archived') return 'Archived'
  if (status === 'draft') return 'Draft'
  return 'Other'
}

function statusSortRank(status: ReturnType<typeof promotionStatusLabel>): number {
  if (status === 'live') return 0
  if (status === 'scheduled') return 1
  if (status === 'paused') return 2
  if (status === 'archived') return 3
  if (status === 'draft') return 4
  return 5
}

export default function BonusCampaignStatsPage() {
  const { apiFetch } = useAdminAuth()
  const [promotionId, setPromotionId] = useState('')
  const [promotions, setPromotions] = useState<PromotionOption[]>([])
  const [timeframe, setTimeframe] = useState('90d')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState<StatRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (selectedPromotionId: string, selectedTimeframe: string, selectedStart: string, selectedEnd: string) => {
      setErr(null)
      setLoading(true)
      try {
        const q = new URLSearchParams()
        const pid = selectedPromotionId.trim()
        if (pid) q.set('promotion_id', pid)
        if (selectedTimeframe === 'custom') {
          if (selectedStart) q.set('start', selectedStart)
          if (selectedEnd) q.set('end', selectedEnd)
        } else {
          q.set('period', selectedTimeframe || '90d')
        }
        const res = await apiFetch(`/v1/admin/bonushub/campaign-daily-stats?${q.toString()}`)
        if (!res.ok) {
          setErr(`HTTP ${res.status}`)
          setRows([])
          return
        }
        const j = (await res.json()) as { stats?: StatRow[] }
        setRows(Array.isArray(j.stats) ? j.stats : [])
      } catch {
        setErr('Network error')
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [apiFetch],
  )

  const loadPromotions = useCallback(async () => {
    try {
      const q = new URLSearchParams({ limit: '200' })
      const res = await apiFetch(`/v1/admin/bonushub/promotions?${q.toString()}`)
      if (!res.ok) return
      const j = (await res.json()) as { promotions?: PromotionOption[] }
      setPromotions(Array.isArray(j.promotions) ? j.promotions : [])
    } catch {
      setPromotions([])
    }
  }, [apiFetch])

  useEffect(() => {
    void load('', '90d', '', '')
    void loadPromotions()
  }, [load, loadPromotions])

  const chartSeries = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.stat_date.localeCompare(b.stat_date))
    return {
      dates: sorted.map((r) => r.stat_date),
      costs: sorted.map((r) => r.cost_minor),
      grants: sorted.map((r) => r.grants_count),
    }
  }, [rows])

  const groupedPromotions = useMemo(() => {
    const map = new Map<ReturnType<typeof promotionStatusLabel>, PromotionOption[]>()
    for (const p of promotions) {
      const s = promotionStatusLabel(p)
      const items = map.get(s) ?? []
      items.push(p)
      map.set(s, items)
    }
    const buckets = Array.from(map.entries()).map(([status, items]) => ({
      status,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    buckets.sort((a, b) => statusSortRank(a.status) - statusSortRank(b.status))
    return buckets
  }, [promotions])

  return (
    <>
      <PageMeta title="Campaign analytics · Bonus Engine" description="Bonus campaign daily rollup" />
      <PageBreadcrumb
        pageTitle="Campaign analytics"
        subtitle="Daily cost, grant volume, and WR outcomes by promotion version"
      />
      <ComponentCard
        title="Filters"
        desc="Optionally scope to one promotion. Leave empty for aggregated performance across all promotions."
      >
        <div className="row g-3 align-items-end">
          <div className="col-12 col-md-6">
            <label className="form-label small mb-1" htmlFor="camp-promo">
              Promotion
            </label>
            <select
              id="camp-promo"
              className="form-select form-select-sm"
              value={promotionId}
              onChange={(e) => setPromotionId(e.target.value)}
            >
              <option value="">All promotions</option>
              {groupedPromotions.map((bucket) => (
                <optgroup key={bucket.status} label={statusGroupLabel(bucket.status)}>
                  {bucket.items.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {statusPrefix(bucket.status)} {p.name} {p.latest_version_id ? `(v${p.latest_version_id})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-auto">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={loading}
              onClick={() => void load(promotionId, timeframe, startDate, endDate)}
            >
              {loading ? 'Loading…' : 'Apply'}
            </button>
          </div>
        </div>
      </ComponentCard>
      <DataTimeframeBar
        value={timeframe}
        onChange={setTimeframe}
        options={TIMEFRAME_OPTIONS}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      {err ? (
        <div className="alert alert-warning mt-3" role="alert">
          {err}
        </div>
      ) : null}

      {chartSeries.dates.length > 0 ? (
        <div className="row g-3 mt-1">
          <div className="col-12 col-lg-6">
            <ChartCard title="Bonus cost (daily)">
              <AreaChart
                categories={chartSeries.dates}
                series={[{ name: 'Cost', data: chartSeries.costs, color: CHART_COLORS.danger }]}
                height={260}
                yFormatter={(v) => formatCurrency(v)}
              />
            </ChartCard>
          </div>
          <div className="col-12 col-lg-6">
            <ChartCard title="Grants (daily count)">
              <AreaChart
                categories={chartSeries.dates}
                series={[{ name: 'Grants', data: chartSeries.grants, color: CHART_COLORS.primary }]}
                height={260}
              />
            </ChartCard>
          </div>
        </div>
      ) : !loading ? (
        <p className="text-body-secondary small mt-3 mb-0">No stats for this filter.</p>
      ) : null}

      <ComponentCard
        title="Daily breakdown"
        desc="Newest rows from the campaign stats API — scroll horizontally on small screens."
      >
        <div className="table-responsive">
          <table className="table table-sm table-striped table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Version</th>
                <th scope="col" className="text-end">
                  Grants
                </th>
                <th scope="col" className="text-end">
                  Grant volume
                </th>
                <th scope="col" className="text-end">
                  Cost
                </th>
                <th scope="col" className="text-end">
                  WR done
                </th>
                <th scope="col" className="text-end">
                  Forfeited
                </th>
                <th scope="col" className="text-end">
                  Active EOD
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.stat_date}-${r.promotion_version_id}-${i}`}>
                  <td className="text-nowrap small">{r.stat_date}</td>
                  <td>
                    <code className="small">{r.promotion_version_id}</code>
                  </td>
                  <td className="text-end font-monospace small">{r.grants_count}</td>
                  <td className="text-end font-monospace small">{formatCurrency(r.grant_volume_minor)}</td>
                  <td className="text-end font-monospace small">{formatCurrency(r.cost_minor)}</td>
                  <td className="text-end font-monospace small">{r.completed_wr}</td>
                  <td className="text-end font-monospace small">{r.forfeited}</td>
                  <td className="text-end font-monospace small">{r.active_instances_end}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ComponentCard>
    </>
  )
}
