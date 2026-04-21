import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { AreaChart, ChartCard } from '../components/dashboard'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
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

export default function BonusCampaignStatsPage() {
  const { apiFetch } = useAdminAuth()
  const [vid, setVid] = useState('')
  const [days, setDays] = useState('90')
  const [rows, setRows] = useState<StatRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (daysStr: string, versionId: string) => {
      setErr(null)
      setLoading(true)
      try {
        const q = new URLSearchParams()
        q.set('days', daysStr.trim() || '90')
        const v = versionId.trim()
        if (v) q.set('promotion_version_id', v)
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

  useEffect(() => {
    void load('90', '')
  }, [load])

  const chartSeries = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.stat_date.localeCompare(b.stat_date))
    return {
      dates: sorted.map((r) => r.stat_date),
      costs: sorted.map((r) => r.cost_minor),
      grants: sorted.map((r) => r.grants_count),
    }
  }, [rows])

  return (
    <>
      <PageMeta title="Campaign analytics · Bonus Engine" description="Bonus campaign daily rollup" />
      <PageBreadcrumb pageTitle="Campaign analytics" />
      <ComponentCard
        title="Filters"
        desc="Optional promotion version id scopes the series to one campaign version; leave empty for recent aggregate rows."
      >
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            Promotion version ID
            <input
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              value={vid}
              onChange={(e) => setVid(e.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            Days
            <input
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="self-end rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600 disabled:opacity-50"
            disabled={loading}
            onClick={() => void load(days, vid)}
          >
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </ComponentCard>

      {err ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      {chartSeries.dates.length > 0 ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <ChartCard title="Cost (minor units) by day">
            <AreaChart
              categories={chartSeries.dates}
              series={[{ name: 'Cost', data: chartSeries.costs, color: '#DC2626' }]}
              height={240}
              yFormatter={(v) => formatCurrency(v)}
            />
          </ChartCard>
          <ChartCard title="Grants count by day">
            <AreaChart
              categories={chartSeries.dates}
              series={[{ name: 'Grants', data: chartSeries.grants, color: '#2563EB' }]}
              height={240}
            />
          </ChartCard>
        </div>
      ) : !loading ? (
        <p className="mt-6 text-sm text-gray-500">No stats for this filter.</p>
      ) : null}

      <ComponentCard className="mt-6" title="Raw rows" desc="Newest-first limit from API.">
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-xs dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-2 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-left">Ver</th>
                <th className="px-2 py-2 text-left">Grants</th>
                <th className="px-2 py-2 text-left">Volume</th>
                <th className="px-2 py-2 text-left">Cost</th>
                <th className="px-2 py-2 text-left">WR done</th>
                <th className="px-2 py-2 text-left">Forfeited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((r, i) => (
                <tr key={`${r.stat_date}-${r.promotion_version_id}-${i}`}>
                  <td className="whitespace-nowrap px-2 py-1.5">{r.stat_date}</td>
                  <td className="px-2 py-1.5 font-mono">{r.promotion_version_id}</td>
                  <td className="px-2 py-1.5">{r.grants_count}</td>
                  <td className="px-2 py-1.5">{r.grant_volume_minor}</td>
                  <td className="px-2 py-1.5">{r.cost_minor}</td>
                  <td className="px-2 py-1.5">{r.completed_wr}</td>
                  <td className="px-2 py-1.5">{r.forfeited}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ComponentCard>
    </>
  )
}
