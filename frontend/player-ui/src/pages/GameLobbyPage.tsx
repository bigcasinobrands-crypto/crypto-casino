import type { TFunction } from 'i18next'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import { useFavouritesRevision } from '../hooks/useFavouritesRevision'
import { GameThumbInteractiveShell } from '../components/GameThumbInteractiveShell'
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
import {
  PLAYER_CHROME_IMMERSIVE_CASINO_PLAY_EVENT,
  type PlayerChromeImmersiveCasinoPlayDetail,
} from '../lib/playerChromeEvents'
import { isFavourite, pushRecent, toggleFavouriteWithServerSync } from '../lib/gameStorage'
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
  /** Mirrors `games.game_type` when present on list/detail (e.g. live-casino). */
  game_type?: string
  live?: boolean
  /** When false, only real-money launch is offered for this title. */
  play_for_fun_supported?: boolean
  /** From catalog metadata when the sync stored description/summary/long_description. */
  description?: string
  /** From catalog metadata (`effective_rtp_pct` / `theoretical_rtp_pct`) on list responses. */
  effective_rtp_pct?: number
}

type LaunchPlayMode = 'demo' | 'real'

/** Best-effort fullscreen for the game surface (standard + legacy WebKit). */
function requestGameFullscreen(el: HTMLElement): Promise<void> {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => void
    mozRequestFullScreen?: () => void
  }
  if (typeof anyEl.requestFullscreen === 'function') {
    return anyEl.requestFullscreen().catch(() => undefined)
  }
  if (typeof anyEl.webkitRequestFullscreen === 'function') {
    try {
      anyEl.webkitRequestFullscreen()
      return Promise.resolve()
    } catch {
      return Promise.reject(new Error('webkit fullscreen failed'))
    }
  }
  if (typeof anyEl.mozRequestFullScreen === 'function') {
    try {
      anyEl.mozRequestFullScreen()
      return Promise.resolve()
    } catch {
      return Promise.reject(new Error('moz fullscreen failed'))
    }
  }
  return Promise.reject(new Error('fullscreen not supported'))
}

function launchErrorMessage(code: string | undefined, fallback: string, t: TFunction) {
  switch (code) {
    case 'maintenance':
      return t('gameLobby.error.maintenance')
    case 'launch_disabled':
      return t('gameLobby.error.launch_disabled')
    case 'geo_blocked':
      return t('gameLobby.error.geo_blocked')
    case 'self_excluded':
      return t('gameLobby.error.self_excluded')
    case 'account_closed':
      return t('gameLobby.error.account_closed')
    case 'bog_unconfigured':
      return t('gameLobby.error.bog_unconfigured')
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
        return t('gameLobby.error.providerRefusedFreePlay')
      }
      return fallback
    case 'demo_unavailable':
      return t('gameLobby.error.demo_unavailable')
    case 'not_found':
      return t('gameLobby.error.not_found')
    case 'unauthorized':
      return t('gameLobby.error.unauthorized')
    default:
      return fallback
  }
}

type GameLaunchErrorModalProps = {
  launchErr: string
  onDismiss: () => void
  onRetry: () => void
  showTryReal: boolean
  onTryReal: () => void
  backLabel: string
  onBack: () => void
}

function GameLaunchErrorModal({
  launchErr,
  onDismiss,
  onRetry,
  showTryReal,
  onTryReal,
  backLabel,
  onBack,
}: GameLaunchErrorModalProps) {
  const { t } = useTranslation()
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-launch-error-title"
    >
      <button
        type="button"
        className="absolute inset-0 border-0 bg-black/75 backdrop-blur-sm"
        aria-label={t('gameLobby.dismissError')}
        onClick={onDismiss}
      />
      <div className="relative flex max-h-[min(88vh,36rem)] w-full max-w-md flex-col overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-casino-border px-4 py-3">
          <h2 id="game-launch-error-title" className="text-sm font-bold text-casino-foreground">
            {t('gameLobby.errorModalTitle')}
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground"
            aria-label={t('gameLobby.close')}
            onClick={onDismiss}
          >
            <IconX size={18} aria-hidden />
          </button>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="break-words text-[12px] leading-snug text-red-300/95">{launchErr}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-casino-muted">
            {t('gameLobby.errorStagingHint1')}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-casino-muted">
            {t('gameLobby.errorStagingHint2')}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-casino-md bg-white px-4 py-2.5 text-xs font-semibold text-zinc-900 transition hover:bg-white/90"
              onClick={onRetry}
            >
              {t('gameLobby.tryAgain')}
            </button>
            {showTryReal ? (
              <button
                type="button"
                className="rounded-casino-md border border-casino-primary/55 bg-casino-primary/20 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-casino-primary/30"
                onClick={onTryReal}
              >
                {t('gameLobby.tryRealMoneyPlay')}
              </button>
            ) : null}
            <button
              type="button"
              className="text-center text-xs font-medium text-casino-primary underline-offset-2 hover:underline"
              onClick={onBack}
            >
              {backLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
  'group game-thumb-link flex h-full flex-col rounded-casino-md border border-white/[0.08] bg-casino-surface'

/** Match `LobbyPage` / `player-casino-max` gutters so the lobby reads at the same scale as the catalog on phones. */
const lobbyRailInner =
  'mx-auto w-full max-w-[min(100%,96rem)] px-3 sm:px-4 md:px-5 lg:px-6'

/** Above this length, mobile description uses show more / show less. */
const MOBILE_GAME_DESC_TOGGLE_CHARS = 260

/** Related rail: fetch enough rows to fill desktop after excluding current game; cap matches home strips. */
const RELATED_GAMES_FETCH_LIMIT = 64
const RELATED_GAMES_DISPLAY_CAP = 24

/** Tailwind `xl` breakpoint — viewport below this uses frameless full-screen mobile play. */
function useViewportBelowXl() {
  const [below, setBelow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1279px)').matches : false,
  )
  useLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const apply = () => setBelow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return below
}

/**
 * Full-page game lobby: catalog links here; provider iframe loads in a top-aligned theater
 * (chrome rows + stage: 16:9 for slots, taller min-height for live tables). The same shell is shown when signed out, with a sign-in overlay on the stage.
 */
export default function GameLobbyPage() {
  const { gameId: rawId } = useParams()
  const gameId = rawId ? decodeURIComponent(rawId) : ''
  const navigate = useNavigate()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const { mini, openMini, closeMini } = usePersistentMiniPlayer()
  const thisGameInMini = Boolean(gameId && mini?.gameId === gameId)
  const { t } = useTranslation()

  const [meta, setMeta] = useState<GameMeta | null>(null)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)
  /** API `code` from last failed `/v1/games/launch` — locale-safe (not translated message text). */
  const [launchFailCode, setLaunchFailCode] = useState<string | undefined>(undefined)
  const [launchRetryNonce, setLaunchRetryNonce] = useState(0)
  const [launchModeChoice, setLaunchModeChoice] = useState<LaunchPlayMode | null>(null)
  const [requestedImmersiveLaunch, setRequestedImmersiveLaunch] = useState(false)
  useFavouritesRevision()
  const descriptionFallback = useMemo(() => t('gameLobby.descriptionFallback'), [t])
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
  const [mobileLobbyDescExpanded, setMobileLobbyDescExpanded] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const viewportBelowXl = useViewportBelowXl()
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
    setRequestedImmersiveLaunch(false)
  }, [gameId])

  useEffect(() => {
    setMobileLobbyDescExpanded(false)
  }, [gameId])

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
          if (!cancelled) setStatsErr(formatApiError(apiErr, t('gameLobby.statsCouldNotLoad')))
          return
        }
        const j = (await res.json()) as BlueOceanInfoResponse
        if (!cancelled) setStatsData(j)
      } catch {
        toastPlayerNetworkError('Network error.', 'GET /v1/games/.../blueocean-info')
        if (!cancelled) setStatsErr(t('profile.networkErrorShort'))
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [statsOpen, isAuthenticated, gameId, apiFetch, t])

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
    else void requestGameFullscreen(el)
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
      title: meta?.title?.trim() || t('gameLobby.thisGame'),
      gameId,
      thumbSrc: theaterPosterSrc || '',
      providerLabel: meta?.provider_system?.trim() || meta?.provider?.trim() || t('gameLobby.casinoProviderFallback'),
    })
    if (document.fullscreenElement) void document.exitFullscreen()
  }, [iframeUrl, thisGameInMini, closeMini, openMini, meta, gameId, theaterPosterSrc, t])

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
          if (!cancelled) setMetaErr(t('gameLobby.couldNotLoadDetails'))
          return
        }
        const j = (await res.json()) as { games: GameMeta[] }
        const g = j.games?.[0]
        if (!g) {
          if (!cancelled) setMetaErr(t('gameLobby.gameNotFound'))
          return
        }
        if (!cancelled) setMeta(g)
      } catch {
        toastPlayerNetworkError('Network error loading game.', 'GET /v1/games (game meta)')
        if (!cancelled) setMetaErr(t('gameLobby.networkLoadingGame'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId, t])

  useEffect(() => {
    if (!isAuthenticated || !gameId || !launchModeChoice) return
    let cancelled = false
    void (async () => {
      if (!cancelled) {
        setLaunchErr(null)
        setLaunchFailCode(undefined)
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
          const msg = launchErrorMessage(apiErr?.code, formatApiError(apiErr, t('gameLobby.launchFailed')), t)
          toastPlayerApiError(
            apiErr ? { ...apiErr, message: msg } : null,
            res.status,
            'POST /v1/games/launch',
            rid,
          )
          if (!cancelled) {
            setRequestedImmersiveLaunch(false)
            setLaunchFailCode(apiErr?.code)
            setLaunchErr(msg)
          }
          return
        }
        const j = (await res.json()) as { url: string }
        if (!cancelled) {
          setLaunchFailCode(undefined)
          setIframeUrl(j.url)
          pushRecent(gameId)
        }
      } catch {
        toastPlayerNetworkError(
          'Network error while launching. Check your connection and try again.',
          'POST /v1/games/launch',
        )
        if (!cancelled) {
          setRequestedImmersiveLaunch(false)
          setLaunchFailCode(undefined)
          setLaunchErr(t('gameLobby.networkLaunching'))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, apiFetch, gameId, launchModeChoice, launchRetryNonce, t])

  useLayoutEffect(() => {
    if (!iframeUrl?.trim() || !requestedImmersiveLaunch || thisGameInMini) return
    let cancelled = false
    const id = window.requestAnimationFrame(() => {
      if (cancelled) return
      const el = stageRef.current
      if (!el || document.fullscreenElement === el) {
        if (!cancelled) setRequestedImmersiveLaunch(false)
        return
      }
      void requestGameFullscreen(el)
        .then(() => {
          if (!cancelled) setRequestedImmersiveLaunch(false)
        })
        .catch(() => {
          if (!cancelled) setRequestedImmersiveLaunch(false)
        })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [iframeUrl, requestedImmersiveLaunch, thisGameInMini])

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
        q.set('limit', String(RELATED_GAMES_FETCH_LIMIT))
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
          if (list.length >= RELATED_GAMES_DISPLAY_CAP) break
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
    setRequestedImmersiveLaunch(false)
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
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
    const narrow =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches
    if (demoAllowed && !realAllowed) {
      if (narrow) setRequestedImmersiveLaunch(true)
      setLaunchModeChoice('demo')
      return
    }
    if (!demoAllowed && realAllowed) {
      if (narrow) setRequestedImmersiveLaunch(true)
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

  const showInlinePlayer = Boolean(isAuthenticated && iframeUrl && !thisGameInMini)
  const showMobileFramelessPlayer = Boolean(showInlinePlayer && viewportBelowXl)

  useEffect(() => {
    const active = showMobileFramelessPlayer
    window.dispatchEvent(
      new CustomEvent<PlayerChromeImmersiveCasinoPlayDetail>(PLAYER_CHROME_IMMERSIVE_CASINO_PLAY_EVENT, {
        detail: { active },
      }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent<PlayerChromeImmersiveCasinoPlayDetail>(PLAYER_CHROME_IMMERSIVE_CASINO_PLAY_EVENT, {
          detail: { active: false },
        }),
      )
    }
  }, [showMobileFramelessPlayer])

  const exitMobileImmersivePlayer = useCallback(() => {
    setRequestedImmersiveLaunch(false)
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
    setIframeUrl(null)
    setLaunchErr(null)
    setLaunchFailCode(undefined)
    setLaunchModeChoice(null)
  }, [])

  useEffect(() => {
    if (!showMobileFramelessPlayer) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [showMobileFramelessPlayer])

  if (!gameId) {
    return <Navigate to="/casino/games" replace />
  }

  const title = meta?.title ?? (metaLoading ? t('gameLobby.loadingGame') : t('gameLobby.gameLobbyTitle'))
  const providerLabel =
    meta?.provider_system?.trim() ||
    meta?.provider?.trim() ||
    (metaLoading ? '…' : t('gameLobby.casinoProviderFallback'))
  const edgeLabel =
    meta?.live ||
    meta?.category?.toLowerCase() === 'live' ||
    meta?.game_type?.trim().toLowerCase() === 'live-casino'
      ? t('gameLobby.edgeLiveTable')
      : t('gameLobby.edgeCasinoPlay')
  /** Live tables: mobile keeps a tall min-height; desktop (xl) uses 16:9 so BO’s iframe isn’t a wide flex slab. */
  const liveTableTheater = Boolean(
    meta?.live ||
      meta?.category?.trim().toLowerCase() === 'live' ||
      meta?.game_type?.trim().toLowerCase() === 'live-casino',
  )
  /** Max width for the theater card on xl+ (slots scale with width; live table heights track below). */
  const desktopTheaterShellClass =
    'xl:mx-auto xl:w-full xl:max-w-[76.44rem] 2xl:max-w-[87.36rem]'
  const theaterStageFrameClass = liveTableTheater
    ? 'relative w-full min-h-0 bg-black max-xl:min-h-[max(280px,min(78vh,calc(100dvh-9rem)))] max-xl:sm:min-h-[max(300px,min(80vh,calc(100dvh-10rem)))] xl:aspect-video'
    : 'relative aspect-video w-full bg-black'
  /** Drop theater letterboxing / aspect caps so the iframe can fill the monitor in browser fullscreen. */
  const theaterStageFullscreenClass =
    '[&:fullscreen]:fixed [&:fullscreen]:inset-0 [&:fullscreen]:z-[250] [&:fullscreen]:m-0 [&:fullscreen]:box-border [&:fullscreen]:h-[100dvh] [&:fullscreen]:min-h-[100dvh] [&:fullscreen]:min-w-0 [&:fullscreen]:w-screen [&:fullscreen]:max-w-none ![&:fullscreen]:max-h-none [&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:bg-black [&:fullscreen]:p-0'
  const popOutButtonTitle = thisGameInMini
    ? t('gameLobby.popOutReturnTheater')
    : mini && mini.gameId !== gameId
      ? t('gameLobby.popOutReplace')
      : t('gameLobby.popOutDefault')
  const launchPending = Boolean(
    isAuthenticated && launchModeChoice !== null && !metaErr && !iframeUrl && !launchErr,
  )
  const showTheater = !metaErr
  /** Single iframe mount while playing in-page (not mini). Shown at all breakpoints; layout chrome differs by `xl`. */
  const gameDescription = meta?.description?.trim() ?? ''
  const mobileLobbyDisplayDescription =
    meta && !metaErr ? gameDescription || descriptionFallback : ''
  const mobileLobbyDescNeedsToggle = mobileLobbyDisplayDescription.length > MOBILE_GAME_DESC_TOGGLE_CHARS
  const showMobilePlayButtons = Boolean(
    isAuthenticated && meta && !metaErr && !iframeUrl && !thisGameInMini && !launchPending,
  )

  const openSignIn = () => openAuth('login', { navigateTo: postAuthTarget })
  const openRegister = () => openAuth('register', { navigateTo: postAuthTarget })

  const onFavouriteClick = () => {
    if (!meta) return
    if (!isAuthenticated) {
      openAuth('login', { navigateTo: postAuthTarget })
      return
    }
    toggleFavouriteWithServerSync(meta.id, {
      isAuthenticated,
      apiFetch,
      onSyncFailed: () => toastPlayerNetworkError(t('profile.networkErrorShort'), 'favourite sync'),
    })
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
            {t('gameLobby.backToGames')}
          </button>
        </div>
      ) : null}

      {showTheater ? (
        <div className="flex w-full min-w-0 flex-1 flex-col gap-0">
          {showInlinePlayer ? (
            <div
              className={`w-full shrink-0 px-1 pt-1 sm:px-2 sm:pt-2 md:px-3 ${desktopTheaterShellClass} xl:flex xl:min-h-0 xl:flex-1 xl:flex-col max-xl:fixed max-xl:inset-0 max-xl:z-[330] max-xl:m-0 max-xl:flex max-xl:h-auto max-xl:min-h-0 max-xl:w-full max-xl:max-w-none max-xl:shrink-0 max-xl:flex-col max-xl:bg-black max-xl:px-0 max-xl:pt-0 max-xl:touch-manipulation max-xl:[overscroll-behavior:none]`}
            >
              <div className="flex w-full min-h-0 shrink-0 flex-col overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-[0_8px_28px_rgba(0,0,0,0.45)] max-xl:min-h-0 max-xl:flex-1 max-xl:rounded-none max-xl:border-0 max-xl:shadow-none xl:min-h-0 xl:shrink xl:flex-1">
                <div className="hidden items-center gap-1.5 border-b border-white/[0.07] px-2 py-1.5 sm:gap-2 sm:px-3 xl:flex">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      aria-label={t('gameLobby.backToGamesAria')}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 hover:text-white sm:gap-1 sm:px-2 sm:py-1.5 sm:text-xs"
                      onClick={goBackToCatalog}
                    >
                      <IconChevronLeft size={14} aria-hidden />
                      <span className="hidden sm:inline">{t('gameLobby.gamesLink')}</span>
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
                        isAuthenticated ? t('gameLobby.statsSignedIn') : t('gameLobby.statsSignedOut')
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
                          ? t('gameLobby.fsReturnTheater')
                          : isFullscreen
                            ? t('gameLobby.exitFullscreen')
                            : t('gameLobby.enterFullscreen')
                      }
                      disabled={thisGameInMini}
                      onClick={() => toggleFullscreen()}
                    >
                      {isFullscreen ? <IconMinimize2 size={15} aria-hidden /> : <IconMaximize2 size={15} aria-hidden />}
                    </button>
                  </div>
                </div>
                <div className="max-xl:contents xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:justify-center">
                  <div
                    ref={stageRef}
                    className={`${theaterStageFrameClass} ${theaterStageFullscreenClass} touch-pan-y max-xl:aspect-auto max-xl:min-h-0 max-xl:!min-h-0 max-xl:min-w-0 max-xl:max-h-none max-xl:flex-1 ${liveTableTheater ? 'xl:max-h-[min(92dvh,calc(100dvh-10.5rem))]' : ''} xl:flex-none`}
                    aria-busy={launchPending}
                  >
                    <iframe
                      key={`${iframeUrl}\u0000${launchRetryNonce}`}
                      title={title}
                      src={iframeUrl ?? ''}
                      className="absolute inset-0 z-10 block h-full w-full border-0 bg-black"
                      allow={GAME_IFRAME_ALLOW}
                      allowFullScreen
                    />
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-[25] flex items-center justify-between gap-2 px-2 pt-[max(6px,env(safe-area-inset-top,0px))] xl:hidden">
                      <button
                        type="button"
                        className="pointer-events-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-black/55 text-white shadow-[0_4px_16px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.12] backdrop-blur-sm transition hover:bg-black/70"
                        aria-label={t('gameLobby.closeGameAria')}
                        onClick={exitMobileImmersivePlayer}
                      >
                        <IconChevronLeft size={20} aria-hidden />
                      </button>
                      <span className="pointer-events-none max-w-[min(56vw,14rem)] truncate text-center text-[11px] font-semibold text-white/85">
                        {title}
                      </span>
                      <div className="pointer-events-auto flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] text-white/65 shadow-[0_2px_12px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.12] transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-35"
                          title={popOutButtonTitle}
                          aria-pressed={thisGameInMini}
                          disabled={!iframeUrl?.trim()}
                          onClick={() => toggleGamePopOut()}
                        >
                          <IconExternalLink size={15} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] text-white/65 shadow-[0_2px_12px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.12] transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-35"
                          title={
                            isAuthenticated ? t('gameLobby.statsSignedIn') : t('gameLobby.statsSignedOut')
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
                      </div>
                    </div>
                  </div>
                </div>
                <div className="hidden items-center justify-between gap-2 border-t border-white/[0.07] px-2.5 py-1.5 sm:px-3 sm:py-2 xl:flex">
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
                          ? t('gameLobby.favouriteSignIn')
                          : isFavourite(meta.id)
                            ? t('gameLobby.removeFavourite')
                            : t('gameLobby.favourite')
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
              <div className={`${lobbyRailInner} hidden shrink-0 xl:block`}>
                <p className="py-1 text-center text-[11px] text-casino-muted sm:text-xs">
                  {t('gameLobby.havingTrouble')}{' '}
                  <button
                    type="button"
                    className="font-medium text-casino-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      setRequestedImmersiveLaunch(false)
                      if (typeof document !== 'undefined' && document.fullscreenElement) {
                        void document.exitFullscreen().catch(() => undefined)
                      }
                      setIframeUrl(null)
                      setLaunchErr(null)
                      setLaunchFailCode(undefined)
                      setLaunchModeChoice(null)
                    }}
                  >
                    {t('gameLobby.reloadPlayer')}
                  </button>
                </p>
              </div>
            </div>
          ) : null}

          {!showInlinePlayer ? (
            <>
          <div className="xl:hidden">
            <div className={`${lobbyRailInner} shrink-0 pb-2 pt-2 sm:pt-3`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label={t('gameLobby.backToGamesAria')}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-1 text-[11px] font-semibold text-casino-foreground/90 transition hover:bg-white/10 sm:gap-1 sm:px-2 sm:py-1.5 sm:text-xs"
                    onClick={goBackToCatalog}
                  >
                    <IconChevronLeft size={14} aria-hidden />
                  </button>
                  <span className="rounded bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-casino-foreground/90 sm:px-2 sm:py-0.5 sm:text-[10px]">
                    {edgeLabel}
                  </span>
                </div>
                {meta ? (
                  <button
                    type="button"
                    title={
                      !isAuthenticated
                        ? t('gameLobby.favouriteSignIn')
                        : isFavourite(meta.id)
                          ? t('gameLobby.removeFavourite')
                          : t('gameLobby.favourite')
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] text-lg text-amber-400/90 transition hover:bg-white/10"
                    onClick={onFavouriteClick}
                  >
                    {isFavourite(meta.id) ? '★' : '☆'}
                  </button>
                ) : metaLoading ? (
                  <div className="h-9 w-9 shrink-0 rounded-[4px] bg-white/10" aria-hidden />
                ) : null}
              </div>

              <div className="mb-3 space-y-1">
                <h1 className={`text-lg font-bold leading-snug text-casino-foreground sm:text-xl ${metaLoading ? 'animate-pulse' : ''}`}>
                  {title}
                </h1>
                <p className="text-sm text-casino-muted">{providerLabel}</p>
              </div>

              <div
                className={
                  showMobilePlayButtons
                    ? 'flex flex-row items-stretch gap-3 sm:gap-4'
                    : 'flex flex-col items-center gap-3'
                }
              >
              <div
                className={`overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-[0_8px_28px_rgba(0,0,0,0.45)] ${
                  showMobilePlayButtons
                    ? 'w-[9.25rem] shrink-0 sm:w-40'
                    : 'w-full max-w-[17rem] shrink-0'
                }`}
              >
                <div className="relative aspect-[5/6] w-full min-h-[140px] bg-black">
                  <PortraitGameThumb
                    url={meta?.thumbnail_url}
                    title={title}
                    fallbackKey={gameId}
                    thumbRev={meta?.thumb_rev}
                  />
                  {isAuthenticated && iframeUrl && thisGameInMini ? (
                    <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 bg-black/75 p-4 text-center backdrop-blur-sm">
                      <p className="text-sm font-semibold text-white">{t('gameLobby.miniPlayerTitle')}</p>
                      <p className="max-w-[18rem] text-[11px] leading-relaxed text-white/55">
                        {t('gameLobby.miniPlayerBody')}
                      </p>
                      <button
                        type="button"
                        className="mt-0.5 rounded-casino-sm bg-white/12 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/18"
                        onClick={() => closeMini()}
                      >
                        {t('gameLobby.returnToTheater')}
                      </button>
                    </div>
                  ) : null}

                  {!isAuthenticated ? (
                    <div className="absolute inset-0 z-[8] flex flex-col items-center justify-center gap-3 p-4 text-center">
                      <div className="max-w-sm rounded-casino-md border border-white/15 bg-black/75 px-4 py-4 shadow-xl backdrop-blur-md">
                        <p className="text-sm font-semibold text-white">{t('gameLobby.playThisGame')}</p>
                        <p className="mt-1.5 text-xs text-white/65">
                          {t('gameLobby.signInPromptShort')}
                        </p>
                        <div className="mt-4 flex flex-col gap-2">
                          <button
                            type="button"
                            className="rounded-casino-sm bg-casino-primary px-4 py-2 text-xs font-semibold text-white hover:brightness-110"
                            onClick={openSignIn}
                          >
                            {t('auth.signIn')}
                          </button>
                          <button
                            type="button"
                            className="rounded-casino-sm border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                            onClick={openRegister}
                          >
                            {t('auth.register')}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="mt-3 inline-block text-xs font-medium text-casino-primary underline-offset-2 hover:underline"
                          onClick={goBackToCatalog}
                        >
                          {t('gameLobby.backToGames')}
                        </button>
                      </div>
                    </div>
                  ) : null}

                </div>
              </div>

              {showMobilePlayButtons ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-end gap-2">
                  <button
                    type="button"
                    disabled={!realAllowed}
                    title={!realAllowed ? t('gameLobby.realMoneyOnlyFreePlayTitle') : undefined}
                    className="w-full rounded-casino-md bg-casino-primary px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
                    onClick={() => {
                      setRequestedImmersiveLaunch(true)
                      setLaunchModeChoice('real')
                    }}
                  >
                    {t('gameLobby.realPlay')}
                  </button>
                  <button
                    type="button"
                    disabled={!demoAllowed}
                    title={!demoAllowed ? t('gameLobby.freePlayUnavailableTitle') : undefined}
                    className="w-full rounded-casino-md border border-white/18 bg-white/10 px-4 py-3 text-sm font-semibold text-casino-foreground transition hover:bg-white/16 disabled:pointer-events-none disabled:opacity-40"
                    onClick={() => {
                      setRequestedImmersiveLaunch(true)
                      setLaunchModeChoice('demo')
                    }}
                  >
                    {t('gameLobby.demoPlay')}
                  </button>
                </div>
              ) : null}
              </div>

              {mobileLobbyDisplayDescription ? (
                <div className="mt-4">
                  <p
                    className={`whitespace-pre-line text-sm leading-relaxed text-casino-muted ${
                      mobileLobbyDescNeedsToggle && !mobileLobbyDescExpanded ? 'line-clamp-4' : ''
                    }`}
                  >
                    {mobileLobbyDisplayDescription}
                  </p>
                  {mobileLobbyDescNeedsToggle ? (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-casino-primary underline-offset-2 hover:underline"
                      onClick={() => setMobileLobbyDescExpanded((v) => !v)}
                    >
                      {mobileLobbyDescExpanded ? t('gameLobby.showLess') : t('gameLobby.showMore')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className={`hidden w-full shrink-0 px-1 pt-1 sm:px-2 sm:pt-2 md:px-3 xl:block ${desktopTheaterShellClass}`}>
            <div className="w-full shrink-0 overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-2 py-1.5 sm:gap-2 sm:px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  aria-label={t('gameLobby.backToGamesAria')}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 hover:text-white sm:gap-1 sm:px-2 sm:py-1.5 sm:text-xs"
                  onClick={goBackToCatalog}
                >
                  <IconChevronLeft size={14} aria-hidden />
                  <span className="hidden sm:inline">{t('gameLobby.gamesLink')}</span>
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
                    isAuthenticated ? t('gameLobby.statsSignedIn') : t('gameLobby.statsSignedOut')
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
                      ? t('gameLobby.fsReturnTheater')
                      : isFullscreen
                        ? t('gameLobby.exitFullscreen')
                        : t('gameLobby.enterFullscreen')
                  }
                  disabled={thisGameInMini}
                  onClick={() => toggleFullscreen()}
                >
                  {isFullscreen ? <IconMinimize2 size={15} aria-hidden /> : <IconMaximize2 size={15} aria-hidden />}
                </button>
              </div>
            </div>

            <div
              ref={stageRef}
              className={`${theaterStageFrameClass} ${theaterStageFullscreenClass}${liveTableTheater ? ' xl:max-h-[min(92dvh,calc(100dvh-10.5rem))]' : ''}`}
              aria-busy={launchPending}
            >
              <img
                src={theaterPosterSrc}
                alt=""
                className="absolute inset-0 z-0 h-full w-full object-cover opacity-40 transition-opacity duration-300"
                aria-hidden
              />
              <div
                className="absolute inset-0 z-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30"
                aria-hidden
              />

              {isAuthenticated && iframeUrl && thisGameInMini ? (
                <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm font-semibold text-white/95 sm:text-base">{t('gameLobby.miniPlayerTitle')}</p>
                  <p className="max-w-[18rem] text-[11px] leading-relaxed text-white/55 sm:text-xs">
                    {t('gameLobby.miniPlayerBody')}
                  </p>
                  <button
                    type="button"
                    className="mt-0.5 rounded-casino-sm bg-white/12 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/18 sm:text-sm"
                    onClick={() => closeMini()}
                  >
                    {t('gameLobby.returnToTheater')}
                  </button>
                </div>
              ) : null}

              {!isAuthenticated ? (
                <div className="absolute inset-0 z-[8] flex flex-col items-center justify-center gap-3 p-4 text-center sm:p-5">
                  <div className="max-w-sm rounded-casino-md border border-white/15 bg-black/75 px-4 py-4 shadow-xl backdrop-blur-md sm:px-5 sm:py-4">
                    <p className="text-sm font-semibold text-white sm:text-base">{t('gameLobby.playThisGame')}</p>
                    <p className="mt-1.5 text-xs text-white/65 sm:text-sm">
                      {t('gameLobby.signInPromptTheater')}
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                      <button
                        type="button"
                        className="rounded-casino-sm bg-casino-primary px-4 py-2 text-xs font-semibold text-white hover:brightness-110 sm:rounded-casino-md sm:px-5 sm:py-2.5 sm:text-sm"
                        onClick={openSignIn}
                      >
                        {t('auth.signIn')}
                      </button>
                      <button
                        type="button"
                        className="rounded-casino-sm border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15 sm:rounded-casino-md sm:px-5 sm:py-2.5 sm:text-sm"
                        onClick={openRegister}
                      >
                        {t('auth.register')}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="mt-3 inline-block text-xs font-medium text-casino-primary underline-offset-2 hover:underline sm:text-sm"
                      onClick={goBackToCatalog}
                    >
                      {t('gameLobby.backToGames')}
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
                    aria-label={t('gameLobby.closeLaunchModal')}
                    onClick={goBackToCatalog}
                  />
                  <div className="relative z-10 w-full max-w-[min(100%,20rem)] overflow-hidden rounded-casino-lg border border-white/15 bg-black/90 shadow-2xl ring-1 ring-white/10">
                    <div className="border-b border-white/10 px-3 py-2.5 sm:px-4 sm:py-3">
                      <h2 id="launch-mode-title" className="text-sm font-bold text-white sm:text-base">
                        {t('gameLobby.chooseHowToPlay')}
                      </h2>
                    </div>
                    <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:gap-2.5">
                        <button
                          type="button"
                          disabled={!realAllowed}
                          title={!realAllowed ? t('gameLobby.realMoneyOnlyFreePlayTitle') : undefined}
                          className="flex-1 rounded-casino-md bg-casino-primary px-3 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 sm:py-3 sm:text-sm"
                          onClick={() => {
                            setRequestedImmersiveLaunch(true)
                            setLaunchModeChoice('real')
                          }}
                        >
                          {t('gameLobby.realMoney')}
                        </button>
                        <button
                          type="button"
                          disabled={!demoAllowed}
                          title={!demoAllowed ? t('gameLobby.freePlayUnavailableTitle') : undefined}
                          className="flex-1 rounded-casino-md border border-white/18 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-white/16 disabled:pointer-events-none disabled:opacity-40 sm:py-3 sm:text-sm"
                          onClick={() => {
                            setRequestedImmersiveLaunch(true)
                            setLaunchModeChoice('demo')
                          }}
                        >
                          {t('gameLobby.freePlay')}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="w-full text-center text-xs font-medium text-casino-primary underline-offset-2 hover:underline sm:text-sm"
                        onClick={goBackToCatalog}
                      >
                        {t('gameLobby.backToGames')}
                      </button>
                    </div>
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
                      ? t('gameLobby.favouriteSignIn')
                      : isFavourite(meta.id)
                        ? t('gameLobby.removeFavourite')
                        : t('gameLobby.favourite')
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
            </>
          ) : null}

          {isAuthenticated && iframeUrl && !showInlinePlayer ? (
            <div className={`${lobbyRailInner} shrink-0`}>
              <p className="py-1 text-center text-[11px] text-casino-muted sm:text-xs">
                {t('gameLobby.havingTrouble')}{' '}
                <button
                  type="button"
                  className="font-medium text-casino-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setIframeUrl(null)
                    setLaunchErr(null)
                    setLaunchFailCode(undefined)
                    setLaunchModeChoice(null)
                  }}
                >
                  {t('gameLobby.reloadPlayer')}
                </button>
              </p>
            </div>
          ) : null}

          {isAuthenticated && gameId ? (
            <div className="mt-5 sm:mt-8">
              <GameLobbyActiveChallenges catalogGameId={gameId} catalogGameKeys={catalogGameKeys} />
            </div>
          ) : null}

          {/* Eat leftover column height so Recommended sits toward the bottom when the theater + rails are short. */}
          {isAuthenticated && relatedGames.length > 0 && meta ? (
            <div className="min-h-4 flex-1 shrink-0" aria-hidden />
          ) : null}

          {isAuthenticated && relatedGames.length > 0 && meta ? (
            <section
              className="mt-auto shrink-0 border-t border-casino-border bg-casino-surface/30 pb-3 sm:pb-4"
              aria-label={t('gameLobby.recommendedSection')}
            >
              <div className={`${lobbyRailInner} py-2 sm:py-3`}>
                <h2 className="mb-2 text-xs font-bold text-casino-foreground sm:mb-2.5 sm:text-sm">
                  {t('gameLobby.recommendedHeading')}
                </h2>
                <div className="flex gap-0 xl:gap-2">
                  <button
                    type="button"
                    className="hidden w-8 shrink-0 items-center justify-center self-stretch rounded-casino-sm border border-white/10 bg-white/[0.04] text-casino-muted shadow-sm transition-colors duration-200 hover:border-casino-primary/45 hover:bg-casino-primary-dim hover:text-white hover:shadow-[0_0_0_1px_rgba(167,139,250,0.2)] active:brightness-95 disabled:pointer-events-none disabled:opacity-25 disabled:hover:border-white/10 disabled:hover:bg-white/[0.04] disabled:hover:text-casino-muted disabled:hover:shadow-none xl:inline-flex xl:w-9"
                    aria-label={t('gameLobby.scrollGamesLeft')}
                    disabled={!relatedScrollEdges.canLeft}
                    onClick={() => scrollRelatedRail(-1)}
                  >
                    <IconChevronLeft size={18} aria-hidden />
                  </button>
                  <div
                    ref={relatedRailRef}
                    className="scrollbar-none flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pt-2 pb-0.5 max-xl:snap-none xl:gap-3"
                  >
                    {relatedGames
                      .filter((g) => g.id?.trim())
                      .map((g) => {
                        const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
                        return (
                          <RequireAuthLink
                            key={g.id}
                            to={lobbyTo}
                            aria-label={g.title}
                            className={`${relatedGameCardShell} max-xl:flex-[0_0_calc((100%-1rem)/3)] max-xl:min-w-0 xl:w-[min(8.25rem,calc(100vw-8rem))] shrink-0 snap-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary focus-visible:ring-offset-2 focus-visible:ring-offset-casino-surface`}
                            style={{ touchAction: 'manipulation' }}
                            onClick={(e) => {
                              if (e.defaultPrevented) return
                              if (e.button !== 0) return
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                              e.preventDefault()
                              navigate(lobbyTo)
                            }}
                          >
                            <div className="relative aspect-[5/6] w-full shrink-0 overflow-hidden rounded-casino-md bg-black">
                              <GameThumbInteractiveShell effectiveRtpPct={g.effective_rtp_pct}>
                                <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
                              </GameThumbInteractiveShell>
                            </div>
                          </RequireAuthLink>
                        )
                      })}
                  </div>
                  <button
                    type="button"
                    className="hidden w-8 shrink-0 items-center justify-center self-stretch rounded-casino-sm border border-white/10 bg-white/[0.04] text-casino-muted shadow-sm transition-colors duration-200 hover:border-casino-primary/45 hover:bg-casino-primary-dim hover:text-white hover:shadow-[0_0_0_1px_rgba(167,139,250,0.2)] active:brightness-95 disabled:pointer-events-none disabled:opacity-25 disabled:hover:border-white/10 disabled:hover:bg-white/[0.04] disabled:hover:text-casino-muted disabled:hover:shadow-none xl:inline-flex xl:w-9"
                    aria-label={t('gameLobby.scrollGamesRight')}
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

      {isAuthenticated && launchErr ? (
        <GameLaunchErrorModal
          launchErr={launchErr}
          onDismiss={() => {
            setLaunchErr(null)
            setLaunchFailCode(undefined)
          }}
          onRetry={() => {
            setLaunchErr(null)
            setLaunchFailCode(undefined)
            setLaunchRetryNonce((n) => n + 1)
          }}
          showTryReal={
            Boolean(
              launchModeChoice === 'demo' &&
                realAllowed &&
                launchErr &&
                (launchFailCode === 'bog_error' || launchFailCode === 'demo_unavailable'),
            )
          }
          onTryReal={() => {
            setLaunchErr(null)
            setLaunchFailCode(undefined)
            setRequestedImmersiveLaunch(true)
            setLaunchModeChoice('real')
          }}
          backLabel={showMobileFramelessPlayer ? t('gameLobby.backToGamePage') : t('gameLobby.backToGames')}
          onBack={showMobileFramelessPlayer ? exitMobileImmersivePlayer : goBackToCatalog}
        />
      ) : null}

      {statsOpen ? (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-stats-title"
        >
          <button
            type="button"
            className="absolute inset-0 border-0 bg-black/65 backdrop-blur-sm"
            aria-label={t('gameLobby.statsClose')}
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
                      t('gameLobby.thisGame')
                    return t('gameLobby.statsTitle', { name })
                  })()}
                </h2>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-casino-muted">
                  {statsData?.scope
                    ? (() => {
                        const sc = statsData.scope
                        const bogPart =
                          typeof sc.bog_game_id === 'number' && sc.bog_game_id > 0
                            ? t('gameLobby.bogGameIdFragment', { id: sc.bog_game_id })
                            : ''
                        const hashPart = sc.id_hash ? t('gameLobby.idHashFragment', { hash: sc.id_hash }) : ''
                        return t('gameLobby.statsSubtitleScope', {
                          catalogId: sc.game_id ?? gameId,
                          bogPart,
                          hashPart,
                        })
                      })()
                    : meta
                      ? t('gameLobby.statsSubtitleLobby', { id: meta.id })
                      : t('gameLobby.statsSubtitleFallback', { id: gameId })}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground"
                aria-label={t('gameLobby.close')}
                onClick={() => setStatsOpen(false)}
              >
                <IconX size={18} aria-hidden />
              </button>
            </div>
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
              {statsLoading ? (
                <p className="text-center text-xs text-casino-muted">{t('gameLobby.loadingProviderData')}</p>
              ) : null}
              {statsErr ? <p className="text-center text-xs text-red-400">{statsErr}</p> : null}
              {statsData && !statsLoading ? (
                <div className="space-y-5">
                  <section>
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-casino-muted">
                      {t('gameLobby.statsCatalogHeading')}
                    </h3>
                    <p className="mb-2 text-[11px] leading-relaxed text-casino-muted/90">
                      {t('gameLobby.statsCatalogBlurb')}
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
                        {t('gameLobby.statsBlueOceanHeading')}
                      </h3>
                      <p className="mb-2 text-[11px] leading-relaxed text-casino-muted/90">
                        {t('gameLobby.statsBlueOceanBlurb')}
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
