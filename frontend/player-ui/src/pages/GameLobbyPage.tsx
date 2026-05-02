import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import { PortraitGameThumb } from '../components/PortraitGameThumb'
import {
  IconBarChart3,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconMaximize2,
  IconMinimize2,
  IconX,
} from '../components/icons'
import {
  getCatalogReturnForNavigation,
  RESTORE_MAIN_SCROLL_STATE_KEY,
  splitCatalogReturnPath,
} from '../lib/catalogReturn'
import { GAME_IFRAME_ALLOW } from '../lib/gameIframe'
import { isFavourite, pushRecent, toggleFavourite } from '../lib/gameStorage'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'
import GameLobbyActiveChallenges from '../components/challenges/GameLobbyActiveChallenges'
import { RequireAuthLink } from '../components/RequireAuthLink'
import { resolveGameThumbnailUrl } from '../lib/gameThumbnailFallback'
import { usePersistentMiniPlayer } from '../context/PersistentMiniPlayerContext'

type GameMeta = {
  id: string
  /** Stable hash from provider; may differ from `id` in URLs and challenge `game_ids`. */
  id_hash?: string
  title: string
  thumbnail_url?: string
  thumb_rev?: number
  provider?: string
  provider_system?: string
  category?: string
  live?: boolean
  /** When false, only real-money launch is offered for this title. */
  play_for_fun_supported?: boolean
}

type LaunchPlayMode = 'demo' | 'real'

function launchErrorMessage(code: string | undefined, fallback: string) {
  switch (code) {
    case 'maintenance':
      return 'The site is in maintenance mode. Try again later.'
    case 'launch_disabled':
      return 'Game launch is temporarily disabled.'
    case 'geo_blocked':
      return 'Games are not available in your region.'
    case 'self_excluded':
      return 'Your account is self-excluded from play.'
    case 'account_closed':
      return 'This account is closed.'
    case 'bog_unconfigured':
      return 'Games are not available (provider not configured).'
    case 'bog_error':
      if (/invalid\s+user\s+details/i.test(fallback)) {
        // Prefer full API message — core API appends snapshot/agent/IP hints after this phrase.
        return fallback
      }
      // Provider often returns HTTP 200 in the body text while our API surfaces 502 — demo sandbox refused.
      if (
        /demo\s+game\s+not\s+available|not\s+available\s+at\s+this\s+moment/i.test(fallback) ||
        (/demo/i.test(fallback) && /not\s+available/i.test(fallback))
      ) {
        return 'The provider refused free play for this title right now (sandbox limits, staging, or a temporary outage). You can try real money play if your wallet is funded, or try again later.'
      }
      return fallback
    case 'demo_unavailable':
      return 'Demo play is not available for this game.'
    case 'not_found':
      return 'Game not found or unavailable.'
    case 'unauthorized':
      return 'Your session expired or is invalid. Sign out and sign in again, then reopen this game.'
    default:
      return fallback
  }
}

/** Launch overlay message implies provider rejected free/demo play — offer real play when allowed. */
function providerRefusedFreePlay(launchErrText: string): boolean {
  const t = launchErrText.toLowerCase()
  return (
    t.includes('refused free play') ||
    t.includes('demo game not available') ||
    t.includes('not available at this moment') ||
    (t.includes('demo') && t.includes('not available'))
  )
}

const chromeIconBtn =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-35 sm:h-8 sm:w-8'

type BlueOceanScope = {
  game_id?: string
  catalog_title?: string
  bog_game_id?: number
  provider_system?: string
  id_hash?: string
}

type BlueOceanInfoResponse = {
  scope?: BlueOceanScope
  local: Record<string, unknown>
  blue_ocean: unknown
  blue_ocean_error: string | null
}

function humanizeKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatStatScalar(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

function StatsKeyValueTable({
  data,
  priorityKeys,
}: {
  data: Record<string, unknown>
  priorityKeys?: string[]
}) {
  const pri = priorityKeys ?? []
  const rank = (k: string) => {
    const i = pri.indexOf(k)
    return i === -1 ? pri.length + 1 : i
  }
  const rows = Object.entries(data).sort(([a], [b]) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
  return (
    <dl className="space-y-2 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 gap-y-0.5 border-b border-casino-border/40 pb-2 last:border-0 last:pb-0">
          <dt className="font-medium text-casino-muted">{humanizeKey(k)}</dt>
          <dd className="min-w-0 break-words font-mono text-[11px] text-casino-foreground/95">
            {typeof v === 'object' && v !== null ? (
              <pre className="scrollbar-none max-h-40 overflow-auto whitespace-pre-wrap rounded-casino-sm bg-casino-bg/80 p-2 text-[10px] leading-snug">
                {JSON.stringify(v, null, 2)}
              </pre>
            ) : (
              formatStatScalar(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const relatedGameCardShell =
  'group flex h-full flex-col overflow-hidden rounded-casino-md border border-white/[0.08] bg-casino-surface transition hover:border-casino-primary/35 hover:bg-casino-elevated'

const lobbyRailInner = 'mx-auto w-full max-w-[min(100%,90rem)] px-3 sm:px-4 lg:px-6'

/**
 * Full-page game lobby: catalog links here; provider iframe loads in a top-aligned “theater”
 * (chrome rows + 16:9 stage). The same shell is shown when signed out, with a sign-in overlay on the stage.
 */
export default function GameLobbyPage() {
  const { gameId: rawId } = useParams()
  const gameId = rawId ? decodeURIComponent(rawId) : ''
  const navigate = useNavigate()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const { mini, openMini, closeMini } = usePersistentMiniPlayer()
  const thisGameInMini = Boolean(gameId && mini?.gameId === gameId)

  const [meta, setMeta] = useState<GameMeta | null>(null)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)
  const [launchRetryNonce, setLaunchRetryNonce] = useState(0)
  const [launchModeChoice, setLaunchModeChoice] = useState<LaunchPlayMode | null>(null)
  /** Provider iframe often paints black until its bundle loads — keep a loading shell until `load`. */
  const [iframeStageReady, setIframeStageReady] = useState(false)
  const [, bumpFav] = useState(0)
  const refreshFav = useCallback(() => bumpFav((n) => n + 1), [])
  /** Encodes how we fetch “recommended” tiles: same studio → else same category → else newest catalog slice. */
  const relatedFetchKey = useMemo(() => {
    if (!isAuthenticated || !gameId || !meta) return null
    const studio = meta.provider_system?.trim()
    if (studio) return JSON.stringify({ gameId, mode: 'studio' as const, studio })
    const cat = meta.category?.trim().toLowerCase()
    if (cat && cat !== 'other') return JSON.stringify({ gameId, mode: 'category' as const, category: cat })
    return JSON.stringify({ gameId, mode: 'catalog' as const })
  }, [isAuthenticated, gameId, meta])
  const [relatedCache, setRelatedCache] = useState<{ key: string; games: GameMeta[] } | null>(null)
  const relatedRailRef = useRef<HTMLDivElement>(null)
  const [relatedScrollEdges, setRelatedScrollEdges] = useState({ canLeft: false, canRight: false })

  const syncRelatedRailScroll = useCallback(() => {
    const el = relatedRailRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const maxScroll = scrollWidth - clientWidth
    setRelatedScrollEdges({
      canLeft: scrollLeft > 2,
      canRight: maxScroll > 2 && scrollLeft < maxScroll - 2,
    })
  }, [])

  const scrollRelatedRail = useCallback((dir: -1 | 1) => {
    const el = relatedRailRef.current
    if (!el) return
    const delta = Math.max(180, Math.floor(el.clientWidth * 0.72)) * dir
    el.scrollBy({ left: delta, behavior: 'smooth' })
    window.setTimeout(() => syncRelatedRailScroll(), 350)
  }, [syncRelatedRailScroll])

  const [statsOpen, setStatsOpen] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsErr, setStatsErr] = useState<string | null>(null)
  const [statsData, setStatsData] = useState<BlueOceanInfoResponse | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const authPromptedRef = useRef(false)

  const postAuthTarget = useMemo(
    () => (gameId ? `/casino/game-lobby/${encodeURIComponent(gameId)}` : '/casino/games'),
    [gameId],
  )

  const catalogGameKeys = useMemo(() => {
    const keys: string[] = []
    const seen = new Set<string>()
    const add = (s?: string) => {
      const t = s?.trim()
      if (!t || seen.has(t)) return
      seen.add(t)
      keys.push(t)
    }
    add(gameId)
    add(meta?.id_hash)
    return keys
  }, [gameId, meta?.id_hash])

  const metaLoading = Boolean(gameId && !metaErr && !meta)

  const demoForcedById = gameId.startsWith('demo-')
  const demoAllowed = demoForcedById || meta?.play_for_fun_supported !== false
  const realAllowed = !demoForcedById

  useEffect(() => {
    if (isAuthenticated || !gameId || metaErr) return
    if (authPromptedRef.current) return
    authPromptedRef.current = true
    openAuth('login', { navigateTo: postAuthTarget })
  }, [isAuthenticated, gameId, metaErr, openAuth, postAuthTarget])

  useEffect(() => {
    authPromptedRef.current = false
  }, [gameId])

  useEffect(() => {
    setLaunchModeChoice(null)
  }, [gameId])

  useEffect(() => {
    setIframeStageReady(false)
  }, [iframeUrl, gameId])

  useEffect(() => {
    if (!statsOpen || !isAuthenticated || !gameId) return
    let cancelled = false
    setStatsLoading(true)
    setStatsErr(null)
    setStatsData(null)
    void (async () => {
      try {
        const statsPath = `/v1/games/${encodeURIComponent(gameId)}/blueocean-info`
        const res = await apiFetch(statsPath)
        if (!res.ok) {
          const apiErr = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(apiErr, res.status, `GET ${statsPath}`, rid)
          if (!cancelled) setStatsErr(formatApiError(apiErr, 'Could not load statistics'))
          return
        }
        const j = (await res.json()) as BlueOceanInfoResponse
        if (!cancelled) setStatsData(j)
      } catch {
        toastPlayerNetworkError('Network error.', 'GET /v1/games/.../blueocean-info')
        if (!cancelled) setStatsErr('Network error.')
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [statsOpen, isAuthenticated, gameId, apiFetch])

  useEffect(() => {
    if (!statsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStatsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [statsOpen])

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = () => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }

  const theaterPosterSrc = useMemo(() => {
    if (!gameId) return ''
    return resolveGameThumbnailUrl(meta?.thumbnail_url, gameId, meta?.thumb_rev)
  }, [gameId, meta?.thumbnail_url, meta?.thumb_rev])

  const toggleGamePopOut = useCallback(() => {
    if (!iframeUrl) return
    if (thisGameInMini) {
      closeMini()
      if (document.fullscreenElement) void document.exitFullscreen()
      return
    }
    openMini({
      iframeUrl,
      title: meta?.title?.trim() || 'Game',
      gameId,
      thumbSrc: theaterPosterSrc || '',
      providerLabel: meta?.provider_system?.trim() || meta?.provider?.trim() || 'Casino',
    })
    if (document.fullscreenElement) void document.exitFullscreen()
  }, [iframeUrl, thisGameInMini, closeMini, openMini, meta, gameId, theaterPosterSrc])

  useEffect(() => {
    if (!thisGameInMini || statsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMini()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [thisGameInMini, statsOpen, closeMini])

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    void (async () => {
      setMetaErr(null)
      try {
        const metaPath = `/v1/games?integration=blueocean&limit=1&ids=${encodeURIComponent(gameId)}`
        const res = await playerFetch(metaPath)
        if (!res.ok) {
          const parsed = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(parsed, res.status, `GET ${metaPath}`, rid)
          if (!cancelled) setMetaErr('Could not load game details.')
          return
        }
        const j = (await res.json()) as { games: GameMeta[] }
        const g = j.games?.[0]
        if (!g) {
          if (!cancelled) setMetaErr('Game not found.')
          return
        }
        if (!cancelled) setMeta(g)
      } catch {
        toastPlayerNetworkError('Network error loading game.', 'GET /v1/games (game meta)')
        if (!cancelled) setMetaErr('Network error loading game.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId])

  useEffect(() => {
    if (!isAuthenticated || !gameId || !launchModeChoice) return
    let cancelled = false
    void (async () => {
      if (!cancelled) {
        setLaunchErr(null)
        setIframeUrl(null)
      }
      try {
        const res = await apiFetch('/v1/games/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          game_id: gameId,
          mode: launchModeChoice === 'demo' ? 'free_play' : 'real',
        }),
        })
        if (!res.ok) {
          const apiErr = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          const msg = launchErrorMessage(apiErr?.code, formatApiError(apiErr, 'Launch failed'))
          toastPlayerApiError(
            apiErr ? { ...apiErr, message: msg } : null,
            res.status,
            'POST /v1/games/launch',
            rid,
          )
          if (!cancelled) setLaunchErr(msg)
          return
        }
        const j = (await res.json()) as { url: string }
        if (!cancelled) {
          setIframeUrl(j.url)
          pushRecent(gameId)
        }
      } catch {
        toastPlayerNetworkError(
          'Network error while launching. Check your connection and try again.',
          'POST /v1/games/launch',
        )
        if (!cancelled) setLaunchErr('Network error while launching. Check your connection and try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, apiFetch, gameId, launchModeChoice, launchRetryNonce])

  useEffect(() => {
    if (!relatedFetchKey) return
    const spec = JSON.parse(relatedFetchKey) as
      | { gameId: string; mode: 'studio'; studio: string }
      | { gameId: string; mode: 'category'; category: string }
      | { gameId: string; mode: 'catalog' }
    const gid = spec.gameId
    let cancelled = false
    void (async () => {
      try {
        const q = new URLSearchParams()
        q.set('integration', 'blueocean')
        q.set('limit', '32')
        if (spec.mode === 'studio') {
          q.set('sort', 'name')
          q.set('provider', spec.studio)
        } else if (spec.mode === 'category') {
          q.set('sort', 'name')
          q.set('category', spec.category)
        } else {
          q.set('sort', 'new')
        }
        const relPath = `/v1/games?${q.toString()}`
        const res = await playerFetch(relPath)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { games: GameMeta[] }
        const seen = new Set<string>([gid])
        const list: GameMeta[] = []
        for (const g of j.games ?? []) {
          if (!g.id || seen.has(g.id)) continue
          seen.add(g.id)
          list.push(g)
          if (list.length >= 6) break
        }
        if (!cancelled) setRelatedCache({ key: relatedFetchKey, games: list })
      } catch {
        if (!cancelled) setRelatedCache({ key: relatedFetchKey, games: [] })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [relatedFetchKey])

  const goBackToCatalog = useCallback(() => {
    const ret = getCatalogReturnForNavigation()
    if (ret) {
      const y = Math.max(0, Math.round(ret.scrollTop))
      const { pathname, search, hash } = splitCatalogReturnPath(ret.path)
      navigate(
        { pathname, search, hash },
        { state: { [RESTORE_MAIN_SCROLL_STATE_KEY]: y } },
      )
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/casino/games')
  }, [navigate])

  const showLaunchModeModal = Boolean(
    isAuthenticated && meta && !metaErr && launchModeChoice === null && !iframeUrl && !launchErr,
  )

  useEffect(() => {
    if (!isAuthenticated || !meta || metaErr || iframeUrl || launchErr || launchModeChoice !== null) return
    if (demoAllowed && !realAllowed) {
      setLaunchModeChoice('demo')
      return
    }
    if (!demoAllowed && realAllowed) {
      setLaunchModeChoice('real')
    }
  }, [
    isAuthenticated,
    meta,
    metaErr,
    iframeUrl,
    launchErr,
    launchModeChoice,
    demoAllowed,
    realAllowed,
  ])

  useEffect(() => {
    if (!showLaunchModeModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goBackToCatalog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showLaunchModeModal, goBackToCatalog])

  const relatedGames =
    gameId && relatedCache && relatedCache.key === relatedFetchKey && relatedFetchKey
      ? relatedCache.games
      : []

  useLayoutEffect(() => {
    syncRelatedRailScroll()
  }, [relatedGames.length, relatedFetchKey, syncRelatedRailScroll])

  useEffect(() => {
    const el = relatedRailRef.current
    if (!el) return
    const onScroll = () => syncRelatedRailScroll()
    const ro = new ResizeObserver(() => syncRelatedRailScroll())
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [relatedGames.length, relatedFetchKey, syncRelatedRailScroll])

  if (!gameId) {
    return <Navigate to="/casino/games" replace />
  }

  const title = meta?.title ?? (metaLoading ? 'Loading game…' : 'Game lobby')
  const providerLabel =
    meta?.provider_system?.trim() || meta?.provider?.trim() || (metaLoading ? '…' : 'Casino')
  const edgeLabel =
    meta?.live || meta?.category?.toLowerCase() === 'live' ? 'Live table' : 'Casino play'
  const popOutButtonTitle = thisGameInMini
    ? 'Return game to theater'
    : mini && mini.gameId !== gameId
      ? 'Pop out this game (replaces current mini player)'
      : 'Pop out game (bottom-right mini player)'
  const launchPending = Boolean(
    isAuthenticated && launchModeChoice !== null && !metaErr && !iframeUrl && !launchErr,
  )
  const iframeBootPending = Boolean(
    isAuthenticated &&
      iframeUrl?.trim() &&
      !thisGameInMini &&
      !iframeStageReady &&
      !launchErr,
  )
  const showTheater = !metaErr

  const openSignIn = () => openAuth('login', { navigateTo: postAuthTarget })
  const openRegister = () => openAuth('register', { navigateTo: postAuthTarget })

  const onFavouriteClick = () => {
    if (!meta) return
    if (!isAuthenticated) {
      openAuth('login', { navigateTo: postAuthTarget })
      return
    }
    toggleFavourite(meta.id)
    refreshFav()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {metaErr ? (
        <div className="mx-auto max-w-md px-4 py-7 text-center text-sm">
          <p className="text-red-400">{metaErr}</p>
          <button
            type="button"
            className="mt-3 inline-block text-casino-primary underline"
            onClick={goBackToCatalog}
          >
            Back to games
          </button>
        </div>
      ) : null}

      {showTheater ? (
        <div className="flex w-full min-w-0 flex-1 flex-col gap-0">
          <div className="mx-auto w-full max-w-[min(100%,90rem)] shrink-0 px-3 pt-2 sm:px-4 sm:pt-3 lg:px-6">
            <div
              ref={stageRef}
              className="w-full shrink-0 overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
            >
            <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-2 py-1.5 sm:gap-2 sm:px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  aria-label="Back to games"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 hover:text-white sm:gap-1 sm:px-2 sm:py-1.5 sm:text-xs"
                  onClick={goBackToCatalog}
                >
                  <IconChevronLeft size={14} aria-hidden />
                  <span className="hidden sm:inline">Games</span>
                </button>
                <span className="rounded bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white/85 sm:px-2 sm:py-0.5 sm:text-[10px]">
                  {edgeLabel}
                </span>
              </div>
              <div className="relative z-20 flex shrink-0 items-center gap-px sm:gap-0.5">
                <button
                  type="button"
                  className={`${chromeIconBtn} ${thisGameInMini ? 'bg-white/10 text-white' : ''}`}
                  title={popOutButtonTitle}
                  aria-pressed={thisGameInMini}
                  disabled={!iframeUrl?.trim()}
                  onClick={() => toggleGamePopOut()}
                >
                  <IconExternalLink size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className={chromeIconBtn}
                  title={
                    isAuthenticated
                      ? 'Game statistics (Blue Ocean)'
                      : 'Sign in to view game statistics'
                  }
                  disabled={!gameId}
                  onClick={() => {
                    if (!isAuthenticated) {
                      openAuth('login', { navigateTo: postAuthTarget })
                      return
                    }
                    setStatsOpen(true)
                  }}
                >
                  <IconBarChart3 size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className={chromeIconBtn}
                  title={
                    thisGameInMini
                      ? 'Return the game to the theater to use full screen'
                      : isFullscreen
                        ? 'Exit full screen'
                        : 'Full screen'
                  }
                  disabled={thisGameInMini}
                  onClick={() => toggleFullscreen()}
                >
                  {isFullscreen ? <IconMinimize2 size={15} aria-hidden /> : <IconMaximize2 size={15} aria-hidden />}
                </button>
              </div>
            </div>

            <div
              className="relative aspect-video w-full bg-black"
              aria-busy={launchPending || iframeBootPending}
            >
              <img
                src={theaterPosterSrc}
                alt=""
                className={`absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-300 ${
                  isAuthenticated && iframeUrl && !thisGameInMini && iframeStageReady ? 'opacity-0' : 'opacity-40'
                }`}
                aria-hidden
              />
              <div
                className={`absolute inset-0 z-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 ${
                  isAuthenticated && iframeUrl && !thisGameInMini && iframeStageReady
                    ? 'pointer-events-none opacity-0'
                    : ''
                }`}
                aria-hidden
              />

              {isAuthenticated && iframeUrl && thisGameInMini ? (
                <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm font-semibold text-white/95 sm:text-base">Playing in mini player</p>
                  <p className="max-w-[18rem] text-[11px] leading-relaxed text-white/55 sm:text-xs">
                    The game is in the floating window. Close it or expand to bring it back here.
                  </p>
                  <button
                    type="button"
                    className="mt-0.5 rounded-casino-sm bg-white/12 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/18 sm:text-sm"
                    onClick={() => closeMini()}
                  >
                    Return to theater
                  </button>
                </div>
              ) : null}

              {isAuthenticated && iframeUrl && !thisGameInMini ? (
                <iframe
                  key={`${iframeUrl}\u0000${launchRetryNonce}`}
                  title={title}
                  src={iframeUrl}
                  className="absolute inset-0 z-10 h-full w-full border-0 bg-black"
                  allow={GAME_IFRAME_ALLOW}
                  allowFullScreen
                  onLoad={() => setIframeStageReady(true)}
                />
              ) : null}

              {iframeBootPending ? (
                <div
                  className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 bg-black/65 p-3 text-center backdrop-blur-[2px] sm:gap-3 sm:p-5"
                  role="status"
                  aria-live="polite"
                  aria-label="Game window loading"
                >
                  <div
                    className="size-9 animate-spin rounded-full border-2 border-white/20 border-t-casino-primary sm:size-10"
                    aria-hidden
                  />
                  <p className="text-xs font-semibold text-white sm:text-sm">Opening game…</p>
                  <p className="max-w-sm px-1 text-[11px] text-white/55 sm:text-xs">
                    The provider window can stay dark for a few seconds while the game boots.
                  </p>
                </div>
              ) : null}

              {!isAuthenticated ? (
                <div className="absolute inset-0 z-[8] flex flex-col items-center justify-center gap-3 p-4 text-center sm:p-5">
                  <div className="max-w-sm rounded-casino-md border border-white/15 bg-black/75 px-4 py-4 shadow-xl backdrop-blur-md sm:px-5 sm:py-4">
                    <p className="text-sm font-semibold text-white sm:text-base">Play this game</p>
                    <p className="mt-1.5 text-xs text-white/65 sm:text-sm">
                      Sign in or create an account. After you continue, this game loads here automatically.
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                      <button
                        type="button"
                        className="rounded-casino-sm bg-casino-primary px-4 py-2 text-xs font-semibold text-white hover:brightness-110 sm:rounded-casino-md sm:px-5 sm:py-2.5 sm:text-sm"
                        onClick={openSignIn}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        className="rounded-casino-sm border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15 sm:rounded-casino-md sm:px-5 sm:py-2.5 sm:text-sm"
                        onClick={openRegister}
                      >
                        Register
                      </button>
                    </div>
                    <button
                      type="button"
                      className="mt-3 inline-block text-xs font-medium text-casino-primary underline-offset-2 hover:underline sm:text-sm"
                      onClick={goBackToCatalog}
                    >
                      Back to games
                    </button>
                  </div>
                </div>
              ) : null}

              {showLaunchModeModal ? (
                <div
                  className="absolute inset-0 z-[14] flex items-center justify-center p-3 sm:p-5"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="launch-mode-title"
                >
                  <button
                    type="button"
                    className="absolute inset-0 border-0 bg-black/60 backdrop-blur-[3px]"
                    aria-label="Close and go back to games"
                    onClick={goBackToCatalog}
                  />
                  <div className="relative z-10 w-full max-w-[min(100%,20rem)] overflow-hidden rounded-casino-lg border border-white/15 bg-black/90 shadow-2xl ring-1 ring-white/10">
                    <div className="border-b border-white/10 px-3 py-2.5 sm:px-4 sm:py-3">
                      <h2 id="launch-mode-title" className="text-sm font-bold text-white sm:text-base">
                        Choose how to play
                      </h2>
                    </div>
                    <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:gap-2.5">
                        <button
                          type="button"
                          disabled={!realAllowed}
                          title={!realAllowed ? 'This title only supports free play.' : undefined}
                          className="flex-1 rounded-casino-md bg-casino-primary px-3 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 sm:py-3 sm:text-sm"
                          onClick={() => setLaunchModeChoice('real')}
                        >
                          Real money
                        </button>
                        <button
                          type="button"
                          disabled={!demoAllowed}
                          title={!demoAllowed ? 'Free play is not available for this game.' : undefined}
                          className="flex-1 rounded-casino-md border border-white/18 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-white/16 disabled:pointer-events-none disabled:opacity-40 sm:py-3 sm:text-sm"
                          onClick={() => setLaunchModeChoice('demo')}
                        >
                          Free play
                        </button>
                      </div>
                      <button
                        type="button"
                        className="w-full text-center text-xs font-medium text-casino-primary underline-offset-2 hover:underline sm:text-sm"
                        onClick={goBackToCatalog}
                      >
                        Back to games
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {isAuthenticated && !iframeUrl && (launchPending || launchErr) ? (
                <div
                  className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 p-3 text-center sm:gap-3 sm:p-5"
                  role={launchPending ? 'status' : undefined}
                  aria-live={launchPending ? 'polite' : undefined}
                  aria-label={launchPending ? 'Connecting to game provider' : undefined}
                >
                  <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-hidden />
                  <div className="relative flex max-w-md flex-col items-center gap-2 sm:gap-3">
                  {launchPending ? (
                    <>
                      <div
                        className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-casino-primary sm:size-11"
                        aria-hidden
                      />
                      <p className="text-xs font-semibold text-white sm:text-sm">
                        {launchModeChoice === 'demo' ? 'Starting free play…' : 'Connecting for real play…'}
                      </p>
                      <p className="text-xs font-medium text-white/85 sm:text-sm">Contacting provider…</p>
                      <p className="max-w-sm px-1 text-[11px] text-white/55 sm:text-xs">
                        On staging this can take a few seconds. If it never clears, check Blue Ocean credentials and
                        sandbox access.
                      </p>
                    </>
                  ) : null}
                  {launchErr ? (
                    <div className="mx-auto w-full max-w-[min(100%,17.5rem)] rounded-casino-md border border-white/12 bg-black/85 px-3 py-2.5 shadow-xl backdrop-blur-md sm:max-w-xs sm:px-3.5 sm:py-3">
                      <p className="text-xs font-semibold tracking-tight text-white sm:text-[13px]">
                        Could not load the game
                      </p>
                      <p className="mt-1.5 break-words text-[11px] leading-snug text-red-300/95 sm:text-xs">
                        {launchErr}
                      </p>
                      <p className="mt-2 text-[10px] leading-relaxed text-white/45 sm:text-[11px]">
                        This is common in staging when the provider sandbox is down or IP-blocked.
                      </p>
                      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-2.5">
                        <button
                          type="button"
                          className="rounded-casino-sm bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 transition hover:bg-white/90 sm:px-3.5 sm:py-2"
                          onClick={() => {
                            setLaunchErr(null)
                            setLaunchRetryNonce((n) => n + 1)
                          }}
                        >
                          Try again
                        </button>
                        {launchModeChoice === 'demo' &&
                        realAllowed &&
                        launchErr &&
                        providerRefusedFreePlay(launchErr) ? (
                          <button
                            type="button"
                            className="rounded-casino-sm border border-casino-primary/55 bg-casino-primary/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-casino-primary/30 sm:px-3.5 sm:py-2"
                            onClick={() => {
                              setLaunchErr(null)
                              setLaunchModeChoice('real')
                            }}
                          >
                            Try real money play
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-center text-xs font-medium text-casino-primary underline decoration-white/25 underline-offset-2 hover:decoration-casino-primary sm:text-[13px]"
                          onClick={goBackToCatalog}
                        >
                          Back to games
                        </button>
                      </div>
                    </div>
                  ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-2.5 py-1.5 sm:px-3 sm:py-2">
              <div className="min-w-0 flex-1">
                <h1
                  className={`truncate text-xs font-bold text-white sm:text-sm ${metaLoading ? 'animate-pulse' : ''}`}
                >
                  {title}
                </h1>
                <p className="truncate text-[11px] text-white/45 sm:text-xs">{providerLabel}</p>
              </div>
              {meta ? (
                <button
                  type="button"
                  title={
                    !isAuthenticated
                      ? 'Sign in to save favourites'
                      : isFavourite(meta.id)
                        ? 'Remove favourite'
                        : 'Favourite'
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-base text-amber-400/90 transition hover:bg-white/10 sm:h-9 sm:w-9 sm:text-lg"
                  onClick={onFavouriteClick}
                >
                  {isFavourite(meta.id) ? '★' : '☆'}
                </button>
              ) : metaLoading ? (
                <div className="h-8 w-8 shrink-0 rounded-[4px] bg-white/10 sm:h-9 sm:w-9" aria-hidden />
              ) : null}
            </div>
            </div>
          </div>

          {isAuthenticated && iframeUrl ? (
            <div className={`${lobbyRailInner} shrink-0`}>
              <p className="py-1 text-center text-[11px] text-casino-muted sm:text-xs">
                Having trouble?{' '}
                <button
                  type="button"
                  className="font-medium text-casino-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setIframeUrl(null)
                    setLaunchErr(null)
                    setLaunchModeChoice(null)
                  }}
                >
                  Reload player
                </button>
              </p>
            </div>
          ) : null}

          {isAuthenticated && gameId ? (
            <div className="mt-5 sm:mt-8">
              <GameLobbyActiveChallenges catalogGameId={gameId} catalogGameKeys={catalogGameKeys} />
            </div>
          ) : null}

          {isAuthenticated && relatedGames.length > 0 && meta ? (
            <section className="border-t border-casino-border bg-casino-surface/30" aria-label="Recommended games">
              <div className={`${lobbyRailInner} py-2 sm:py-3`}>
                <h2 className="mb-2 text-xs font-bold text-casino-foreground sm:mb-2.5 sm:text-sm">Recommended</h2>
                <div className="flex gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    className="inline-flex w-8 shrink-0 items-center justify-center self-stretch rounded-casino-sm border border-white/10 bg-white/[0.04] text-casino-muted shadow-sm transition-colors duration-200 hover:border-casino-primary/45 hover:bg-casino-primary-dim hover:text-white hover:shadow-[0_0_0_1px_rgba(167,139,250,0.2)] active:brightness-95 disabled:pointer-events-none disabled:opacity-25 disabled:hover:border-white/10 disabled:hover:bg-white/[0.04] disabled:hover:text-casino-muted disabled:hover:shadow-none sm:w-9"
                    aria-label="Scroll games left"
                    disabled={!relatedScrollEdges.canLeft}
                    onClick={() => scrollRelatedRail(-1)}
                  >
                    <IconChevronLeft size={18} aria-hidden />
                  </button>
                  <div
                    ref={relatedRailRef}
                    className="scrollbar-none flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory gap-2.5 overflow-x-auto overflow-y-hidden pb-0.5 sm:gap-3"
                  >
                    {relatedGames
                      .filter((g) => g.id?.trim())
                      .map((g) => {
                        const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
                        return (
                          <RequireAuthLink
                            key={g.id}
                            to={lobbyTo}
                            className={`${relatedGameCardShell} w-[min(9.25rem,calc(100vw-6.5rem))] shrink-0 snap-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary focus-visible:ring-offset-2 focus-visible:ring-offset-casino-surface sm:w-[min(8.75rem,calc(100vw-7rem))] lg:w-[min(8.25rem,calc(100vw-8rem))]`}
                            style={{ touchAction: 'manipulation' }}
                            onClick={(e) => {
                              if (e.defaultPrevented) return
                              if (e.button !== 0) return
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                              e.preventDefault()
                              navigate(lobbyTo)
                            }}
                          >
                            <div className="relative aspect-[5/6] w-full shrink-0 overflow-hidden bg-black">
                              <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
                            </div>
                            <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-2 pb-2 pt-1.5">
                              <p className="line-clamp-2 text-[11px] font-extrabold leading-tight text-casino-foreground sm:text-xs">
                                {g.title}
                              </p>
                              {(g.provider_system?.trim() || g.provider?.trim()) ? (
                                <p className="line-clamp-1 text-[9px] font-medium text-casino-muted sm:text-[10px]">
                                  {g.provider_system?.trim() || g.provider}
                                </p>
                              ) : null}
                            </div>
                          </RequireAuthLink>
                        )
                      })}
                  </div>
                  <button
                    type="button"
                    className="inline-flex w-8 shrink-0 items-center justify-center self-stretch rounded-casino-sm border border-white/10 bg-white/[0.04] text-casino-muted shadow-sm transition-colors duration-200 hover:border-casino-primary/45 hover:bg-casino-primary-dim hover:text-white hover:shadow-[0_0_0_1px_rgba(167,139,250,0.2)] active:brightness-95 disabled:pointer-events-none disabled:opacity-25 disabled:hover:border-white/10 disabled:hover:bg-white/[0.04] disabled:hover:text-casino-muted disabled:hover:shadow-none sm:w-9"
                    aria-label="Scroll games right"
                    disabled={!relatedScrollEdges.canRight}
                    onClick={() => scrollRelatedRail(1)}
                  >
                    <IconChevronRight size={18} aria-hidden />
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {statsOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-stats-title"
        >
          <button
            type="button"
            className="absolute inset-0 border-0 bg-black/65 backdrop-blur-sm"
            aria-label="Close statistics"
            onClick={() => setStatsOpen(false)}
          />
          <div className="relative flex max-h-[min(88vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-casino-border px-4 py-3">
              <div className="min-w-0">
                <h2 id="game-stats-title" className="truncate text-sm font-bold text-casino-foreground">
                  {(() => {
                    const s = statsData?.scope
                    const name =
                      (typeof s?.catalog_title === 'string' && s.catalog_title.trim()) ||
                      meta?.title?.trim() ||
                      (typeof statsData?.local?.title === 'string' && statsData.local.title.trim()) ||
                      'This game'
                    return `Statistics — ${name}`
                  })()}
                </h2>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-casino-muted">
                  {statsData?.scope
                    ? `Per-title data for catalog id ${statsData.scope.game_id ?? gameId}${
                        typeof statsData.scope.bog_game_id === 'number' && statsData.scope.bog_game_id > 0
                          ? ` · Blue Ocean game id ${statsData.scope.bog_game_id}`
                          : ''
                      }${
                        statsData.scope.id_hash
                          ? ` · id_hash ${statsData.scope.id_hash}`
                          : ''
                      }.`
                    : meta
                      ? `Per-title data for this lobby (catalog id ${meta.id}).`
                      : `Per-title data for catalog id ${gameId}.`}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground"
                aria-label="Close"
                onClick={() => setStatsOpen(false)}
              >
                <IconX size={18} aria-hidden />
              </button>
            </div>
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
              {statsLoading ? (
                <p className="text-center text-xs text-casino-muted">Loading provider data…</p>
              ) : null}
              {statsErr ? <p className="text-center text-xs text-red-400">{statsErr}</p> : null}
              {statsData && !statsLoading ? (
                <div className="space-y-5">
                  <section>
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-casino-muted">
                      This title (our catalog)
                    </h3>
                    <p className="mb-2 text-[11px] leading-relaxed text-casino-muted/90">
                      Rows below are the single game row tied to this lobby URL — not site-wide or brand totals.
                    </p>
                    <StatsKeyValueTable
                      data={statsData.local}
                      priorityKeys={[
                        'title',
                        'id',
                        'bog_game_id',
                        'id_hash',
                        'provider_system',
                        'category',
                        'game_type',
                        'featurebuy_supported',
                        'play_for_fun_supported',
                        'is_new',
                        'metadata',
                      ]}
                    />
                  </section>
                  {statsData.blue_ocean_error ? (
                    <p className="rounded-casino-sm border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/95">
                      {statsData.blue_ocean_error}
                    </p>
                  ) : null}
                  {statsData.blue_ocean != null && statsData.blue_ocean !== undefined ? (
                    <section>
                      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-casino-muted">
                        Blue Ocean (this title)
                      </h3>
                      <p className="mb-2 text-[11px] leading-relaxed text-casino-muted/90">
                        XAPI payload for the same Blue Ocean game id as above (when the provider returns it).
                      </p>
                      {typeof statsData.blue_ocean === 'object' &&
                      statsData.blue_ocean !== null &&
                      !Array.isArray(statsData.blue_ocean) ? (
                        <StatsKeyValueTable data={statsData.blue_ocean as Record<string, unknown>} />
                      ) : (
                        <pre className="scrollbar-none max-h-56 overflow-auto whitespace-pre-wrap rounded-casino-sm bg-casino-bg/90 p-3 font-mono text-[10px] leading-relaxed text-casino-foreground/90">
                          {JSON.stringify(statsData.blue_ocean, null, 2)}
                        </pre>
                      )}
                    </section>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
