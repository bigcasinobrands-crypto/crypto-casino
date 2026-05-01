import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { ImageUrlField, adminInputCls } from '../components/admin-ui'
import { isLiveForPlayerHub, playerHubVisibilityBadge } from '../lib/bonusHubPlayerHubBadge'

type RulesMap = Record<string, unknown>

type VersionRow = {
  id: number
  version: number
  published: boolean
  bonus_type?: string
  created_at?: string
  valid_from?: string
  valid_to?: string
  priority?: number
  rules?: RulesMap
  terms_text?: string
  player_title?: string
  player_description?: string
  promo_code?: string
  player_hero_image_url?: string
}

type AdminGame = {
  id: string
  title: string
  thumbnail_url: string
  provider?: string
  provider_system?: string
}

function asRec(v: unknown): RulesMap {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as RulesMap) : {}
}

function defaultVersionId(vers: VersionRow[]): number | null {
  if (!vers.length) return null
  const pub = vers.find((v) => v.published)
  if (pub) return pub.id
  return vers[0].id
}

function toDatetimeLocalValue(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocalValue(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

function toUkDateTimeDisplay(localValue: string): string {
  const t = localValue.trim()
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ukDisplayToLocalValue(input: string): string | null {
  const t = input.trim()
  if (!t) return ''
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,T]+(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  let hour = m[4] != null ? parseInt(m[4], 10) : 0
  const minute = m[5] != null ? parseInt(m[5], 10) : 0
  const ampm = m[6]?.toLowerCase()
  if (month < 1 || month > 12 || day < 1 || day > 31 || minute < 0 || minute > 59) return null
  if (ampm) {
    if (hour < 1 || hour > 12) return null
    if (ampm === 'pm' && hour !== 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
  } else if (hour < 0 || hour > 23) {
    return null
  }
  const d = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return null
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

function toMillisOrNullFromISO(iso: string | undefined): number | null {
  if (!iso || !iso.trim()) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

function toMillisOrNullFromLocal(local: string): number | null {
  const t = local.trim()
  if (!t) return null
  const ms = new Date(t).getTime()
  return Number.isNaN(ms) ? null : ms
}

type RecordBaseline = { grantsPaused: boolean; hubForce: boolean; status: string }

type VersionBaseline = {
  vid: number
  playerTitle: string
  playerDescription: string
  playerHero: string
  priority: number
  validFromLocal: string
  validToLocal: string
  termsText: string
}

function gameIdsFromRules(rules: unknown): { allowed: string[]; excluded: string[] } {
  const r = asRec(rules)
  const allowed = Array.isArray(r.allowed_game_ids)
    ? (r.allowed_game_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const excluded = Array.isArray(r.excluded_game_ids)
    ? (r.excluded_game_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return { allowed, excluded }
}

function formatRulesSnapshot(rules: unknown, bonusType: string) {
  const r = asRec(rules)
  const w = asRec(r.wagering)
  const mult = typeof w.multiplier === 'number' ? w.multiplier : null
  const maxBet = typeof w.max_bet_minor === 'number' ? w.max_bet_minor : null
  const gwp = typeof w.game_weight_pct === 'number' ? w.game_weight_pct : null
  const wp = typeof r.withdraw_policy === 'string' ? r.withdraw_policy : '—'

  const seg = asRec(r.segment)
  const trig = asRec(r.trigger)
  const reward = asRec(r.reward)

  const segmentLines: string[] = []
  if (typeof seg.vip_min_tier === 'number' && seg.vip_min_tier > 0) {
    segmentLines.push(`VIP tier ≥ ${seg.vip_min_tier}`)
  }
  if (Array.isArray(seg.tags) && seg.tags.length) {
    segmentLines.push(`Tags: ${(seg.tags as string[]).join(', ')}`)
  }
  if (Array.isArray(seg.country_allow) && seg.country_allow.length) {
    segmentLines.push(`Countries allow: ${(seg.country_allow as string[]).join(', ')}`)
  }
  if (Array.isArray(seg.country_deny) && seg.country_deny.length) {
    segmentLines.push(`Countries deny: ${(seg.country_deny as string[]).join(', ')}`)
  }
  if (seg.explicit_targeting_only === true) {
    segmentLines.push('Explicit targeting only (segment flag)')
  }

  const trigLines: string[] = []
  const ttype = typeof trig.type === 'string' ? trig.type : '—'
  trigLines.push(`Trigger type: ${ttype}`)
  if (trig.first_deposit_only === true) trigLines.push('First deposit only')
  if (typeof trig.nth_deposit === 'number' && trig.nth_deposit > 0) {
    trigLines.push(`Nth deposit: ${trig.nth_deposit}`)
  }
  if (typeof trig.min_minor === 'number' && trig.min_minor > 0) {
    trigLines.push(`Min amount (minor): ${trig.min_minor}`)
  }
  if (typeof trig.max_minor === 'number' && trig.max_minor > 0) {
    trigLines.push(`Max amount (minor): ${trig.max_minor}`)
  }

  const rewardLines: string[] = []
  const rt = typeof reward.type === 'string' ? reward.type : '—'
  rewardLines.push(`Reward type: ${rt}`)
  if (typeof reward.percent === 'number' && reward.percent > 0) rewardLines.push(`Percent: ${reward.percent}%`)
  if (typeof reward.cap_minor === 'number' && reward.cap_minor > 0) rewardLines.push(`Cap (minor): ${reward.cap_minor}`)
  if (typeof reward.fixed_minor === 'number' && reward.fixed_minor > 0) {
    rewardLines.push(`Fixed (minor): ${reward.fixed_minor}`)
  }
  for (const k of Object.keys(reward)) {
    if (['type', 'percent', 'cap_minor', 'fixed_minor'].includes(k)) continue
    const val = reward[k]
    if (val === null || val === undefined || val === '' || val === 0) continue
    if (typeof val === 'object') continue
    rewardLines.push(`${k}: ${String(val)}`)
  }

  return {
    wageringLines: [
      mult != null ? `Multiplier: ×${mult}` : null,
      maxBet != null ? `Max bet while wagering (minor): ${maxBet}` : null,
      gwp != null && gwp !== 100 ? `Game weight: ${gwp}%` : gwp != null ? `Game weight: ${gwp}%` : null,
      `Withdraw policy: ${wp}`,
    ].filter(Boolean) as string[],
    segmentLines,
    trigLines,
    rewardLines,
    bonusType: bonusType || '—',
  }
}

export default function BonusPromotionDetailPage() {
  const { id: idParam } = useParams()
  const promoId = idParam ? parseInt(idParam, 10) : NaN
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const canOperate = isSuper || role === 'admin' || role === 'support'

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [status, setStatus] = useState('')
  const [grantsPaused, setGrantsPaused] = useState(false)
  const [hubForce, setHubForce] = useState(false)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [selectedVid, setSelectedVid] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [gamesById, setGamesById] = useState<Map<string, AdminGame>>(new Map())
  const [targetTotal, setTargetTotal] = useState<number | null>(null)
  const [targetSample, setTargetSample] = useState<string[]>([])

  const [playerTitle, setPlayerTitle] = useState('')
  const [playerDescription, setPlayerDescription] = useState('')
  const [playerHero, setPlayerHero] = useState('')
  const [priority, setPriority] = useState(0)
  const [validFromLocal, setValidFromLocal] = useState('')
  const [validToLocal, setValidToLocal] = useState('')
  const [validFromDisplay, setValidFromDisplay] = useState('')
  const [validToDisplay, setValidToDisplay] = useState('')
  const validFromPickerRef = useRef<HTMLInputElement | null>(null)
  const validToPickerRef = useRef<HTMLInputElement | null>(null)
  const [termsEdit, setTermsEdit] = useState('')

  const [recordBaseline, setRecordBaseline] = useState<RecordBaseline | null>(null)
  const [versionBaseline, setVersionBaseline] = useState<VersionBaseline | null>(null)
  const [saving, setSaving] = useState(false)
  const [cloningVersion, setCloningVersion] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isFinite(promoId) || promoId <= 0) {
      setErr('Invalid promotion id')
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        setVersions([])
        setRecordBaseline(null)
        return
      }
      const j = (await res.json()) as {
        name?: string
        slug?: string
        status?: string
        grants_paused?: boolean
        player_hub_force_visible?: boolean
        created_at?: string
        versions?: VersionRow[]
      }
      setName(j.name ?? '')
      setSlug(j.slug ?? '')
      setStatus((j.status ?? '').toLowerCase())
      setGrantsPaused(!!j.grants_paused)
      setHubForce(!!j.player_hub_force_visible)
      setCreatedAt(j.created_at ?? null)
      setRecordBaseline({
        grantsPaused: !!j.grants_paused,
        hubForce: !!j.player_hub_force_visible,
        status: (j.status ?? '').toLowerCase(),
      })
      const vers = Array.isArray(j.versions) ? j.versions : []
      setVersions(vers)
      setSelectedVid((prev) => {
        if (prev != null && vers.some((v) => v.id === prev)) return prev
        return defaultVersionId(vers)
      })
    } catch {
      setErr('Network error')
      setVersions([])
      setRecordBaseline(null)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, promoId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/v1/admin/games?limit=500')
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { games?: AdminGame[] }
        const m = new Map<string, AdminGame>()
        for (const g of j.games ?? []) {
          if (g?.id) m.set(g.id, g)
        }
        if (!cancelled) setGamesById(m)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  const selected = useMemo(
    () => (selectedVid == null ? null : versions.find((v) => v.id === selectedVid) ?? null),
    [versions, selectedVid],
  )

  useEffect(() => {
    if (!selected) {
      setVersionBaseline(null)
      return
    }
    const pt = (selected.player_title ?? '').trim() || name.trim() || ''
    const pd = selected.player_description ?? ''
    const ph = selected.player_hero_image_url ?? ''
    const pr = typeof selected.priority === 'number' ? selected.priority : 0
    const vf = toDatetimeLocalValue(selected.valid_from)
    const vt = toDatetimeLocalValue(selected.valid_to)
    const tt = selected.terms_text ?? ''
    setPlayerTitle(pt)
    setPlayerDescription(pd)
    setPlayerHero(ph)
    setPriority(pr)
    setValidFromLocal(vf)
    setValidToLocal(vt)
    setTermsEdit(tt)
    setVersionBaseline({
      vid: selected.id,
      playerTitle: pt,
      playerDescription: pd,
      playerHero: ph,
      priority: pr,
      validFromLocal: vf,
      validToLocal: vt,
      termsText: tt,
    })
  }, [selected, name])

  useEffect(() => {
    setValidFromDisplay(toUkDateTimeDisplay(validFromLocal))
  }, [validFromLocal])

  useEffect(() => {
    setValidToDisplay(toUkDateTimeDisplay(validToLocal))
  }, [validToLocal])

  useEffect(() => {
    if (selectedVid == null) {
      setTargetTotal(null)
      setTargetSample([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${selectedVid}/targets?limit=12`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { total?: number; user_ids?: string[] }
        if (cancelled) return
        setTargetTotal(typeof j.total === 'number' ? j.total : null)
        setTargetSample(Array.isArray(j.user_ids) ? j.user_ids : [])
      } catch {
        if (!cancelled) {
          setTargetTotal(null)
          setTargetSample([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch, selectedVid])

  const hasPublishedVersion = useMemo(() => versions.some((v) => v.published), [versions])
  const hubFlags = useMemo(
    () => ({
      status,
      has_published_version: hasPublishedVersion,
      grants_paused: grantsPaused,
    }),
    [status, hasPublishedVersion, grantsPaused],
  )
  const live = isLiveForPlayerHub(hubFlags)
  const badge = playerHubVisibilityBadge(hubFlags)

  const snapshot = useMemo(() => {
    const bt = (selected?.bonus_type ?? '').trim() || '—'
    return formatRulesSnapshot(selected?.rules, bt)
  }, [selected])

  const { allowed: allowedIds, excluded: excludedIds } = useMemo(
    () => gameIdsFromRules(selected?.rules),
    [selected],
  )

  const gameThumbRows = useMemo(() => {
    if (allowedIds.length > 0) {
      return allowedIds.map((id) => ({ id, g: gamesById.get(id), role: 'allowed' as const }))
    }
    if (excludedIds.length > 0) {
      return excludedIds.slice(0, 24).map((id) => ({ id, g: gamesById.get(id), role: 'excluded' as const }))
    }
    return []
  }, [allowedIds, excludedIds, gamesById])

  const recordDirty = useMemo(() => {
    if (!recordBaseline || !canOperate) return false
    return (
      grantsPaused !== recordBaseline.grantsPaused ||
      hubForce !== recordBaseline.hubForce ||
      (isSuper && status !== recordBaseline.status)
    )
  }, [recordBaseline, canOperate, grantsPaused, hubForce, isSuper, status])

  const versionDirty = useMemo(() => {
    if (!isSuper || !versionBaseline || selectedVid == null || versionBaseline.vid !== selectedVid) return false
    const dateDirty =
      toMillisOrNullFromLocal(validFromLocal) !== toMillisOrNullFromISO(selected?.valid_from) ||
      toMillisOrNullFromLocal(validToLocal) !== toMillisOrNullFromISO(selected?.valid_to)
    const termsChanged = selected?.published ? false : termsEdit !== versionBaseline.termsText
    return (
      playerTitle !== versionBaseline.playerTitle ||
      playerDescription !== versionBaseline.playerDescription ||
      playerHero !== versionBaseline.playerHero ||
      priority !== versionBaseline.priority ||
      dateDirty ||
      termsChanged
    )
  }, [
    isSuper,
    versionBaseline,
    selectedVid,
    playerTitle,
    playerDescription,
    playerHero,
    priority,
    validFromLocal,
    validToLocal,
    termsEdit,
    selected?.published,
    selected?.valid_from,
    selected?.valid_to,
  ])

  const hasUnsavedChanges = recordDirty || versionDirty

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
        toast.success('Image uploaded — click Save changes below to persist it on this bonus.')
        return j.url
      } catch {
        toast.error('Upload error')
        return null
      }
    },
    [apiFetch],
  )

  const saveAll = async () => {
    if (!hasUnsavedChanges) return
    if (recordDirty && !canOperate) {
      toast.error('You do not have permission to change promotion settings.')
      return
    }
    if (versionDirty && !isSuper) {
      toast.error('Only superadmin can save version copy, schedule, and terms.')
      return
    }
    setSaving(true)
    try {
      if (recordDirty && canOperate) {
        const body: Record<string, unknown> = {
          grants_paused: grantsPaused,
          player_hub_force_visible: hubForce,
        }
        if (isSuper) {
          body.status = status
        }
        const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const e = await readApiError(res)
          toast.error(formatApiError(e, 'Promotion save failed'))
          return
        }
      }
      if (versionDirty && isSuper && selectedVid != null) {
        const vf = fromDatetimeLocalValue(validFromLocal)
        const vt = fromDatetimeLocalValue(validToLocal)
        const body: Record<string, unknown> = {
          player_title: playerTitle,
          player_description: playerDescription,
          player_hero_image_url: playerHero.trim() || '',
          priority,
        }
        if (vf !== undefined) body.valid_from = vf
        else body.valid_from = ''
        if (vt !== undefined) body.valid_to = vt
        else body.valid_to = ''
        if (!selected?.published) {
          body.terms_text = termsEdit
        }

        const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${selectedVid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const e = await readApiError(res)
          toast.error(formatApiError(e, 'Version save failed'))
          return
        }
      }
      toast.success('Changes saved. Player hub will reflect updates after reload.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const cloneVersionForInlineEdit = async () => {
    if (!isSuper || selectedVid == null) return
    setCloningVersion(true)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${selectedVid}/clone`, {
        method: 'POST',
      })
      if (!res.ok) {
        const e = await readApiError(res)
        toast.error(formatApiError(e, `Clone failed (${res.status})`))
        return
      }
      const j = (await res.json()) as { promotion_version_id?: number }
      const newVid = j.promotion_version_id
      await load()
      if (typeof newVid === 'number' && Number.isFinite(newVid)) {
        setSelectedVid(newVid)
      }
      toast.success('Draft clone created. You can edit terms inline now.')
    } catch {
      toast.error('Network error while cloning version')
    } finally {
      setCloningVersion(false)
    }
  }

  if (!Number.isFinite(promoId) || promoId <= 0) {
    return (
      <>
        <PageMeta title="Bonus Engine · Promotion" description="Promotion overview" />
        <p className="text-secondary small">
          Invalid promotion. <Link to="/bonushub">Back to catalog</Link>
        </p>
      </>
    )
  }

  const btnPrimary =
    'rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50'

  return (
    <>
      <PageMeta title={`Bonus Engine · ${name || 'Promotion'}`} description="Promotion overview, rules snapshot, and edits." />
      <PageBreadcrumb
        pageTitle={loading ? 'Promotion' : name || `Promotion #${promoId}`}
        subtitle="Edit fields across this page, then use Save changes at the bottom to push updates to the API and player hub."
        trail={[{ label: 'Promotions', to: '/bonushub' }]}
      />

      <div className="mb-3 d-flex flex-wrap gap-2 align-items-center">
        <Link to="/bonushub" className="small link-primary">
          ← Back to catalog
        </Link>
        <span className="text-muted small">·</span>
        <Link to={`/bonushub/promotions/${promoId}/delivery`} className="small link-primary">
          Schedule &amp; deliver
        </Link>
        <Link to={`/bonushub/promotions/${promoId}/rules`} className="small link-primary">
          Rules editor
        </Link>
        <Link to={`/bonushub/calendar?promo=${promoId}`} className="small link-primary">
          Calendar
        </Link>
        <Link to="/bonushub/operations" className="small link-primary">
          Operations
        </Link>
      </div>

      {err ? (
        <div className="alert alert-danger small py-2 mb-3" role="alert">
          {err}
        </div>
      ) : null}

      {loading ? (
        <p className="text-secondary small">Loading…</p>
      ) : (
        <div className="row g-3">
          <div className="col-12 col-xl-8 space-y-3">
            <ComponentCard
              title="Overview"
              desc="Identity, hub visibility, and which version you are inspecting."
            >
              <div
                className={`row g-3 ${live ? 'rounded border border-success border-opacity-50 bg-success bg-opacity-10 p-3 m-0' : ''}`}
              >
                <div className="col-md-6">
                  <div className="text-muted small mb-1">Name</div>
                  <div className="fw-semibold text-body">{name || '—'}</div>
                  <div className="text-muted small mt-2 mb-1">Slug</div>
                  <div className="font-monospace small text-body">{slug || '—'}</div>
                </div>
                <div className="col-md-6">
                  <div className="text-muted small mb-1">Promotion ID</div>
                  <div className="font-monospace small">{promoId}</div>
                  <div className="text-muted small mt-2 mb-1">Record status</div>
                  <div className="text-capitalize">{status || '—'}</div>
                  {createdAt ? (
                    <>
                      <div className="text-muted small mt-2 mb-1">Created</div>
                      <div className="small">{new Date(createdAt).toLocaleString('en-GB')}</div>
                    </>
                  ) : null}
                </div>
                <div className="col-12">
                  <div className="text-muted small mb-1">Player hub</div>
                  <span className={`badge ${badge.className}`} title={badge.hint}>
                    {badge.label}
                  </span>
                  {hubForce ? (
                    <span
                      className="badge text-bg-info text-dark ms-2"
                      title="Shown in My Bonuses for all players while on."
                    >
                      Hub boost on
                    </span>
                  ) : (
                    <span className="text-muted small ms-2">Hub boost off</span>
                  )}
                </div>
                <div className="col-12 col-lg-8">
                  <label className="text-muted small d-block mb-1" htmlFor="promo-version-select">
                    Version
                  </label>
                  {versions.length === 0 ? (
                    <p className="small text-warning mb-0">No versions found for this promotion.</p>
                  ) : (
                    <select
                      id="promo-version-select"
                      className={adminInputCls}
                      value={selectedVid ?? ''}
                      onChange={(e) => setSelectedVid(parseInt(e.target.value, 10) || null)}
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version}
                          {v.published ? ' · published' : ' · draft'} · #{v.id}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-muted small mt-2 mb-0">
                    Showing rules, schedule, and copy for the selected version. Use{' '}
                    <Link to={`/bonushub/promotions/${promoId}/rules`}>Rules</Link> to change eligibility, triggers, and
                    economics.
                  </p>
                </div>
              </div>
            </ComponentCard>

            <ComponentCard title="Record controls" desc="Applies to the whole promotion (all versions).">
              <div className="row g-3 align-items-end">
                <div className="col-md-6">
                  <div className="form-check">
                    <input
                      id="grants-paused"
                      type="checkbox"
                      className="form-check-input"
                      checked={grantsPaused}
                      onChange={(e) => setGrantsPaused(e.target.checked)}
                      disabled={!canOperate}
                    />
                    <label className="form-check-label" htmlFor="grants-paused">
                      Grants paused
                    </label>
                  </div>
                  <p className="text-muted small mt-1 mb-0">Stops new grants; existing instances are unchanged.</p>
                </div>
                <div className="col-md-6">
                  <div className="form-check">
                    <input
                      id="hub-force"
                      type="checkbox"
                      className="form-check-input"
                      checked={hubForce}
                      onChange={(e) => setHubForce(e.target.checked)}
                      disabled={!canOperate || grantsPaused}
                    />
                    <label className="form-check-label" htmlFor="hub-force">
                      Force visible in player hub
                    </label>
                  </div>
                  <p className="text-muted small mt-1 mb-0">Boost listing in My Bonuses (respects your role policy).</p>
                </div>
                {isSuper ? (
                  <div className="col-md-6">
                    <label className="text-muted small d-block mb-1" htmlFor="promo-status">
                      Archive
                    </label>
                    <select
                      id="promo-status"
                      className={adminInputCls}
                      value={status === 'archived' ? 'archived' : 'draft'}
                      onChange={(e) => setStatus(e.target.value === 'archived' ? 'archived' : 'draft')}
                    >
                      <option value="draft">Active (draft record)</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                ) : null}
                {!canOperate ? (
                  <div className="col-12">
                    <p className="text-muted small mb-0">Record toggles require admin, support, or superadmin.</p>
                  </div>
                ) : null}
              </div>
            </ComponentCard>

            <ComponentCard
              title="Player-facing copy & schedule"
              desc="What players see and when this version is valid. Deep rule changes stay on the Rules page."
            >
              {!isSuper ? (
                <p className="text-muted small">
                  Only superadmin can edit these fields from this screen. You can still update schedule and copy under{' '}
                  <Link to={`/bonushub/promotions/${promoId}/delivery`}>Schedule &amp; deliver</Link> where your role
                  allows.
                </p>
              ) : null}
              {selected?.published ? (
                <p className="small text-info mb-3">
                  Published version: player title, description, and hero can be updated here. Wagering and terms require a
                  draft version on the Rules page.
                </p>
              ) : (
                <p className="small text-muted mb-3">Draft version: edit rules and terms on the Rules page.</p>
              )}
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="text-muted small d-block mb-1" htmlFor="ptitle">
                    Player title
                  </label>
                  <input
                    id="ptitle"
                    className={adminInputCls}
                    value={playerTitle}
                    onChange={(e) => setPlayerTitle(e.target.value)}
                    disabled={!isSuper}
                  />
                </div>
                <div className="col-md-6">
                  <label className="text-muted small d-block mb-1" htmlFor="pcode">
                    Promo code
                  </label>
                  <input
                    id="pcode"
                    className={adminInputCls}
                    value={selected?.promo_code ?? ''}
                    readOnly
                    disabled
                    title="Change promo code from Operations / version tools when supported."
                  />
                </div>
                <div className="col-12">
                  <label className="text-muted small d-block mb-1" htmlFor="pdesc">
                    Player description
                  </label>
                  <textarea
                    id="pdesc"
                    className={adminInputCls}
                    rows={3}
                    value={playerDescription}
                    onChange={(e) => setPlayerDescription(e.target.value)}
                    disabled={!isSuper}
                  />
                </div>
                <div className="col-12">
                  <ImageUrlField
                    id="phero"
                    label="Promotion image"
                    hint="Shown on player bonus cards when set."
                    value={playerHero}
                    onChange={setPlayerHero}
                    disabled={!isSuper}
                    uploadFile={isSuper ? uploadFile : undefined}
                  />
                </div>
                <div className="col-md-4">
                  <label className="text-muted small d-block mb-1" htmlFor="pri">
                    Priority
                  </label>
                  <input
                    id="pri"
                    type="number"
                    className={adminInputCls}
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                    disabled={!isSuper}
                  />
                </div>
                <div className="col-md-4">
                  <label className="text-muted small d-block mb-1" htmlFor="vf">
                    Valid from (local)
                  </label>
                  <div className="position-relative">
                    <input
                      id="vf"
                      type="text"
                      className={`${adminInputCls} pe-5`}
                      value={validFromDisplay}
                      onChange={(e) => {
                        const raw = e.target.value
                        setValidFromDisplay(raw)
                        const parsed = ukDisplayToLocalValue(raw)
                        if (parsed !== null) setValidFromLocal(parsed)
                      }}
                      onBlur={() => {
                        const parsed = ukDisplayToLocalValue(validFromDisplay)
                        if (parsed === null) {
                          setValidFromDisplay(toUkDateTimeDisplay(validFromLocal))
                          return
                        }
                        setValidFromLocal(parsed)
                      }}
                      placeholder="dd/mm/yyyy hh:mm"
                      disabled={!isSuper}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary position-absolute top-50 end-0 translate-middle-y me-2"
                      disabled={!isSuper}
                      aria-label="Open valid from date/time picker"
                      onClick={() => {
                        const el = validFromPickerRef.current
                        if (!el) return
                        if (typeof el.showPicker === 'function') {
                          el.showPicker()
                        } else {
                          el.focus()
                          el.click()
                        }
                      }}
                    >
                      <i className="bi bi-calendar3" aria-hidden="true" />
                    </button>
                  </div>
                  <input
                    ref={validFromPickerRef}
                    type="datetime-local"
                    className="position-absolute opacity-0 pointer-events-none"
                    tabIndex={-1}
                    aria-hidden="true"
                    value={validFromLocal}
                    onChange={(e) => setValidFromLocal(e.target.value)}
                    style={{ width: 1, height: 1 }}
                  />
                </div>
                <div className="col-md-4">
                  <label className="text-muted small d-block mb-1" htmlFor="vt">
                    Valid to (local)
                  </label>
                  <div className="position-relative">
                    <input
                      id="vt"
                      type="text"
                      className={`${adminInputCls} pe-5`}
                      value={validToDisplay}
                      onChange={(e) => {
                        const raw = e.target.value
                        setValidToDisplay(raw)
                        const parsed = ukDisplayToLocalValue(raw)
                        if (parsed !== null) setValidToLocal(parsed)
                      }}
                      onBlur={() => {
                        const parsed = ukDisplayToLocalValue(validToDisplay)
                        if (parsed === null) {
                          setValidToDisplay(toUkDateTimeDisplay(validToLocal))
                          return
                        }
                        setValidToLocal(parsed)
                      }}
                      placeholder="dd/mm/yyyy hh:mm"
                      disabled={!isSuper}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary position-absolute top-50 end-0 translate-middle-y me-2"
                      disabled={!isSuper}
                      aria-label="Open valid to date/time picker"
                      onClick={() => {
                        const el = validToPickerRef.current
                        if (!el) return
                        if (typeof el.showPicker === 'function') {
                          el.showPicker()
                        } else {
                          el.focus()
                          el.click()
                        }
                      }}
                    >
                      <i className="bi bi-calendar3" aria-hidden="true" />
                    </button>
                  </div>
                  <input
                    ref={validToPickerRef}
                    type="datetime-local"
                    className="position-absolute opacity-0 pointer-events-none"
                    tabIndex={-1}
                    aria-hidden="true"
                    value={validToLocal}
                    onChange={(e) => setValidToLocal(e.target.value)}
                    style={{ width: 1, height: 1 }}
                  />
                </div>
              </div>
            </ComponentCard>
          </div>

          <div className="col-12 col-xl-4 space-y-3">
            <ComponentCard title="Rules snapshot" desc="Read-only summary from the selected version.">
              <div className="small mb-2">
                <span className="text-muted">Bonus type:</span>{' '}
                <span className="font-monospace">{snapshot.bonusType}</span>
              </div>
              <div className="mb-3">
                <div className="fw-semibold small mb-1">Wagering</div>
                <ul className="small mb-0 ps-3">
                  {snapshot.wageringLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="mb-3">
                <div className="fw-semibold small mb-1">Reward</div>
                <ul className="small mb-0 ps-3">
                  {snapshot.rewardLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="mb-3">
                <div className="fw-semibold small mb-1">Trigger</div>
                <ul className="small mb-0 ps-3">
                  {snapshot.trigLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="mb-0">
                <div className="fw-semibold small mb-1">Segment &amp; geo</div>
                {snapshot.segmentLines.length ? (
                  <ul className="small mb-0 ps-3">
                    {snapshot.segmentLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="small text-muted mb-0">No segment restrictions in rules (beyond explicit targets below).</p>
                )}
              </div>
            </ComponentCard>

            <ComponentCard
              title="Games"
              desc={allowedIds.length ? 'Allowed titles for this bonus.' : 'Excluded titles (when not restricted to a list).'}
            >
              {!allowedIds.length && !excludedIds.length ? (
                <p className="small text-muted mb-0">No per-game allow/exclude list on this version.</p>
              ) : (
                <div className="row g-2">
                  {gameThumbRows.map(({ id, g, role }) => (
                    <div key={`${role}-${id}`} className="col-6">
                      <div className="rounded border border-secondary border-opacity-25 overflow-hidden">
                        {g?.thumbnail_url ? (
                          <img src={g.thumbnail_url} alt="" className="w-100 object-cover" style={{ height: 72 }} />
                        ) : (
                          <div
                            className="d-flex align-items-center justify-content-center bg-secondary bg-opacity-10 small text-muted"
                            style={{ height: 72 }}
                          >
                            No art
                          </div>
                        )}
                        <div className="p-2 small">
                          <div className="text-truncate" title={g?.title ?? id}>
                            {g?.title ?? id}
                          </div>
                          <div className="text-muted text-truncate" style={{ fontSize: '0.7rem' }}>
                            {g?.provider_system?.trim()
                              ? `${g.provider_system} · `
                              : g?.provider
                                ? `${g.provider} · `
                                : ''}
                            {id}
                          </div>
                          <span className={`badge ${role === 'allowed' ? 'text-bg-success' : 'text-bg-warning'} mt-1`}>
                            {role === 'allowed' ? 'Allowed' : 'Excluded'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ComponentCard>

            <ComponentCard title="Targeting" desc="Explicit user list attached to this version (if any).">
              {targetTotal != null && targetTotal > 0 ? (
                <>
                  <p className="small mb-2">
                    <strong>{targetTotal}</strong> targeted player{targetTotal === 1 ? '' : 's'}. Manage lists from{' '}
                    <Link to={`/bonushub/promotions/${promoId}/delivery`}>Schedule &amp; deliver</Link>.
                  </p>
                  <div className="font-monospace small text-break">
                    {targetSample.slice(0, 8).join(', ')}
                    {targetTotal > targetSample.length ? ' …' : ''}
                  </div>
                </>
              ) : (
                <p className="small text-muted mb-0">
                  No explicit CSV targets on this version. Eligibility follows segment rules and triggers above.
                </p>
              )}
            </ComponentCard>

            <ComponentCard
              title="Terms"
              desc={
                selected?.published
                  ? 'Published versions are locked. Clone to a draft and edit terms directly here.'
                  : 'Draft version: edit below, then Save changes at the bottom.'
              }
            >
              {isSuper && selected && !selected.published ? (
                <textarea
                  id="terms-draft"
                  className={adminInputCls}
                  rows={10}
                  value={termsEdit}
                  onChange={(e) => setTermsEdit(e.target.value)}
                  placeholder="Terms & conditions shown to players…"
                />
              ) : selected?.terms_text?.trim() ? (
                <pre className="small mb-0 text-body" style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>
                  {selected.terms_text}
                </pre>
              ) : (
                <p className="small text-muted mb-0">No terms text on this version.</p>
              )}
              {isSuper && selected?.published ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mt-2"
                  onClick={() => void cloneVersionForInlineEdit()}
                  disabled={cloningVersion}
                >
                  {cloningVersion ? 'Cloning…' : 'Clone to draft & edit here'}
                </button>
              ) : null}
            </ComponentCard>
          </div>

          <div className="col-12">
            <div className="card border-secondary border-opacity-50 shadow-sm">
              <div className="card-body d-flex flex-column flex-md-row align-items-stretch align-items-md-center justify-content-between gap-3">
                <div className="small">
                  {hasUnsavedChanges ? (
                    <span className="text-warning-emphasis">
                      You have unsaved changes. Updates are not sent to the server or shown to players until you save.
                    </span>
                  ) : (
                    <span className="text-muted">No pending edits for this promotion.</span>
                  )}
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-center justify-content-md-end">
                  {hasUnsavedChanges ? <span className="badge text-bg-warning text-dark">Unsaved</span> : null}
                  <button
                    type="button"
                    className={`${btnPrimary} px-4 py-2`}
                    onClick={() => void saveAll()}
                    disabled={!hasUnsavedChanges || saving}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
