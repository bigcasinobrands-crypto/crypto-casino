import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import PageMeta from '../components/common/PageMeta'
import { ImageUrlField } from '../components/admin-ui'
import {
  formatTierEventMeta,
  formatVipBenefitDetail,
  mergeVipTierPerksFromForm,
} from '../lib/adminFormatting'

type VipTierRow = {
  id: number
  sort_order: number
  name: string
  min_lifetime_wager_minor: number
  perks: Record<string, unknown>
  created_at?: string
}

type VipBenefitRow = {
  id: number
  tier_id: number
  sort_order: number
  enabled: boolean
  benefit_type: string
  promotion_version_id?: number
  config: Record<string, unknown>
  player_title?: string
  player_description?: string
  created_at?: string
  updated_at?: string
}

type ActiveOffer = {
  promotion_version_id: number
  promotion_id: number
  promotion_name: string
}

type VipDeliverySummary = {
  tier_population: { tier_id: number; name: string; sort_order: number; player_count: number }[]
  players_untiered: number
  tier_events_7d: number
  grant_log_7d_by_result: Record<string, number>
  recent_tier_events: Array<{
    id: number
    user_id: string
    from_tier_id?: number
    to_tier_id?: number
    lifetime_wager_minor: number
    meta?: Record<string, unknown>
    created_at: string
  }>
}

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

const labelCls = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'

const tabBtn = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-semibold ${
    active
      ? 'bg-brand-600 text-white'
      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5'
  }`

function playerUiOrigin(): string {
  const env = import.meta.env as { VITE_PLAYER_UI_ORIGIN?: string; VITE_PLAYER_APP_ORIGIN?: string }
  const o = (env.VITE_PLAYER_UI_ORIGIN || env.VITE_PLAYER_APP_ORIGIN || '').trim()
  if (o) return o.replace(/\/$/, '')
  return `${window.location.protocol}//127.0.0.1:5174`
}

export default function VipProgramPage() {
  const { apiFetch, role } = useAdminAuth()
  const [tab, setTab] = useState<'overview' | 'tiers' | 'activity'>('overview')
  const [tiers, setTiers] = useState<VipTierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState('')
  const [name, setName] = useState('')
  const [minWager, setMinWager] = useState('')
  const [showOnVipPage, setShowOnVipPage] = useState(true)
  const [perkHeaderColor, setPerkHeaderColor] = useState('')
  const [perkImageUrl, setPerkImageUrl] = useState('')
  const [perkRankLabel, setPerkRankLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [benefits, setBenefits] = useState<VipBenefitRow[]>([])
  const [benefitsLoading, setBenefitsLoading] = useState(false)
  const [summary, setSummary] = useState<VipDeliverySummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [offers, setOffers] = useState<ActiveOffer[]>([])

  const [newBenefitType, setNewBenefitType] = useState<'grant_promotion' | 'rebate_percent_add'>('grant_promotion')
  const [newPvId, setNewPvId] = useState('')
  const [newRebateKey, setNewRebateKey] = useState('')
  const [newPercentAdd, setNewPercentAdd] = useState('5')
  const [newGrantAmt, setNewGrantAmt] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newSort, setNewSort] = useState('0')

  const canEdit = role === 'superadmin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/tiers')
      if (!res.ok) {
        toast.error(`Could not load tiers (${res.status})`)
        setTiers([])
        return
      }
      const j = (await res.json()) as { tiers?: VipTierRow[] }
      const list = Array.isArray(j.tiers) ? j.tiers : []
      setTiers(list)
    } catch {
      toast.error('Network error loading VIP tiers')
      setTiers([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/delivery/summary')
      if (!res.ok) {
        setSummary(null)
        return
      }
      const j = (await res.json()) as VipDeliverySummary
      setSummary(j)
    } catch {
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
  }, [apiFetch])

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await apiFetch('/v1/admin/content/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          toast.error('Upload failed')
          return null
        }
        const j = (await res.json()) as { url: string }
        toast.success('Image uploaded')
        return j.url
      } catch {
        toast.error('Upload error')
        return null
      }
    },
    [apiFetch],
  )

  const loadOffers = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/bonushub/offers/active')
      if (!res.ok) return
      const j = (await res.json()) as { offers?: ActiveOffer[] }
      setOffers(Array.isArray(j.offers) ? j.offers : [])
    } catch {
      /* ignore */
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
    void loadOffers()
  }, [load, loadOffers])

  useEffect(() => {
    if (tab === 'overview' || tab === 'activity') void loadSummary()
  }, [tab, loadSummary])

  useEffect(() => {
    if (selectedId == null && tiers.length > 0) {
      setSelectedId(tiers[0].id)
    }
  }, [selectedId, tiers])

  const selected = tiers.find((t) => t.id === selectedId) ?? null

  useEffect(() => {
    if (!selected) return
    setSortOrder(String(selected.sort_order))
    setName(selected.name)
    setMinWager(String(selected.min_lifetime_wager_minor))
    const p = selected.perks ?? {}
    setShowOnVipPage(p.hide_from_public_page !== true)
    const d =
      p.display && typeof p.display === 'object' && !Array.isArray(p.display)
        ? (p.display as Record<string, unknown>)
        : {}
    setPerkHeaderColor(String(d.header_color ?? ''))
    setPerkImageUrl(String(d.character_image_url ?? ''))
    setPerkRankLabel(String(d.rank_label ?? ''))
  }, [selected])

  const loadBenefits = useCallback(async () => {
    if (selectedId == null) return
    setBenefitsLoading(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits`)
      if (!res.ok) {
        setBenefits([])
        return
      }
      const j = (await res.json()) as { benefits?: VipBenefitRow[] }
      setBenefits(Array.isArray(j.benefits) ? j.benefits : [])
    } catch {
      setBenefits([])
    } finally {
      setBenefitsLoading(false)
    }
  }, [apiFetch, selectedId])

  useEffect(() => {
    void loadBenefits()
  }, [loadBenefits])

  const save = async () => {
    if (!selectedId || !canEdit || !selected) return
    const perks = mergeVipTierPerksFromForm(
      { ...(selected.perks ?? {}) },
      {
        showOnPublicPage: showOnVipPage,
        headerColor: perkHeaderColor,
        imageUrl: perkImageUrl,
        rankLabel: perkRankLabel,
      },
    )
    setSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sort_order: parseInt(sortOrder, 10) || 0,
          name: name.trim(),
          min_lifetime_wager_minor: parseInt(minWager, 10) || 0,
          perks,
        }),
      })
      if (!res.ok) {
        toast.error(`Save failed (${res.status})`)
        return
      }
      toast.success('VIP tier updated')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const addBenefit = async () => {
    if (!selectedId || !canEdit) return
    const sort = parseInt(newSort, 10) || 0
    let body: Record<string, unknown>
    if (newBenefitType === 'grant_promotion') {
      const pv = parseInt(newPvId, 10)
      if (!pv) {
        toast.error('Choose or enter a published promotion version id')
        return
      }
      const cfg: Record<string, unknown> = {}
      const ga = parseInt(newGrantAmt, 10)
      if (ga > 0) cfg.grant_amount_minor = ga
      body = {
        sort_order: sort,
        benefit_type: 'grant_promotion',
        promotion_version_id: pv,
        config: cfg,
        player_title: newTitle.trim() || null,
        player_description: newDesc.trim() || null,
      }
    } else {
      const pct = parseInt(newPercentAdd, 10)
      if (!newRebateKey.trim() || pct <= 0) {
        toast.error('Rebate programme key and positive percent_add required')
        return
      }
      body = {
        sort_order: sort,
        benefit_type: 'rebate_percent_add',
        config: { rebate_program_key: newRebateKey.trim(), percent_add: pct },
        player_title: newTitle.trim() || null,
        player_description: newDesc.trim() || null,
      }
    }
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        toast.error(j?.message ?? `Create failed (${res.status})`)
        return
      }
      toast.success('Benefit created')
      setNewTitle('')
      setNewDesc('')
      setNewGrantAmt('')
      await loadBenefits()
      void loadSummary()
    } catch {
      toast.error('Network error')
    }
  }

  const toggleBenefit = async (b: VipBenefitRow) => {
    if (!selectedId || !canEdit) return
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !b.enabled }),
      })
      if (!res.ok) {
        toast.error(`Update failed (${res.status})`)
        return
      }
      await loadBenefits()
    } catch {
      toast.error('Network error')
    }
  }

  const deleteBenefit = async (b: VipBenefitRow) => {
    if (!selectedId || !canEdit) return
    if (!window.confirm(`Delete benefit #${b.id}?`)) return
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits/${b.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(`Delete failed (${res.status})`)
        return
      }
      toast.success('Benefit removed')
      await loadBenefits()
    } catch {
      toast.error('Network error')
    }
  }

  const origin = playerUiOrigin()
  const playerVipUrl = `${origin}/vip`

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <PageMeta
        title="VIP system — Admin"
        description="VIP tiers, unlock grants, rebate boosts, and delivery visibility."
      />
      <header>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">VIP system</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Players advance by <strong>lifetime cash wager</strong>. When they reach a tier, you can attach an{' '}
          <strong>unlock bonus</strong> (a published promotion). You can also add an <strong>extra rebate percentage</strong>{' '}
          that applies on the next payout for the rebate programme you choose.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 dark:border-gray-700">
        <button type="button" className={tabBtn(tab === 'overview')} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button type="button" className={tabBtn(tab === 'tiers')} onClick={() => setTab('tiers')}>
          Tiers &amp; benefits
        </button>
        <button type="button" className={tabBtn(tab === 'activity')} onClick={() => setTab('activity')}>
          Activity
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href={playerVipUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-700"
        >
          Open player VIP page
        </a>
        <button
          type="button"
          onClick={() => {
            void load()
            void loadSummary()
            void loadBenefits()
          }}
          className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          {summaryLoading ? <p className="text-sm text-gray-500">Loading delivery summary…</p> : null}
          {summary ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/5">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Tier-ups (7d)</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.tier_events_7d}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/5">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Players untiered</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.players_untiered}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/5 sm:col-span-2 lg:col-span-1">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Grant outcomes (7d)</div>
                  <div className="mt-1 font-mono text-xs text-gray-800 dark:text-gray-200">
                    {Object.entries(summary.grant_log_7d_by_result || {})
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ') || '—'}
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Population by tier</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left dark:border-gray-600">
                        <th className="py-2 pr-4">Tier</th>
                        <th className="py-2 pr-4">Players</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.tier_population.map((r) => (
                        <tr key={r.tier_id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-2 pr-4">
                            {r.name}{' '}
                            <span className="text-xs text-gray-500">
                              (sort {r.sort_order}, id {r.tier_id})
                            </span>
                          </td>
                          <td className="py-2 pr-4 font-mono">{r.player_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            !summaryLoading && <p className="text-sm text-gray-500">No summary data.</p>
          )}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          {summaryLoading ? <p className="p-4 text-sm text-gray-500">Loading…</p> : null}
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800/80">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">When</th>
                <th className="px-3 py-2 text-left font-semibold">User</th>
                <th className="px-3 py-2 text-left font-semibold">From → To</th>
                <th className="px-3 py-2 text-left font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {(summary?.recent_tier_events ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">
                    {e.created_at}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.user_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2 text-xs">
                    {e.from_tier_id ?? '—'} → {e.to_tier_id ?? '—'}
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
                    {formatTierEventMeta(e.meta as Record<string, unknown> | undefined)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!summaryLoading && (summary?.recent_tier_events?.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-gray-500">No tier events yet.</p>
          ) : null}
        </div>
      ) : null}

      {tab === 'tiers' ? (
        <>
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800/80">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">ID</th>
                    <th className="px-3 py-2 text-left font-semibold">Sort</th>
                    <th className="px-3 py-2 text-left font-semibold">Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Min wager</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                  {tiers.map((t) => (
                    <tr
                      key={t.id}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 ${selectedId === t.id ? 'bg-brand-500/10' : ''}`}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{t.id}</td>
                      <td className="px-3 py-2">{t.sort_order}</td>
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{t.min_lifetime_wager_minor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              {!selected ? (
                <p className="text-sm text-gray-500">Select a tier.</p>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Edit tier #{selected.id}</h2>
                  <div>
                    <label className={labelCls} htmlFor="vip-sort">
                      Sort order
                    </label>
                    <input id="vip-sort" className={inputCls} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="vip-name">
                      Name
                    </label>
                    <input id="vip-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="vip-min">
                      Minimum lifetime wager to reach this tier
                    </label>
                    <input id="vip-min" className={inputCls} value={minWager} onChange={(e) => setMinWager(e.target.value)} />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Amount in the smallest units for your currency (same as ledger / bonus amounts). Higher tiers use
                      larger numbers.
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-600 dark:bg-white/5">
                    <p className="mb-3 text-xs font-semibold text-gray-800 dark:text-gray-200">How this tier looks on the VIP page</p>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={showOnVipPage}
                        onChange={(e) => setShowOnVipPage(e.target.checked)}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      Show this tier on the public VIP ladder
                    </label>
                    <div className="mt-3">
                      <label className={labelCls} htmlFor="vip-rank-label">
                        Rank label (e.g. Rank 1)
                      </label>
                      <input
                        id="vip-rank-label"
                        className={inputCls}
                        value={perkRankLabel}
                        onChange={(e) => setPerkRankLabel(e.target.value)}
                        placeholder="Rank 1"
                      />
                    </div>
                    <div className="mt-3">
                      <label className={labelCls} htmlFor="vip-header-color">
                        Header accent color
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id="vip-header-color"
                          type="color"
                          className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white dark:border-gray-600"
                          value={perkHeaderColor.match(/^#[0-9a-fA-F]{6}$/) ? perkHeaderColor : '#888888'}
                          onChange={(e) => setPerkHeaderColor(e.target.value)}
                        />
                        <input
                          className={`${inputCls} max-w-xs flex-1`}
                          value={perkHeaderColor}
                          onChange={(e) => setPerkHeaderColor(e.target.value)}
                          placeholder="#898b8a"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <ImageUrlField
                        id="vip-char-img"
                        label="Character image"
                        hint="Shown on the VIP ladder for this tier. Upload or paste a CDN URL."
                        value={perkImageUrl}
                        onChange={setPerkImageUrl}
                        disabled={!canEdit}
                        uploadFile={uploadFile}
                      />
                    </div>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save()}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save tier'}
                    </button>
                  ) : (
                    <p className="text-sm text-amber-700 dark:text-amber-400">Superadmin role required to save tier edits.</p>
                  )}

                  <hr className="border-gray-200 dark:border-gray-700" />

                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Tier benefits</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Unlock bonuses must use a <strong>published</strong> promotion. For extra rebate %, pick the same
                    programme name you use elsewhere for that rebate (e.g. weekly cashback).
                  </p>

                  {benefitsLoading ? <p className="text-xs text-gray-500">Loading benefits…</p> : null}
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                          <th className="px-2 py-1 text-left">#</th>
                          <th className="px-2 py-1 text-left">Type</th>
                          <th className="px-2 py-1 text-left">On</th>
                          <th className="px-2 py-1 text-left">What it does</th>
                          <th className="px-2 py-1 text-left" />
                        </tr>
                      </thead>
                      <tbody>
                        {benefits.map((b) => (
                          <tr key={b.id} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-2 py-1 font-mono">{b.id}</td>
                            <td className="px-2 py-1">{b.benefit_type}</td>
                            <td className="px-2 py-1">{b.enabled ? 'yes' : 'no'}</td>
                            <td className="max-w-[240px] px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
                              {formatVipBenefitDetail(b)}
                            </td>
                            <td className="px-2 py-1">
                              {canEdit ? (
                                <span className="flex gap-2">
                                  <button type="button" className="text-brand-600 hover:underline" onClick={() => void toggleBenefit(b)}>
                                    {b.enabled ? 'Disable' : 'Enable'}
                                  </button>
                                  <button type="button" className="text-red-600 hover:underline" onClick={() => void deleteBenefit(b)}>
                                    Delete
                                  </button>
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {canEdit ? (
                    <div className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-white/5">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Add benefit</div>
                      <div>
                        <label className={labelCls}>Type</label>
                        <select
                          className={inputCls}
                          value={newBenefitType}
                          onChange={(e) => setNewBenefitType(e.target.value as 'grant_promotion' | 'rebate_percent_add')}
                        >
                          <option value="grant_promotion">Unlock bonus when player reaches this tier</option>
                          <option value="rebate_percent_add">Extra rebate % (ongoing)</option>
                        </select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className={labelCls}>Sort order</label>
                          <input className={inputCls} value={newSort} onChange={(e) => setNewSort(e.target.value)} />
                        </div>
                        {newBenefitType === 'grant_promotion' ? (
                          <div>
                            <label className={labelCls}>Choose a live offer</label>
                            <select
                              className={inputCls}
                              value=""
                              onChange={(e) => {
                                const v = e.target.value
                                if (v) setNewPvId(v)
                              }}
                            >
                              <option value="">— choose offer —</option>
                              {offers.map((o) => (
                                <option key={o.promotion_version_id} value={String(o.promotion_version_id)}>
                                  {o.promotion_name} (pv {o.promotion_version_id})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className={labelCls}>Rebate programme name</label>
                            <input
                              className={inputCls}
                              value={newRebateKey}
                              onChange={(e) => setNewRebateKey(e.target.value)}
                              placeholder="e.g. weekly_cashback"
                            />
                          </div>
                        )}
                      </div>
                      {newBenefitType === 'grant_promotion' ? (
                        <div>
                          <label className={labelCls}>Promotion version ID</label>
                          <input
                            className={inputCls}
                            value={newPvId}
                            onChange={(e) => setNewPvId(e.target.value)}
                            placeholder="Filled when you pick an offer above"
                          />
                          <label className={`${labelCls} mt-2`}>Optional: fixed bonus amount override (minor units)</label>
                          <input className={inputCls} value={newGrantAmt} onChange={(e) => setNewGrantAmt(e.target.value)} />
                        </div>
                      ) : (
                        <div>
                          <label className={labelCls}>Extra percent (whole number)</label>
                          <input className={inputCls} value={newPercentAdd} onChange={(e) => setNewPercentAdd(e.target.value)} />
                        </div>
                      )}
                      <div>
                        <label className={labelCls}>Player title (optional)</label>
                        <input className={inputCls} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelCls}>Player description (optional)</label>
                        <input className={inputCls} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                      </div>
                      <button
                        type="button"
                        onClick={() => void addBenefit()}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-gray-900"
                      >
                        Create benefit
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
