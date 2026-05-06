import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { formatApiError } from '../../api/errors'
import {
  generateChallengeRules,
  generateChallengeTerms,
  getPlayerTermsPageUrl,
  type ChallengeRulesTermsGenContext,
} from '../../lib/challengeRulesTermsGenerate'
import { adminApiUrl } from '../../lib/adminApiUrl'
import { ImageUrlField } from '../admin-ui/ImageUrlField'
import {
  FALLBACK_PAYOUT_ASSETS,
  type DepositAsset,
  parsePayoutOptionsPayload,
} from './payoutOptionsShared'
import { PayoutAssetDropdown } from './PayoutAssetDropdown'

const MULT_MIN = 2
const MULT_MAX = 1000

function errBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) return { code: err.code, message: err.message ?? '', status }
  }
  return null
}

function parseUsdToMinor(s: string): number | null {
  const n = Number(String(s).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function numFromNumeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function toLocalFromRFC3339(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(s: string): string | null {
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString()
}

type GameRow = {
  id: string
  title: string
  thumbnail_url?: string | null
  provider: string
  provider_system?: string
}

type VIPTierRow = {
  id: number
  name: string
  sort_order: number
}

function uniqGameIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const t = id.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Parses postgres `{id1,id2}` literals from API responses that are not JSON arrays. */
function parsePostgresTextArrayIds(s: string): string[] {
  const t = s.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return []
  const inner = t.slice(1, -1).trim()
  if (!inner) return []
  const parts: string[] = []
  let buf = ''
  let inQuote = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c === '"') {
      inQuote = !inQuote
      continue
    }
    if (c === ',' && !inQuote) {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += c
  }
  parts.push(buf.trim())
  const out: string[] = []
  for (const p of parts) {
    const id = p.replace(/^"|"$/g, '').trim()
    if (id) out.push(id)
  }
  return uniqGameIds(out)
}

function parseGameIdsFromMeta(j: Record<string, unknown>): string[] {
  const raw = j.game_ids
  if (raw == null) return []
  if (Array.isArray(raw)) {
    const out: string[] = []
    for (const x of raw) {
      if (typeof x === 'string' && x.trim()) out.push(x.trim())
      else if (typeof x === 'number' && Number.isFinite(x)) out.push(String(Math.trunc(x)))
    }
    return uniqGameIds(out)
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t || t === '{}') return []
    if (t.startsWith('[')) {
      try {
        const a = JSON.parse(t) as unknown
        if (Array.isArray(a)) {
          const rec: Record<string, unknown> = { ...j, game_ids: a }
          return parseGameIdsFromMeta(rec)
        }
      } catch {
        /* fall through */
      }
    }
    if (t.startsWith('{') && t.endsWith('}')) return parsePostgresTextArrayIds(t)
  }
  return []
}

function findGameById(games: GameRow[], id: string): GameRow | undefined {
  const t = id.trim()
  return games.find((g) => g.id === t || g.id.trim() === t)
}

/** Current catalog row, else cached metadata for selected games not matching the active search. */
function resolveGame(
  games: GameRow[],
  cache: Record<string, GameRow>,
  id: string,
): GameRow | undefined {
  const fromList = findGameById(games, id)
  if (fromList) return fromList
  const t = id.trim()
  const byKey = cache[t] ?? cache[id]
  if (byKey) return byKey
  return Object.values(cache).find((g) => g.id === t || g.id.trim() === t)
}

function catalogThumb(g: GameRow | undefined): string {
  const u = g?.thumbnail_url
  return typeof u === 'string' ? u.trim() : ''
}

function resolveThumb(url: string): string {
  const t = url.trim()
  if (!t) return ''
  if (t.startsWith('//')) return `https:${t}`
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return adminApiUrl(t.startsWith('/') ? t : `/${t}`)
}

export function ChallengeEditModal({
  challengeId,
  apiFetch,
  isSuper,
  onClose,
  onSaved,
}: {
  challengeId: string
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isSuper: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [ctype, setCtype] = useState<'multiplier' | 'wager_volume'>('multiplier')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
  const [terms, setTerms] = useState('')
  const [heroUrl, setHeroUrl] = useState('')
  const [heroManual, setHeroManual] = useState(false)
  const [badgeLabel, setBadgeLabel] = useState('')
  const [isFeatured, setIsFeatured] = useState(false)
  const [status, setStatus] = useState('draft')
  const [prizeUsd, setPrizeUsd] = useState('0')
  const [minBetUsd, setMinBetUsd] = useState('0')
  const [targetMult, setTargetMult] = useState(100)
  const [targetWagerUsd, setTargetWagerUsd] = useState('500')
  const [maxWinners, setMaxWinners] = useState('1')
  const [startsLocal, setStartsLocal] = useState('')
  const [endsLocal, setEndsLocal] = useState('')

  const [meta, setMeta] = useState<Record<string, unknown> | null>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Rows for selected ids when they are not in the current search results (never merged into `games`). */
  const [selectedGameCache, setSelectedGameCache] = useState<Record<string, GameRow>>({})
  const [games, setGames] = useState<GameRow[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [gameSearch, setGameSearch] = useState('')
  const [gameSearchDebounced, setGameSearchDebounced] = useState('')
  const [studioFilter, setStudioFilter] = useState('')
  const [studioCatalog, setStudioCatalog] = useState<string[]>([])

  const [vipTiers, setVipTiers] = useState<VIPTierRow[]>([])
  const [vipAudience, setVipAudience] = useState<string>('all')
  const [depositAssets, setDepositAssets] = useState<DepositAsset[]>(FALLBACK_PAYOUT_ASSETS)
  const [payoutAssetKey, setPayoutAssetKey] = useState(
    () => FALLBACK_PAYOUT_ASSETS.find((a) => a.symbol === 'USDT')?.key ?? FALLBACK_PAYOUT_ASSETS[0]?.key ?? '',
  )

  const prizeCurrency = useMemo(() => {
    const a = depositAssets.find((x) => x.key === payoutAssetKey)
    return (a?.symbol ?? 'USDT').trim() || 'USDT'
  }, [depositAssets, payoutAssetKey])

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await apiFetch('/v1/admin/content/upload', { method: 'POST', body: fd })
        const j = (await res.json().catch(() => null)) as { url?: string } | null
        if (!res.ok || !j?.url) {
          toast.error('Upload failed')
          return null
        }
        toast.success('Image uploaded')
        return j.url
      } catch {
        toast.error('Upload failed')
        return null
      }
    },
    [apiFetch],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/v1/admin/vip/tiers')
        const j = (await res.json().catch(() => null)) as { tiers?: VIPTierRow[] } | null
        if (!cancelled && res.ok && j?.tiers) {
          setVipTiers([...j.tiers].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/v1/admin/payments/payout-options')
        const body = (await res.json().catch(() => null)) as unknown
        const parsed = parsePayoutOptionsPayload(body)
        if (cancelled) return
        if (!res.ok) {
          setDepositAssets(FALLBACK_PAYOUT_ASSETS)
          setPayoutAssetKey((prev) => {
            if (prev && FALLBACK_PAYOUT_ASSETS.some((a) => a.key === prev)) return prev
            return FALLBACK_PAYOUT_ASSETS.find((a) => a.symbol === 'USDT')?.key ?? FALLBACK_PAYOUT_ASSETS[0]?.key ?? ''
          })
          return
        }
        const list = parsed.length > 0 ? parsed : FALLBACK_PAYOUT_ASSETS
        setDepositAssets(list)
        setPayoutAssetKey((prev) => {
          if (prev && list.some((a) => a.key === prev)) return prev
          const usdt = list.find((a) => a.symbol === 'USDT') ?? list[0]
          return usdt?.key ?? ''
        })
      } catch {
        if (!cancelled) {
          setDepositAssets(FALLBACK_PAYOUT_ASSETS)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  useEffect(() => {
    const t = window.setTimeout(() => setGameSearchDebounced(gameSearch), 320)
    return () => window.clearTimeout(t)
  }, [gameSearch])

  const loadGames = useCallback(async () => {
    setGamesLoading(true)
    try {
      const q = new URLSearchParams()
      q.set('limit', '1200')
      if (gameSearchDebounced.trim()) q.set('q', gameSearchDebounced.trim())
      if (studioFilter.trim()) q.set('provider', studioFilter.trim())
      const res = await apiFetch(`/v1/admin/games?${q.toString()}`)
      const j = (await res.json().catch(() => null)) as { games?: GameRow[] } | null
      if (!res.ok || !j?.games) {
        setGames([])
        return
      }
      setGames(j.games)
    } catch {
      setGames([])
    } finally {
      setGamesLoading(false)
    }
  }, [apiFetch, gameSearchDebounced, studioFilter])

  useEffect(() => {
    void loadGames()
  }, [loadGames])

  useEffect(() => {
    if (games.length === 0) return
    setStudioCatalog((prev) => {
      const s = new Set(prev)
      for (const g of games) {
        const st = (g.provider_system ?? '').trim()
        if (st) s.add(st)
      }
      return [...s].sort((a, b) => a.localeCompare(b))
    })
  }, [games])

  useEffect(() => {
    setSelectedGameCache((prev) => {
      const next: Record<string, GameRow> = { ...prev }
      for (const id of selectedIds) {
        const g = findGameById(games, id)
        if (g) next[g.id] = g
      }
      for (const k of Object.keys(next)) {
        if (!selectedIds.some((id) => id === k || id.trim() === k.trim())) delete next[k]
      }
      return next
    })
  }, [selectedIds, games])

  useEffect(() => {
    if (loading || gamesLoading || selectedIds.length === 0) return
    const missing = selectedIds.filter((id) => !resolveGame(games, selectedGameCache, id))
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const extra: GameRow[] = []
      const seen = new Set<string>()
      for (const id of missing) {
        try {
          const res = await apiFetch(`/v1/admin/games?limit=50&q=${encodeURIComponent(id)}`)
          const j = (await res.json().catch(() => null)) as { games?: GameRow[] } | null
          if (!res.ok || !j?.games) continue
          for (const g of j.games) {
            if (!seen.has(g.id)) {
              seen.add(g.id)
              extra.push(g)
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled && extra.length > 0) {
        setSelectedGameCache((prev) => {
          const next = { ...prev }
          for (const row of extra) next[row.id] = row
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, gamesLoading, selectedIds, games, selectedGameCache, apiFetch])

  useEffect(() => {
    if (heroManual) return
    if (selectedIds.length !== 1) return
    const g = resolveGame(games, selectedGameCache, selectedIds[0] ?? '')
    const u = catalogThumb(g)
    if (!u) return
    setHeroUrl((prev) => (prev.trim() ? prev : u))
  }, [selectedIds, games, selectedGameCache, heroManual])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadErr(null)
      setLoading(true)
      setSelectedGameCache({})
      try {
        const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(challengeId)}`)
        const j = (await res.json().catch(() => null)) as Record<string, unknown> | null
        if (cancelled) return
        if (!res.ok) {
          setLoadErr(formatApiError(errBody(res.status, j), 'Load failed'))
          return
        }
        if (!j) {
          setLoadErr('Invalid response')
          return
        }
        setMeta(j)
        setSlug(str(j.slug))
        setTitle(str(j.title))
        const ct = str(j.challenge_type)
        setCtype(ct === 'wager_volume' ? 'wager_volume' : 'multiplier')
        setDescription(str(j.description))
        setRules(str(j.rules))
        setTerms(str(j.terms))
        const hero = str(j.hero_image_url).trim()
        setHeroUrl(hero)
        setHeroManual(hero.length > 0)
        setBadgeLabel(str(j.badge_label))
        setIsFeatured(j.is_featured === true)
        setStatus(str(j.status) || 'draft')
        setSelectedIds(parseGameIdsFromMeta(j))

        const tm = numFromNumeric(j.target_multiplier)
        if (tm != null) {
          setTargetMult(Math.min(MULT_MAX, Math.max(MULT_MIN, Math.round(tm))))
        } else {
          setTargetMult(100)
        }
        const twMinor = num(j.target_wager_amount_minor)
        setTargetWagerUsd(twMinor != null ? (twMinor / 100).toFixed(2) : '500')

        const pm = num(j.prize_amount_minor)
        setPrizeUsd(pm != null ? (pm / 100).toFixed(2) : '0')
        const mm = num(j.min_bet_amount_minor)
        setMinBetUsd(mm != null ? (mm / 100).toFixed(2) : '0')

        const mxw = num(j.max_winners)
        setMaxWinners(mxw != null && mxw >= 1 ? String(Math.trunc(mxw)) : '1')

        const sa = str(j.starts_at)
        const ea = str(j.ends_at)
        setStartsLocal(sa ? toLocalFromRFC3339(sa) : '')
        setEndsLocal(ea ? toLocalFromRFC3339(ea) : '')

        const payoutKey = str(j.prize_payout_asset_key)
        if (payoutKey) {
          setPayoutAssetKey(payoutKey)
        }

        const vipOnly = j.vip_only === true
        const vtm = j.vip_tier_minimum
        const vtStr = vtm == null ? '' : String(vtm).trim()
        setVipAudience(vipOnly && vtStr ? vtStr : 'all')
      } catch {
        if (!cancelled) setLoadErr('Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch, challengeId])

  const playerTermsPageUrl = useMemo(() => getPlayerTermsPageUrl(), [])

  const getRulesTermsContext = useCallback((): ChallengeRulesTermsGenContext => {
    const tierLine =
      vipAudience === 'all'
        ? ''
        : `Only players at ${vipTiers.find((t) => String(t.id) === vipAudience)?.name ?? 'the selected'} VIP tier and above may enter.`
    const gameNote =
      selectedIds.length === 0
        ? 'selected games'
        : selectedIds.length === 1
          ? resolveGame(games, selectedGameCache, selectedIds[0] ?? '')?.title ?? 'this game'
          : 'the selected games'
    const pay =
      depositAssets.find((a) => a.key === payoutAssetKey)?.label ??
      (payoutAssetKey ? payoutAssetKey : prizeCurrency)
    return {
      challengeType: ctype,
      targetMult,
      targetWagerUsd,
      minBetUsd,
      maxWinners,
      gameNote,
      payLabel: pay,
      prizeCurrency,
      vipEligibilityLine: tierLine || undefined,
    }
  }, [
    vipAudience,
    vipTiers,
    selectedIds,
    games,
    selectedGameCache,
    depositAssets,
    payoutAssetKey,
    prizeCurrency,
    ctype,
    targetMult,
    targetWagerUsd,
    minBetUsd,
    maxWinners,
  ])

  const generateRulesFromParams = () => setRules(generateChallengeRules(getRulesTermsContext()))
  const generateTermsFromParams = () =>
    setTerms(generateChallengeTerms(playerTermsPageUrl, getRulesTermsContext()))

  const getGeneratedDescription = useCallback((): string => {
    const tierNote =
      vipAudience === 'all'
        ? ''
        : ` ${vipTiers.find((t) => String(t.id) === vipAudience)?.name ?? 'VIP'} tier and above only.`
    const gameNote =
      selectedIds.length === 0
        ? 'selected games'
        : selectedIds.length === 1
          ? resolveGame(games, selectedGameCache, selectedIds[0] ?? '')?.title ?? 'this game'
          : 'the selected games'
    const pay =
      depositAssets.find((a) => a.key === payoutAssetKey)?.label ??
      (payoutAssetKey ? payoutAssetKey : prizeCurrency)
    if (ctype === 'multiplier') {
      return `Land any winning spin of at least ${targetMult}× your stake on ${gameNote}. Minimum bet applies. Cash prize in ${pay} via the credited wallet balance.${tierNote}`
    }
    const w = targetWagerUsd.trim() || '0'
    return `Wager a total of $${w} (qualifying stakes) on ${gameNote} during the challenge window. Minimum bet per round applies. Prize paid in ${pay} equivalent to your wallet rules.${tierNote}`
  }, [
    vipAudience,
    vipTiers,
    selectedIds,
    games,
    selectedGameCache,
    depositAssets,
    payoutAssetKey,
    prizeCurrency,
    ctype,
    targetMult,
    targetWagerUsd,
  ])

  const generateDescription = () => setDescription(getGeneratedDescription())

  const setMultClamped = (n: number) => {
    if (!Number.isFinite(n)) return
    setTargetMult(Math.min(MULT_MAX, Math.max(MULT_MIN, Math.round(n))))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isSuper) return
    if (selectedIds.length < 1) {
      toast.error('Select at least one qualifying game.')
      return
    }
    if (selectedIds.length > 1 && !heroUrl.trim()) {
      toast.error('Upload or paste a thumbnail when more than one game is selected.')
      return
    }
    const ptype = str(meta?.prize_type)
    const minMinor = parseUsdToMinor(minBetUsd)
    if (minMinor == null || minMinor <= 0) {
      toast.error('Enter a valid minimum bet (USD).')
      return
    }
    const startsAt = fromLocalInputValue(startsLocal)
    const endsAt = fromLocalInputValue(endsLocal)
    if (!startsAt || !endsAt) {
      toast.error('Invalid start or end date.')
      return
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      toast.error('End time must be after start time.')
      return
    }
    const mw = Number.parseInt(maxWinners, 10)
    if (!Number.isFinite(mw) || mw < 1) {
      toast.error('Max winners must be at least 1.')
      return
    }

    const vipOnly = vipAudience !== 'all'
    let vipTierMin: number | undefined
    if (vipOnly) {
      const idn = Number.parseInt(vipAudience, 10)
      if (!Number.isFinite(idn)) {
        toast.error('Select a VIP tier or “All players”.')
        return
      }
      vipTierMin = idn
    }

    const body: Record<string, unknown> = {
      slug: slug.trim(),
      title: title.trim(),
      challenge_type: ctype,
      description: description.trim(),
      rules: rules.trim(),
      terms: terms.trim(),
      hero_image_url: heroUrl.trim(),
      badge_label: badgeLabel.trim(),
      is_featured: isFeatured,
      status,
      require_claim_for_prize: true,
      min_bet_amount_minor: minMinor,
      game_ids: selectedIds,
      max_winners: mw,
      starts_at: startsAt,
      ends_at: endsAt,
      prize_currency: prizeCurrency,
      vip_only: vipOnly,
      ...(vipOnly && vipTierMin != null ? { vip_tier_minimum: vipTierMin } : {}),
    }
    if (payoutAssetKey.trim()) {
      body.prize_payout_asset_key = payoutAssetKey.trim()
    }

    if (ptype === 'cash') {
      const prizeMinor = parseUsdToMinor(prizeUsd)
      if (prizeMinor == null || prizeMinor <= 0) {
        toast.error('Enter a valid prize amount (USD).')
        return
      }
      body.prize_amount_minor = prizeMinor
    }

    if (ctype === 'multiplier') {
      if (targetMult < MULT_MIN || targetMult > MULT_MAX) {
        toast.error(`Multiplier must be between ${MULT_MIN}× and ${MULT_MAX}×.`)
        return
      }
      body.target_multiplier = targetMult
    } else {
      const tw = parseUsdToMinor(targetWagerUsd)
      if (tw == null || tw <= 0) {
        toast.error('Enter a valid target wager total (USD).')
        return
      }
      body.target_wager_amount_minor = tw
    }

    setSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(challengeId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(formatApiError(errBody(res.status, j), 'Save failed'))
        return
      }
      toast.success('Challenge updated')
      onSaved()
      onClose()
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const toggleGame = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          toast.info('A challenge needs at least one qualifying game — add another before removing this one.')
          return prev
        }
        return uniqGameIds(prev.filter((x) => x !== id))
      }
      return uniqGameIds([...prev, id])
    })
  }

  const applyFirstGameThumbnail = () => {
    if (selectedIds.length < 1) {
      toast.info('Select at least one qualifying game.')
      return
    }
    for (const sid of selectedIds) {
      const g = resolveGame(games, selectedGameCache, sid)
      const u = catalogThumb(g)
      if (u) {
        setHeroManual(true)
        setHeroUrl(u)
        const label = g?.title?.trim() || sid
        toast.success(`Thumbnail URL set from catalog (${label}).`)
        return
      }
    }
    void (async () => {
      for (const sid of selectedIds) {
        try {
          const res = await apiFetch(`/v1/admin/games?limit=20&q=${encodeURIComponent(sid)}`)
          const j = (await res.json().catch(() => null)) as { games?: GameRow[] } | null
          const row = j?.games?.find((x) => x.id === sid || x.id.trim() === sid.trim())
          const u = catalogThumb(row)
          if (u && row) {
            setHeroManual(true)
            setHeroUrl(u)
            setSelectedGameCache((prev) => ({ ...prev, [row.id]: row }))
            toast.success(`Thumbnail URL set from catalog (${row?.title ?? sid}).`)
            return
          }
        } catch {
          /* try next */
        }
      }
      toast.error('No catalog thumbnail found for the selected game(s). Upload an image or paste a URL.')
    })()
  }

  const tHero = heroUrl.trim()
  const heroPreview = tHero
    ? tHero.startsWith('//')
      ? `https:${tHero}`
      : tHero.startsWith('http://') || tHero.startsWith('https://')
        ? tHero
        : adminApiUrl(tHero.startsWith('/') ? tHero : `/${tHero}`)
    : ''

  return (
    <form onSubmit={submit}>
      {loadErr ? <div className="alert alert-danger py-2 small">{loadErr}</div> : null}
      {loading ? <p className="text-secondary small mb-0">Loading…</p> : null}

      {!loading && meta ? (
        <>
          <div className="row g-3">
            <div className="col-md-5">
              <div
                className="rounded border border-secondary overflow-hidden bg-black ratio"
                style={{ aspectRatio: '3 / 4', maxHeight: 320 }}
              >
                {heroPreview ? (
                  <img src={heroPreview} alt="" className="w-100 h-100" style={{ objectFit: 'cover' }} />
                ) : (
                  <div className="d-flex w-100 h-100 align-items-center justify-content-center text-secondary small">
                    No thumbnail
                  </div>
                )}
              </div>
            </div>
            <div className="col-md-7">
              <label className="form-label small text-secondary mb-1">Thumbnail</label>
              <ImageUrlField
                label=""
                hint={
                  selectedIds.length > 1
                    ? 'Required when multiple games are selected.'
                    : 'Optional when a single game is selected; can copy from catalog below.'
                }
                value={heroUrl}
                onChange={(u) => {
                  setHeroManual(true)
                  setHeroUrl(u)
                }}
                disabled={!isSuper || saving}
                uploadFile={uploadFile}
              />
              <div className="form-check mt-2 mb-0">
                <input
                  id="heroManualEdit"
                  type="checkbox"
                  className="form-check-input"
                  checked={heroManual}
                  onChange={(e) => {
                    setHeroManual(e.target.checked)
                    if (!e.target.checked) setHeroUrl('')
                  }}
                  disabled={!isSuper || saving}
                />
                <label htmlFor="heroManualEdit" className="form-check-label small">
                  Set thumbnail manually (override game art)
                </label>
              </div>
              {selectedIds.length > 0 ? (
                <div className="mt-2 small text-secondary">
                  <span className="text-body fw-semibold">{selectedIds.length}</span> qualifying game
                  {selectedIds.length === 1 ? '' : 's'} selected — see <strong className="text-body">Selected games</strong>{' '}
                  under the catalog.
                </div>
              ) : (
                <div className="mt-2 small text-warning">No games linked — pick at least one in Qualifying games below.</div>
              )}
            </div>
          </div>

          <hr className="border-secondary my-3" />

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">Challenge basics</div>
            <div className="row g-2">
              <div className="col-md-8">
                <label className="form-label small text-secondary mb-1">Title</label>
                <input
                  className="form-control form-control-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={!isSuper || saving}
                  required
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-secondary mb-1">Slug</label>
                <input
                  className="form-control form-control-sm font-monospace"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!isSuper || saving}
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Challenge type</label>
                <select
                  className="form-select form-select-sm"
                  value={ctype}
                  onChange={(e) => setCtype(e.target.value as 'multiplier' | 'wager_volume')}
                  disabled={!isSuper || saving}
                >
                  <option value="multiplier">Multiplier hit (e.g. 100× win)</option>
                  <option value="wager_volume">Total amount wagered</option>
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Badge (optional)</label>
                <input
                  className="form-control form-control-sm"
                  value={badgeLabel}
                  onChange={(e) => setBadgeLabel(e.target.value)}
                  disabled={!isSuper || saving}
                  placeholder="FEATURED"
                />
              </div>
              <div className="col-12">
                <div className="form-check mb-0">
                  <input
                    id="featuredEdit"
                    type="checkbox"
                    className="form-check-input"
                    checked={isFeatured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                    disabled={!isSuper || saving}
                  />
                  <label htmlFor="featuredEdit" className="form-check-label small">
                    Featured on player discovery
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">Audience</div>
            <label className="form-label text-secondary small mb-1">VIP tier</label>
            <select
              className="form-select form-select-sm"
              value={vipAudience}
              onChange={(e) => setVipAudience(e.target.value)}
              disabled={!isSuper || saving}
            >
              <option value="all">All players</option>
              {vipTiers.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name} and higher tiers
                </option>
              ))}
            </select>
            <p className="text-secondary small mt-2 mb-0">
              Only players at or above the selected tier may enter (by VIP ladder order).
            </p>
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">Qualifying games</div>
            <p className="text-secondary small mb-2">
              Only play on these titles counts. Changing games updates eligibility for new bets.
            </p>
            <div className="row g-2 mb-2">
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Search title, ID, studio, or integration</label>
                <input
                  className="form-control form-control-sm"
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                  placeholder="Search…"
                  disabled={!isSuper || saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Filter studio</label>
                <select
                  className="form-select form-select-sm"
                  value={studioFilter}
                  onChange={(e) => setStudioFilter(e.target.value)}
                  disabled={!isSuper || saving}
                >
                  <option value="">All studios</option>
                  {studioCatalog.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {isSuper ? (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary mb-2"
                onClick={applyFirstGameThumbnail}
                disabled={saving || selectedIds.length < 1}
              >
                Use catalog thumbnail from selected game(s)
              </button>
            ) : null}
            {gamesLoading ? (
              <p className="text-secondary small mb-0">Loading games…</p>
            ) : (
              <div
                className="border border-secondary rounded p-2 bg-body"
                style={{ maxHeight: 240, overflowY: 'auto' }}
              >
                {games.length === 0 ? (
                  <span className="text-secondary small">No games match. Sync catalog or widen search.</span>
                ) : (
                  <ul className="list-unstyled mb-0">
                    {games.map((g) => {
                      const thumb = resolveThumb(g.thumbnail_url ?? '')
                      const sel = selectedIds.includes(g.id)
                      return (
                        <li key={g.id} className="mb-2">
                          <label className="d-flex align-items-center gap-2 mb-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => {
                                if (!sel) {
                                  setSelectedGameCache((prev) => ({ ...prev, [g.id]: g }))
                                }
                                toggleGame(g.id)
                              }}
                              disabled={!isSuper || saving}
                            />
                            <span
                              className="rounded border flex-shrink-0 overflow-hidden bg-black"
                              style={{ width: 40, height: 40 }}
                            >
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt=""
                                  className="w-100 h-100"
                                  style={{ objectFit: 'cover' }}
                                  loading="lazy"
                                />
                              ) : (
                                <span className="d-flex w-100 h-100 align-items-center justify-content-center text-muted small">
                                  —
                                </span>
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="d-block fw-medium text-truncate" title={g.title}>
                                {g.title}
                              </span>
                              <span className="d-block text-secondary font-monospace" style={{ fontSize: '0.7rem' }}>
                                {g.id}
                                {g.provider_system?.trim() || g.provider
                                  ? ` · ${g.provider_system?.trim() || g.provider}`
                                  : ''}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-3 pt-3 border-top border-secondary">
              <div className="fw-semibold small mb-2">Selected games</div>
              {selectedIds.length === 0 ? (
                <p className="text-secondary small mb-0">No games selected yet — use the checklist above.</p>
              ) : (
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  {selectedIds.map((id) => {
                    const g = resolveGame(games, selectedGameCache, id)
                    const thumb = g ? resolveThumb(g.thumbnail_url ?? '') : ''
                    return (
                      <li
                        key={id}
                        className="d-flex align-items-center gap-2 rounded border border-secondary bg-body px-2 py-2"
                      >
                        <span
                          className="rounded border flex-shrink-0 overflow-hidden bg-black"
                          style={{ width: 40, height: 40 }}
                        >
                          {thumb ? (
                            <img
                              src={thumb}
                              alt=""
                              className="w-100 h-100"
                              style={{ objectFit: 'cover' }}
                              loading="lazy"
                            />
                          ) : (
                            <span className="d-flex w-100 h-100 align-items-center justify-content-center text-muted small">
                              —
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-grow-1">
                          <span className="d-block fw-medium text-truncate" title={g?.title ?? id}>
                            {g?.title ?? id}
                          </span>
                          <span className="d-block text-secondary font-monospace" style={{ fontSize: '0.7rem' }}>
                            {g
                              ? `${g.id}${g.provider_system?.trim() || g.provider ? ` · ${g.provider_system?.trim() || g.provider}` : ''}`
                              : 'Not in current search — still linked'}
                          </span>
                        </span>
                        {isSuper ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary flex-shrink-0"
                            onClick={() => toggleGame(id)}
                            disabled={saving}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">{ctype === 'multiplier' ? 'Multiplier goal' : 'Wager goal'}</div>
            {ctype === 'multiplier' ? (
              <>
                <label className="form-label small text-secondary mb-1">Target multiplier</label>
                <div className="d-flex flex-wrap align-items-center gap-3 mb-2">
                  <input
                    type="range"
                    className="form-range flex-grow-1"
                    style={{ maxWidth: 420 }}
                    min={MULT_MIN}
                    max={MULT_MAX}
                    step={1}
                    value={targetMult}
                    onChange={(e) => setMultClamped(Number(e.target.value))}
                    disabled={!isSuper || saving}
                  />
                  <div className="d-flex align-items-center gap-1">
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      style={{ width: 88 }}
                      min={MULT_MIN}
                      max={MULT_MAX}
                      value={targetMult}
                      onChange={(e) => setMultClamped(Number(e.target.value))}
                      disabled={!isSuper || saving}
                    />
                    <span className="small text-secondary">×</span>
                  </div>
                </div>
                <p className="text-secondary small mb-0">
                  Range {MULT_MIN}× – {MULT_MAX}×.
                </p>
              </>
            ) : (
              <>
                <label className="form-label small text-secondary mb-1">Total wager target (USD)</label>
                <div className="input-group input-group-sm" style={{ maxWidth: 280 }}>
                  <span className="input-group-text">$</span>
                  <input
                    className="form-control"
                    value={targetWagerUsd}
                    onChange={(e) => setTargetWagerUsd(e.target.value)}
                    inputMode="decimal"
                    disabled={!isSuper || saving}
                  />
                </div>
              </>
            )}
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">Winner prize</div>
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label small text-secondary mb-1">Amount (USD major)</label>
                {str(meta.prize_type) === 'cash' ? (
                  <div className="input-group input-group-sm">
                    <span className="input-group-text">$</span>
                    <input
                      className="form-control"
                      value={prizeUsd}
                      onChange={(e) => setPrizeUsd(e.target.value)}
                      disabled={!isSuper || saving}
                      inputMode="decimal"
                    />
                  </div>
                ) : (
                  <p className="small text-secondary mb-0 py-1">
                    Prize type {str(meta.prize_type)} — only cash prizes are editable here.
                  </p>
                )}
                {str(meta.prize_type) === 'cash' ? (
                  <p className="text-secondary small mt-1 mb-0">Ledger currency: {prizeCurrency} minor units.</p>
                ) : null}
              </div>
              <div className="col-md-8">
                <label className="form-label small text-secondary mb-1">
                  Payout asset &amp; chain (PassimPay)
                </label>
                <PayoutAssetDropdown
                  options={depositAssets}
                  value={payoutAssetKey}
                  onChange={setPayoutAssetKey}
                  disabled={!isSuper || saving}
                />
              </div>
            </div>
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">Schedule &amp; limits</div>
            <div className="row g-2">
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Min bet (USD per round)</label>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={minBetUsd}
                  onChange={(e) => setMinBetUsd(e.target.value)}
                  disabled={!isSuper || saving}
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                />
                <p className="small text-secondary mt-1 mb-0">Decimals allowed (e.g. 0.25).</p>
              </div>
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Max winners</label>
                <input
                  className="form-control form-control-sm"
                  value={maxWinners}
                  onChange={(e) => setMaxWinners(e.target.value)}
                  inputMode="numeric"
                  disabled={!isSuper || saving}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Starts</label>
                <input
                  type="datetime-local"
                  className="form-control form-control-sm"
                  value={startsLocal}
                  onChange={(e) => setStartsLocal(e.target.value)}
                  disabled={!isSuper || saving}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Ends</label>
                <input
                  type="datetime-local"
                  className="form-control form-control-sm"
                  value={endsLocal}
                  onChange={(e) => setEndsLocal(e.target.value)}
                  disabled={!isSuper || saving}
                />
              </div>
            </div>
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-2">Description</div>
            <div className="d-flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={generateDescription}
                disabled={!isSuper || saving}
              >
                Generate from parameters
              </button>
            </div>
            <textarea
              className="form-control form-control-sm"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isSuper || saving}
              placeholder="Shown on player cards and detail modal"
            />
          </div>

          <div className="border border-secondary rounded p-3 bg-body-secondary mb-3">
            <div className="fw-semibold small mb-3">Rules &amp; terms</div>
            <div className="row g-3 align-items-stretch">
              <div className="col-md-6 d-flex flex-column">
                <div className="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2">
                  <label htmlFor="challenge-rules-edit" className="form-label small text-secondary mb-0">
                    Rules
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary flex-shrink-0"
                    onClick={generateRulesFromParams}
                    disabled={!isSuper || saving}
                  >
                    Generate
                  </button>
                </div>
                <p className="small text-secondary mb-2 flex-shrink-0" style={{ minHeight: '2.75rem' }}>
                  Shown with challenge details on the player site.
                </p>
                <textarea
                  id="challenge-rules-edit"
                  className="form-control form-control-sm flex-grow-1"
                  style={{ minHeight: 200 }}
                  rows={8}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  disabled={!isSuper || saving}
                />
              </div>
              <div className="col-md-6 d-flex flex-column">
                <div className="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2">
                  <label htmlFor="challenge-terms-edit" className="form-label small text-secondary mb-0">
                    Terms
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary flex-shrink-0"
                    onClick={generateTermsFromParams}
                    disabled={!isSuper || saving}
                  >
                    Generate
                  </button>
                </div>
                <p className="small mb-2 flex-shrink-0" style={{ minHeight: '2.75rem' }}>
                  <a
                    href={playerTermsPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-primary"
                  >
                    Open player Terms &amp; Conditions
                  </a>
                </p>
                <textarea
                  id="challenge-terms-edit"
                  className="form-control form-control-sm flex-grow-1"
                  style={{ minHeight: 200 }}
                  rows={8}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  disabled={!isSuper || saving}
                />
              </div>
            </div>

            <div className="row g-2 mt-3 pt-3 border-top border-secondary">
              <div className="col-md-4 col-lg-3">
                <label htmlFor="challenge-status-edit" className="form-label small text-secondary mb-1">
                  Status
                </label>
                <select
                  id="challenge-status-edit"
                  className="form-select form-select-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={!isSuper || saving}
                >
                  {['draft', 'scheduled', 'active', 'paused', 'archived', 'completed', 'cancelled'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="d-flex flex-wrap gap-2 mt-2 pt-3 border-top border-secondary">
            {isSuper ? (
              <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            ) : (
              <span className="small text-secondary">Superadmin required to edit.</span>
            )}
            <Link
              to={`/engagement/challenges/${challengeId}`}
              className="btn btn-sm btn-outline-secondary"
              onClick={onClose}
            >
              Full page (entries &amp; lifecycle)
            </Link>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </form>
  )
}
