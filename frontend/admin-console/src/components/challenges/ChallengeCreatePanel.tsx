import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { formatApiError } from '../../api/errors'
import { useAdminAuth } from '../../authContext'
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

type GameRow = {
  id: string
  title: string
  thumbnail_url: string
  provider: string
  provider_system?: string
}

type VIPTierRow = {
  id: number
  name: string
  sort_order: number
}

function errBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) return { code: err.code, message: err.message ?? '', status }
  }
  return null
}

function slugify(title: string) {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96)
  return s || 'challenge'
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(s: string): string | null {
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString()
}

function parseUsdToMinor(s: string): number | null {
  const n = Number(String(s).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function resolveThumb(url: string): string {
  const t = url.trim()
  if (!t) return ''
  if (t.startsWith('//')) return `https:${t}`
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return adminApiUrl(t.startsWith('/') ? t : `/${t}`)
}

const MULT_MIN = 2
const MULT_MAX = 1000

export function ChallengeCreatePanel({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void
  onCancel?: () => void
}) {
  const { apiFetch } = useAdminAuth()
  const [games, setGames] = useState<GameRow[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [vipTiers, setVipTiers] = useState<VIPTierRow[]>([])
  const [vipAudience, setVipAudience] = useState<string>('all')

  const [depositAssets, setDepositAssets] = useState<DepositAsset[]>(FALLBACK_PAYOUT_ASSETS)
  const [payoutAssetKey, setPayoutAssetKey] = useState(
    () => FALLBACK_PAYOUT_ASSETS.find((a) => a.symbol === 'USDT')?.key ?? FALLBACK_PAYOUT_ASSETS[0]?.key ?? '',
  )

  const [gameSearch, setGameSearch] = useState('')
  const [gameSearchDebounced, setGameSearchDebounced] = useState('')
  const [studioFilter, setStudioFilter] = useState('')
  const [studioCatalog, setStudioCatalog] = useState<string[]>([])

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [ctype, setCtype] = useState<'multiplier' | 'wager_volume'>('multiplier')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
  const [terms, setTerms] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [heroUrl, setHeroUrl] = useState('')
  const [heroManual, setHeroManual] = useState(false)
  const [targetMult, setTargetMult] = useState(20)
  const [targetWagerUsd, setTargetWagerUsd] = useState('500')
  const [prizeUsd, setPrizeUsd] = useState('25')
  const [minBetUsd, setMinBetUsd] = useState('1')
  const [maxWinners, setMaxWinners] = useState('10')
  const [badgeLabel, setBadgeLabel] = useState('FEATURED')
  const [startsLocal, setStartsLocal] = useState(() => toLocalInputValue(new Date()))
  const [endsLocal, setEndsLocal] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return toLocalInputValue(d)
  })

  useEffect(() => {
    const t = window.setTimeout(() => setGameSearchDebounced(gameSearch), 320)
    return () => window.clearTimeout(t)
  }, [gameSearch])

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
          let msg = `Could not load payout options (HTTP ${res.status}). Using default chains.`
          if (body && typeof body === 'object' && 'error' in body) {
            const e = (body as { error?: { message?: string } }).error
            if (e?.message?.trim()) msg = `${e.message.trim()} — using default chains.`
          }
          toast.error(msg)
          return
        }

        const list = parsed.length > 0 ? parsed : FALLBACK_PAYOUT_ASSETS
        if (parsed.length === 0) {
          toast.warning('Payout list was empty from the API; using default chains. Restart core or check logs.')
        }
        setDepositAssets(list)
        setPayoutAssetKey((prev) => {
          if (prev && list.some((a) => a.key === prev)) return prev
          const usdt = list.find((a) => a.symbol === 'USDT') ?? list[0]
          return usdt?.key ?? ''
        })
      } catch {
        if (!cancelled) {
          setDepositAssets(FALLBACK_PAYOUT_ASSETS)
          setPayoutAssetKey((prev) => {
            if (prev && FALLBACK_PAYOUT_ASSETS.some((a) => a.key === prev)) return prev
            return FALLBACK_PAYOUT_ASSETS.find((a) => a.symbol === 'USDT')?.key ?? FALLBACK_PAYOUT_ASSETS[0]?.key ?? ''
          })
          toast.error('Could not load payout options. Using default chains.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

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

  const prizeCurrency = useMemo(() => {
    const a = depositAssets.find((x) => x.key === payoutAssetKey)
    return (a?.symbol ?? 'USDT').trim() || 'USDT'
  }, [depositAssets, payoutAssetKey])

  useEffect(() => {
    if (!slugTouched && title.trim()) {
      setSlug(slugify(title))
    }
  }, [title, slugTouched])

  useEffect(() => {
    if (heroManual) return
    if (selectedIds.length === 1) {
      const g = games.find((x) => x.id === selectedIds[0])
      const u = g?.thumbnail_url?.trim() ?? ''
      setHeroUrl(u)
    } else {
      setHeroUrl('')
    }
  }, [selectedIds, games, heroManual])

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

  const setMultClamped = (n: number) => {
    if (!Number.isFinite(n)) return
    const v = Math.min(MULT_MAX, Math.max(MULT_MIN, Math.round(n)))
    setTargetMult(v)
  }

  const getGeneratedDescription = useCallback((): string => {
    const tierNote =
      vipAudience === 'all'
        ? ''
        : ` ${vipTiers.find((t) => String(t.id) === vipAudience)?.name ?? 'VIP'} tier and above only.`
    const gameNote =
      selectedIds.length === 0
        ? 'selected games'
        : selectedIds.length === 1
          ? games.find((g) => g.id === selectedIds[0])?.title ?? 'this game'
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
    depositAssets,
    payoutAssetKey,
    prizeCurrency,
    ctype,
    targetMult,
    targetWagerUsd,
  ])

  const generateDescription = () => {
    setDescription(getGeneratedDescription())
  }

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
          ? games.find((g) => g.id === selectedIds[0])?.title ?? 'this game'
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

  const toggleGame = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          toast.info('Select at least one game — add another before removing this one.')
          return prev
        }
        return prev.filter((x) => x !== id)
      }
      return [...prev, id]
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (selectedIds.length < 1) {
      setErr('Select at least one game.')
      return
    }
    let resolvedHero = heroUrl.trim()
    if (!heroManual) {
      for (const id of selectedIds) {
        const raw = games.find((g) => g.id === id)?.thumbnail_url?.trim() ?? ''
        if (raw) {
          resolvedHero = raw
          break
        }
      }
    }
    if (selectedIds.length > 1 && !resolvedHero) {
      setErr('Upload or paste a thumbnail when more than one game is selected.')
      return
    }
    const prizeMinor = parseUsdToMinor(prizeUsd)
    const minMinor = parseUsdToMinor(minBetUsd)
    if (prizeMinor == null || prizeMinor <= 0) {
      setErr('Enter a valid prize amount.')
      return
    }
    if (minMinor == null || minMinor <= 0) {
      setErr('Enter a valid minimum bet (USD).')
      return
    }
    const mw = Number.parseInt(maxWinners, 10)
    if (!Number.isFinite(mw) || mw < 1) {
      setErr('Max winners must be at least 1.')
      return
    }
    const startsAt = fromLocalInputValue(startsLocal)
    const endsAt = fromLocalInputValue(endsLocal)
    if (!startsAt || !endsAt) {
      setErr('Invalid start or end date.')
      return
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setErr('End time must be after start time.')
      return
    }

    const vipOnly = vipAudience !== 'all'
    let vipTierMin: number | undefined
    if (vipOnly) {
      const idn = Number.parseInt(vipAudience, 10)
      if (!Number.isFinite(idn)) {
        setErr('Select a VIP tier or “All players”.')
        return
      }
      vipTierMin = idn
    }

    const descFinal = description.trim() || getGeneratedDescription()
    const ctx = getRulesTermsContext()
    const termsUrl = getPlayerTermsPageUrl()
    const rulesFinal = rules.trim() || generateChallengeRules(ctx)
    const termsFinal = terms.trim() || generateChallengeTerms(termsUrl, ctx)

    let body: Record<string, unknown> = {
      slug: slug.trim() || slugify(title),
      title: title.trim(),
      challenge_type: ctype,
      description: descFinal,
      rules: rulesFinal,
      terms: termsFinal,
      status: 'draft',
      game_ids: selectedIds,
      hero_image_url: resolvedHero || null,
      min_bet_amount_minor: minMinor,
      prize_type: 'cash',
      prize_currency: prizeCurrency,
      prize_amount_minor: prizeMinor,
      max_winners: mw,
      require_claim_for_prize: true,
      starts_at: startsAt,
      ends_at: endsAt,
      vip_only: vipOnly,
      ...(vipOnly && vipTierMin != null ? { vip_tier_minimum: vipTierMin } : {}),
    }
    if (payoutAssetKey.trim()) {
      body = { ...body, prize_payout_asset_key: payoutAssetKey.trim() }
    }
    if (badgeLabel.trim()) body = { ...body, badge_label: badgeLabel.trim() }

    if (ctype === 'multiplier') {
      if (targetMult < MULT_MIN || targetMult > MULT_MAX) {
        setErr(`Multiplier must be between ${MULT_MIN}× and ${MULT_MAX}×.`)
        return
      }
      body = { ...body, target_multiplier: targetMult }
    } else {
      const tw = parseUsdToMinor(targetWagerUsd)
      if (tw == null || tw <= 0) {
        setErr('Enter a valid target wager total (USD).')
        return
      }
      body = { ...body, target_wager_amount_minor: tw }
    }

    setBusy(true)
    try {
      const res = await apiFetch('/v1/admin/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), 'Create failed'))
        return
      }
      const newId = (j as { id?: string })?.id
      if (newId) {
        toast.success('Challenge created')
        onCreated(newId)
      } else setErr('No id returned')
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(ev) => void submit(ev)} className="small">
      {err ? <div className="alert alert-danger py-2 mb-3">{err}</div> : null}

      <div className="row g-3">
        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-3">Challenge basics</div>
            <div className="row g-2">
              <div className="col-md-8">
                <label className="form-label small text-secondary mb-1">Title</label>
                <input
                  className="form-control form-control-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-secondary mb-1">Slug</label>
                <input
                  className="form-control form-control-sm font-monospace"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(e.target.value)
                  }}
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Challenge type</label>
                <select
                  className="form-select form-select-sm"
                  value={ctype}
                  onChange={(e) => setCtype(e.target.value as 'multiplier' | 'wager_volume')}
                >
                  <option value="multiplier">Multiplier hit (e.g. 20× win)</option>
                  <option value="wager_volume">Total amount wagered</option>
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Badge (optional)</label>
                <input
                  className="form-control form-control-sm"
                  value={badgeLabel}
                  onChange={(e) => setBadgeLabel(e.target.value)}
                  placeholder="FEATURED"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">Audience</div>
            <label className="form-label text-secondary small mb-1">VIP tier</label>
            <select
              className="form-select form-select-sm"
              value={vipAudience}
              onChange={(e) => setVipAudience(e.target.value)}
            >
              <option value="all">All players</option>
              {vipTiers.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name} and higher tiers
                </option>
              ))}
            </select>
            <p className="text-secondary small mt-2 mb-0">
              Uses VIP ladder sort order: only players at or above the selected tier may enter.
            </p>
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">Games</div>
            <div className="row g-2 mb-2">
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Search title, ID, studio, or integration</label>
                <input
                  className="form-control form-control-sm"
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                  placeholder="Search…"
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-secondary mb-1">Filter studio</label>
                <select
                  className="form-select form-select-sm"
                  value={studioFilter}
                  onChange={(e) => setStudioFilter(e.target.value)}
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
            <p className="text-secondary small mb-2">
              One game: hero image can come from the catalog. Multiple games: upload a custom thumbnail below.
            </p>
            {gamesLoading ? (
              <p className="text-secondary small mb-0">Loading games…</p>
            ) : (
              <div
                className="border border-secondary rounded p-2 bg-body"
                style={{ maxHeight: 280, overflowY: 'auto' }}
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
                            <input type="checkbox" checked={sel} onChange={() => toggleGame(g.id)} />
                            <span
                              className="rounded border flex-shrink-0 overflow-hidden bg-black"
                              style={{ width: 48, height: 48 }}
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
                              <span className="d-block text-secondary small text-truncate">
                                {g.provider_system?.trim() || g.provider || '—'}
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
              <div className="fw-semibold mb-2">Selected games</div>
              {selectedIds.length === 0 ? (
                <p className="text-secondary small mb-0">No games selected yet — use the checklist above.</p>
              ) : (
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  {selectedIds.map((id) => {
                    const g = games.find((x) => x.id === id)
                    const thumb = g ? resolveThumb(g.thumbnail_url ?? '') : ''
                    return (
                      <li
                        key={id}
                        className="d-flex align-items-center gap-2 rounded border border-secondary bg-body px-2 py-2"
                      >
                        <span
                          className="rounded border flex-shrink-0 overflow-hidden bg-black"
                          style={{ width: 48, height: 48 }}
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
                          <span className="d-block text-secondary small text-truncate font-monospace">
                            {g
                              ? `${g.id}${g.provider_system?.trim() || g.provider ? ` · ${g.provider_system?.trim() || g.provider}` : ''}`
                              : 'Not in current search — still linked'}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary flex-shrink-0"
                          onClick={() => toggleGame(id)}
                        >
                          Remove
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">
              {ctype === 'multiplier' ? 'Multiplier goal' : 'Wager goal'}
            </div>
            {ctype === 'multiplier' ? (
              <>
                <label className="form-label small text-secondary mb-1">
                  Target multiplier (player must hit at least this × on a qualifying win)
                </label>
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
                    />
                    <span className="small text-secondary">×</span>
                  </div>
                </div>
                <p className="text-secondary small mb-0">
                  Range {MULT_MIN}× – {MULT_MAX}×. Use the slider for quick picks or type an exact value.
                </p>
              </>
            ) : (
              <>
                <label className="form-label small text-secondary mb-1">
                  Total wager target (USD, qualifying stakes summed during the challenge)
                </label>
                <div className="input-group input-group-sm" style={{ maxWidth: 280 }}>
                  <span className="input-group-text">$</span>
                  <input
                    className="form-control"
                    value={targetWagerUsd}
                    onChange={(e) => setTargetWagerUsd(e.target.value)}
                    inputMode="decimal"
                    placeholder="500.00"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">Winner prize</div>
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label small text-secondary mb-1">Amount (major units)</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text">$</span>
                  <input
                    className="form-control"
                    value={prizeUsd}
                    onChange={(e) => setPrizeUsd(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <p className="text-secondary small mt-1 mb-0">Credited in ledger as {prizeCurrency} minor units.</p>
              </div>
              <div className="col-md-8">
                <label className="form-label small text-secondary mb-1">
                  Payout asset &amp; chain (PassimPay / cashier — same rails as wallet deposits)
                </label>
                <PayoutAssetDropdown
                  options={depositAssets}
                  value={payoutAssetKey}
                  onChange={setPayoutAssetKey}
                  disabled={busy}
                />
                <p className="text-secondary small mt-1 mb-0">
                  Shown on player challenge cards (which crypto they receive on-chain). Prize is still booked in the
                  ledger as <strong>{prizeCurrency}</strong>; align this key with your PassimPay currency rows.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-3">Schedule &amp; limits</div>
            <div className="row g-2">
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Min bet (USD per round)</label>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={minBetUsd}
                  onChange={(e) => setMinBetUsd(e.target.value)}
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
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Starts</label>
                <input
                  type="datetime-local"
                  className="form-control form-control-sm"
                  value={startsLocal}
                  onChange={(e) => setStartsLocal(e.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-secondary mb-1">Ends</label>
                <input
                  type="datetime-local"
                  className="form-control form-control-sm"
                  value={endsLocal}
                  onChange={(e) => setEndsLocal(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">Player options</div>
            <div className="d-flex flex-column gap-2">
              <div className="form-check mb-0">
                <input
                  id="heroManual"
                  type="checkbox"
                  className="form-check-input"
                  checked={heroManual}
                  onChange={(e) => {
                    setHeroManual(e.target.checked)
                    if (!e.target.checked) setHeroUrl('')
                  }}
                />
                <label htmlFor="heroManual" className="form-check-label">
                  Set thumbnail manually (override game art)
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">Thumbnail</div>
            <div className="border border-secondary rounded p-2 bg-body">
              <ImageUrlField
                label=""
                hint={selectedIds.length > 1 ? 'Required for multiple games.' : 'Optional when a single game is selected.'}
                value={heroUrl}
                onChange={(u) => {
                  setHeroManual(true)
                  setHeroUrl(u)
                }}
                disabled={busy}
                uploadFile={uploadFile}
              />
            </div>
          </div>
        </div>
        <div className="col-12">
          <div className="border border-secondary rounded p-3 bg-body-secondary">
            <div className="fw-semibold mb-2">Description</div>
            <p className="text-secondary small mb-2">Shown on player cards and detail modal.</p>
            <div className="d-flex flex-wrap gap-2 mb-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={generateDescription}>
                Generate from parameters
              </button>
            </div>
            <textarea
              className="form-control form-control-sm"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shown on player cards and detail modal"
            />
          </div>
        </div>

        <div className="col-12">
          <div className="row g-2">
            <div className="col-md-6">
              <div className="border border-secondary rounded p-3 bg-body-secondary h-100">
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                  <span className="fw-semibold small">Rules</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={generateRulesFromParams}
                    disabled={busy}
                  >
                    Generate
                  </button>
                </div>
                <textarea
                  className="form-control form-control-sm"
                  rows={5}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder="Shown in the player challenge “Rules” tab"
                />
              </div>
            </div>
            <div className="col-md-6">
              <div className="border border-secondary rounded p-3 bg-body-secondary h-100">
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                  <span className="fw-semibold small">Terms</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={generateTermsFromParams}
                    disabled={busy}
                  >
                    Generate
                  </button>
                </div>
                <a
                  href={playerTermsPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="small link-primary d-inline-block mb-2"
                >
                  Open player Terms &amp; Conditions
                </a>
                <textarea
                  className="form-control form-control-sm"
                  rows={5}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Shown in the player challenge “Terms” tab"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 mt-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Creating…' : 'Create draft'}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  )
}
