import { useCallback, useEffect, useMemo, useState } from 'react'
import { readApiError, formatApiError } from '../../api/errors'
import { CountryPicker } from '../admin-ui/CountryPicker'
import type { CountryRegion } from '../../lib/countryIsoList'
import { COUNTRY_OPTIONS } from '../../lib/countryIsoList'

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

type VipTier = { id: number; sort_order: number; name: string }

function asSeg(r: Record<string, unknown>) {
  const s = r.segment
  if (s && typeof s === 'object' && !Array.isArray(s)) return s as Record<string, unknown>
  return {}
}

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

type Props = {
  apiFetch: ApiFetch
  rules: unknown
  /** Merge into full rules object (e.g. `{ segment: {...} }`). */
  onPatch: (partial: Record<string, unknown>) => void
  /** Optional: merge into `trigger` for audience shortcuts. */
  onPatchTrigger?: (partial: Record<string, unknown>) => void
}

export default function SegmentTargetingSection({ apiFetch, rules, onPatch, onPatchTrigger }: Props) {
  const r = useMemo(() => (rules && typeof rules === 'object' && !Array.isArray(rules) ? (rules as Record<string, unknown>) : {}), [rules])
  const seg = useMemo(() => asSeg(r), [r])
  const [tiers, setTiers] = useState<VipTier[]>([])
  const [tierErr, setTierErr] = useState<string | null>(null)
  const REGIONS: CountryRegion[] = ['Europe', 'Americas', 'Asia', 'Middle East', 'Oceania', 'Africa']

  const patchSeg = (nextSeg: Record<string, unknown>) => {
    onPatch({ segment: { ...seg, ...nextSeg } })
  }

  const loadTiers = useCallback(async () => {
    setTierErr(null)
    try {
      const res = await apiFetch('/v1/admin/vip/tiers')
      if (!res.ok) {
        const e = await readApiError(res)
        setTierErr(formatApiError(e, `VIP tiers (${res.status})`))
        setTiers([])
        return
      }
      const j = (await res.json()) as { tiers?: VipTier[] }
      setTiers(Array.isArray(j.tiers) ? j.tiers : [])
    } catch {
      setTierErr('Network error')
      setTiers([])
    }
  }, [apiFetch])

  useEffect(() => {
    void loadTiers()
  }, [loadTiers])

  const vipMin = typeof seg.vip_min_tier === 'number' ? seg.vip_min_tier : 0
  const countryAllow = Array.isArray(seg.country_allow) ? (seg.country_allow as string[]) : []
  const countryDeny = Array.isArray(seg.country_deny) ? (seg.country_deny as string[]) : []
  const explicitOnly = !!seg.explicit_targeting_only

  const toggleCountry = (code: string, field: 'allow' | 'deny') => {
    const c = code.toUpperCase()
    const allow = [...countryAllow.map((x) => x.toUpperCase())]
    const deny = [...countryDeny.map((x) => x.toUpperCase())]
    if (field === 'allow') {
      const i = allow.indexOf(c)
      if (i >= 0) allow.splice(i, 1)
      else {
        const j = deny.indexOf(c)
        if (j >= 0) deny.splice(j, 1)
        allow.push(c)
      }
      patchSeg({ country_allow: allow, country_deny: deny })
    } else {
      const i = deny.indexOf(c)
      if (i >= 0) deny.splice(i, 1)
      else {
        const j = allow.indexOf(c)
        if (j >= 0) allow.splice(j, 1)
        deny.push(c)
      }
      patchSeg({ country_allow: allow, country_deny: deny })
    }
  }

  const applyRegionAllow = (region: CountryRegion, add: boolean) => {
    let allow = [...countryAllow.map((x) => x.toUpperCase())]
    let deny = [...countryDeny.map((x) => x.toUpperCase())]
    const codes = COUNTRY_OPTIONS.filter((c) => c.region === region).map((c) => c.code)
    if (add) {
      for (const c of codes) {
        if (!allow.includes(c)) allow.push(c)
        deny = deny.filter((x) => x !== c)
      }
    } else {
      allow = allow.filter((c) => !codes.includes(c))
    }
    patchSeg({ country_allow: allow, country_deny: deny })
  }

  const applyRegionDeny = (region: CountryRegion, add: boolean) => {
    let allow = [...countryAllow.map((x) => x.toUpperCase())]
    let deny = [...countryDeny.map((x) => x.toUpperCase())]
    const codes = COUNTRY_OPTIONS.filter((c) => c.region === region).map((c) => c.code)
    if (add) {
      for (const c of codes) {
        if (!deny.includes(c)) deny.push(c)
        allow = allow.filter((x) => x !== c)
      }
    } else {
      deny = deny.filter((c) => !codes.includes(c))
    }
    patchSeg({ country_allow: allow, country_deny: deny })
  }

  return (
    <div className="space-y-5 rounded-lg border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-900/30">
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Who can receive this (targeting)
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Enforced on <strong>deposit-settled</strong> grants and in simulate when you set player country. VIP uses tier{' '}
          <code className="rounded bg-gray-100 px-1 text-[11px] dark:bg-white/10">sort_order</code> from your VIP table.
          “Churn risk” presets store tags for future automation — only VIP/geo/target lists are enforced by the engine today.
        </p>
      </div>

      <div>
        <span className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">Audience shortcuts</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-gray-600 dark:bg-gray-900"
            onClick={() => {
              patchSeg({
                vip_min_tier: 0,
                country_allow: [],
                country_deny: [],
                explicit_targeting_only: false,
                tags: [],
              })
              onPatchTrigger?.({ first_deposit_only: false, nth_deposit: 0 })
            }}
          >
            Open to all
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-gray-600 dark:bg-gray-900"
            onClick={() => {
              onPatchTrigger?.({ first_deposit_only: true, nth_deposit: 0 })
              patchSeg({ vip_min_tier: 0, explicit_targeting_only: false })
            }}
          >
            New players (first deposit)
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-gray-600 dark:bg-gray-900"
            onClick={() => {
              patchSeg({ tags: ['churn_risk'], vip_min_tier: 0, explicit_targeting_only: false })
              onPatchTrigger?.({ first_deposit_only: false })
            }}
          >
            Tag: churn risk (automation later)
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Minimum VIP tier (sort order ≥)
        </label>
        <select
          className={inputCls}
          value={vipMin > 0 ? String(vipMin) : ''}
          onChange={(e) => {
            const v = e.target.value
            patchSeg({ vip_min_tier: v === '' ? 0 : parseInt(v, 10) || 0 })
          }}
        >
          <option value="">Any VIP level</option>
          {tiers.map((t) => (
            <option key={t.id} value={String(t.sort_order)}>
              {t.name} (order {t.sort_order})
            </option>
          ))}
        </select>
        {tierErr ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{tierErr}</p> : null}
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Countries allowed (empty = any) — region · country · flag
        </span>
        <div className="mb-2 flex flex-wrap gap-1">
          {REGIONS.map((reg) => (
            <span key={`ra-${reg}`} className="inline-flex gap-1">
              <button
                type="button"
                className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-200"
                onClick={() => applyRegionAllow(reg, true)}
              >
                +{reg}
              </button>
              <button
                type="button"
                className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-600"
                onClick={() => applyRegionAllow(reg, false)}
              >
                −{reg}
              </button>
            </span>
          ))}
        </div>
        <CountryPicker
          mode="allow"
          selected={countryAllow}
          onToggle={(code) => toggleCountry(code, 'allow')}
        />
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Countries blocked</span>
        <div className="mb-2 flex flex-wrap gap-1">
          {REGIONS.map((reg) => (
            <span key={`rd-${reg}`} className="inline-flex gap-1">
              <button
                type="button"
                className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
                onClick={() => applyRegionDeny(reg, true)}
              >
                +{reg}
              </button>
              <button
                type="button"
                className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-600"
                onClick={() => applyRegionDeny(reg, false)}
              >
                −{reg}
              </button>
            </span>
          ))}
        </div>
        <CountryPicker
          mode="deny"
          selected={countryDeny}
          onToggle={(code) => toggleCountry(code, 'deny')}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={explicitOnly}
          onChange={(e) => patchSeg({ explicit_targeting_only: e.target.checked })}
          className="mt-1 rounded border-gray-300"
        />
        <span>
          <strong>Explicit targeting only</strong> — grant only to user IDs uploaded under Operations → promotion targets.
          Deposit auto-grants will skip this version until targets exist.
        </span>
      </label>
    </div>
  )
}
