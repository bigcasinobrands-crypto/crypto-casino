import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import BrandLogo from '../components/BrandLogo'
import { PortraitGameThumb } from '../components/PortraitGameThumb'
import {
  IconBarChart3,
  IconChevronLeft,
  IconExternalLink,
  IconMaximize2,
  IconMinimize2,
  IconX,
} from '../components/icons'
import {
  getCatalogReturnForNavigation,
  RESTORE_MAIN_SCROLL_STATE_KEY,
} from '../lib/catalogReturn'
import { isFavourite, pushRecent, toggleFavourite } from '../lib/gameStorage'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'

type GameMeta = {
  id: string
  title: string
  thumbnail_url?: string
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

/**
 * Full-page game lobby: catalog links here; provider iframe loads in a top-aligned “theater”
 * (chrome rows + 16:9 stage). The same shell is shown when signed out, with a sign-in overlay on the stage.
 */
export default function GameLobbyPage() {
  const { gameId: rawId } = useParams()
  const gameId = rawId ? decodeURIComponent(rawId) : ''
  const navigate = useNavigate()
  const { accessToken, apiFetch } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  const [meta, setMeta] = useState<GameMeta | null>(null)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)
  const [launchRetryNonce, setLaunchRetryNonce] = useState(0)
  const [launchModeChoice, setLaunchModeChoice] = useState<LaunchPlayMode | null>(null)
  const [, bumpFav] = useState(0)
  const refreshFav = useCallback(() => bumpFav((n) => n + 1), [])
  const relatedFetchKey = useMemo(() => {
    if (!accessToken || !gameId) return null
    const ps = meta?.provider_system?.trim()
    if (!ps) return null
    return JSON.stringify([gameId, ps])
  }, [accessToken, gameId, meta?.provider_system])
  const [relatedCache, setRelatedCache] = useState<{ key: string; games: GameMeta[] } | null>(null)

  const [statsOpen, setStatsOpen] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsErr, setStatsErr] = useState<string | null>(null)
  const [statsData, setStatsData] = useState<BlueOceanInfoResponse | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [gamePoppedOut, setGamePoppedOut] = useState(false)
  const authPromptedRef = useRef(false)

  const postAuthTarget = useMemo(
    () => (gameId ? `/casino/game-lobby/${encodeURIComponent(gameId)}` : '/casino/games'),
    [gameId],
  )

  const metaLoading = Boolean(gameId && !metaErr && !meta)

  const demoForcedById = gameId.startsWith('demo-')
  const demoAllowed = demoForcedById || meta?.play_for_fun_supported !== false
  const realAllowed = !demoForcedById

  useEffect(() => {
    if (accessToken || !gameId || metaErr) return
    if (authPromptedRef.current) return
    authPromptedRef.current = true
    openAuth('login', { navigateTo: postAuthTarget })
  }, [accessToken, gameId, metaErr, openAuth, postAuthTarget])

  useEffect(() => {
    authPromptedRef.current = false
  }, [gameId])

  useEffect(() => {
    setLaunchModeChoice(null)
  }, [gameId])

  useEffect(() => {
    setGamePoppedOut(false)
  }, [gameId])

  useEffect(() => {
    if (!iframeUrl) setGamePoppedOut(false)
  }, [iframeUrl])

  useEffect(() => {
    if (!statsOpen || !accessToken || !gameId) return
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
  }, [statsOpen, accessToken, gameId, apiFetch])

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

  const toggleGamePopOut = useCallback(() => {
    if (!iframeUrl) return
    setGamePoppedOut((prev) => {
      const next = !prev
      if (next && document.fullscreenElement) void document.exitFullscreen()
      return next
    })
  }, [iframeUrl])

  useEffect(() => {
    if (!gamePoppedOut || statsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGamePoppedOut(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gamePoppedOut, statsOpen])

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
    if (!accessToken || !gameId || !launchModeChoice) return
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
          toastPlayerApiError(apiErr, res.status, 'POST /v1/games/launch', rid)
          const msg = launchErrorMessage(apiErr?.code, formatApiError(apiErr, 'Launch failed'))
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
  }, [accessToken, apiFetch, gameId, launchModeChoice, launchRetryNonce])

  useEffect(() => {
    if (!relatedFetchKey) return
    const [gid, ps] = JSON.parse(relatedFetchKey) as [string, string]
    let cancelled = false
    void (async () => {
      try {
        const relPath = `/v1/games?integration=blueocean&limit=40&sort=name&provider=${encodeURIComponent(ps)}`
        const res = await playerFetch(relPath)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { games: GameMeta[] }
        const list = (j.games ?? []).filter((g) => g.id !== gid).slice(0, 18)
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
      navigate(ret.path, { state: { [RESTORE_MAIN_SCROLL_STATE_KEY]: ret.scrollTop } })
    } else {
      navigate('/casino/games')
    }
  }, [navigate])

  const showLaunchModeModal = Boolean(
    accessToken && meta && !metaErr && launchModeChoice === null && !iframeUrl && !launchErr,
  )

  useEffect(() => {
    if (!accessToken || !meta || metaErr || iframeUrl || launchErr || launchModeChoice !== null) return
    if (demoAllowed && !realAllowed) {
      setLaunchModeChoice('demo')
      return
    }
    if (!demoAllowed && realAllowed) {
      setLaunchModeChoice('real')
    }
  }, [
    accessToken,
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

  if (!gameId) {
    return <Navigate to="/casino/games" replace />
  }

  const relatedGames =
    relatedCache && relatedCache.key === relatedFetchKey && relatedFetchKey ? relatedCache.games : []

  const title = meta?.title ?? (metaLoading ? 'Loading game…' : 'Game lobby')
  const providerLabel = meta?.provider?.trim() || (metaLoading ? '…' : 'Casino')
  const edgeLabel =
    meta?.live || meta?.category?.toLowerCase() === 'live' ? 'Live table' : 'Casino play'
  const launchPending = Boolean(
    accessToken && launchModeChoice !== null && !metaErr && !iframeUrl && !launchErr,
  )
  const showTheater = !metaErr

  const openSignIn = () => openAuth('login', { navigateTo: postAuthTarget })
  const openRegister = () => openAuth('register', { navigateTo: postAuthTarget })

  const onFavouriteClick = () => {
    if (!meta) return
    if (!accessToken) {
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
        <div className="flex w-full min-w-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-4xl shrink-0 px-3 pt-3 sm:px-4 sm:pt-4 lg:max-w-5xl">
            <div
              ref={stageRef}
              className="w-full shrink-0 overflow-hidden rounded-casino-lg border border-casino-border bg-[#07060a] shadow-[0_8px_28px_rgba(0,0,0,0.28)]"
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
              <div className="hidden shrink-0 sm:flex">
                <BrandLogo compact className="shrink-0" />
              </div>
              <div className="relative z-20 flex shrink-0 items-center gap-px sm:gap-0.5">
                <button
                  type="button"
                  className={`${chromeIconBtn} ${gamePoppedOut ? 'bg-white/10 text-white' : ''}`}
                  title={gamePoppedOut ? 'Return game to theater' : 'Pop out game (bottom-right mini player)'}
                  aria-pressed={gamePoppedOut}
                  disabled={!iframeUrl?.trim()}
                  onClick={() => toggleGamePopOut()}
                >
                  <IconExternalLink size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className={chromeIconBtn}
                  title={
                    accessToken
                      ? 'Game statistics (Blue Ocean)'
                      : 'Sign in to view game statistics'
                  }
                  disabled={!gameId}
                  onClick={() => {
                    if (!accessToken) {
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
                    gamePoppedOut
                      ? 'Return the game to the theater to use full screen'
                      : isFullscreen
                        ? 'Exit full screen'
                        : 'Full screen'
                  }
                  disabled={gamePoppedOut}
                  onClick={() => toggleFullscreen()}
                >
                  {isFullscreen ? <IconMinimize2 size={15} aria-hidden /> : <IconMaximize2 size={15} aria-hidden />}
                </button>
              </div>
            </div>

            <div className="relative aspect-video w-full bg-black">
              {meta?.thumbnail_url ? (
                <img
                  src={meta.thumbnail_url}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    accessToken && iframeUrl && !gamePoppedOut ? 'opacity-0' : 'opacity-40'
                  }`}
                  aria-hidden
                />
              ) : null}
              <div
                className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 ${
                  accessToken && iframeUrl && !gamePoppedOut ? 'pointer-events-none opacity-0' : ''
                }`}
                aria-hidden
              />

              {accessToken && iframeUrl && gamePoppedOut ? (
                <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm font-semibold text-white/95 sm:text-base">Playing in mini player</p>
                  <p className="max-w-[18rem] text-[11px] leading-relaxed text-white/55 sm:text-xs">
                    The game is in the floating window. Close it or expand to bring it back here.
                  </p>
                  <button
                    type="button"
                    className="mt-0.5 rounded-casino-sm bg-white/12 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/18 sm:text-sm"
                    onClick={() => setGamePoppedOut(false)}
                  >
                    Return to theater
                  </button>
                </div>
              ) : null}

              {accessToken && iframeUrl && !gamePoppedOut ? (
                <iframe
                  title={title}
                  src={iframeUrl}
                  className="absolute inset-0 z-10 h-full w-full border-0 bg-black"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gamepad; gyroscope; payment; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : null}

              {!accessToken ? (
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

              {accessToken && !iframeUrl && (launchPending || launchErr) ? (
                <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 p-3 text-center sm:gap-3 sm:p-5">
                  {launchPending ? (
                    <>
                      <div
                        className="size-10 animate-spin rounded-full border-2 border-white/20 border-t-casino-primary sm:size-11"
                        aria-hidden
                      />
                      <p className="text-xs font-medium text-white/90 sm:text-sm">Connecting to provider…</p>
                      <p className="max-w-sm px-1 text-[11px] text-white/55 sm:text-xs">
                        On staging, the game window may take longer or fail while credentials are not live.
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
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-2.5 py-2 sm:px-3">
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
                    !accessToken
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

          {accessToken && iframeUrl ? (
            <div className="mx-auto w-full max-w-4xl px-3 sm:px-4 lg:max-w-5xl">
              <p className="py-2 text-center text-[11px] text-casino-muted sm:text-xs">
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

          {accessToken && relatedGames.length > 0 && meta ? (
            <section className="border-t border-casino-border bg-casino-surface/40 px-3 py-3.5 md:px-4 md:py-4">
              <div className="mb-2.5 flex flex-wrap items-end justify-between gap-1.5 sm:mb-3">
                <h2 className="text-xs font-bold text-casino-foreground sm:text-sm">
                  More from {meta.provider?.trim() || 'this studio'}
                </h2>
                <Link
                  to="/casino/games"
                  className="text-[11px] font-semibold text-casino-primary hover:underline sm:text-xs"
                >
                  Browse all games
                </Link>
              </div>
              <div className="scrollbar-none flex gap-2 overflow-x-auto pb-0.5 sm:gap-2.5">
                {relatedGames.map((g) => (
                  <Link
                    key={g.id}
                    to={`/casino/game-lobby/${encodeURIComponent(g.id)}`}
                    className="group w-[88px] shrink-0 sm:w-[100px] md:w-[108px]"
                  >
                    <div className="game-thumb-link aspect-[3/4] w-full overflow-hidden">
                      <PortraitGameThumb url={g.thumbnail_url} title={g.title} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-center text-[10px] font-medium leading-tight text-casino-muted transition group-hover:text-casino-foreground sm:text-[11px]">
                      {g.title}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {accessToken && iframeUrl && gamePoppedOut
        ? createPortal(
            <div
              className="fixed bottom-4 right-4 z-[500] flex w-[min(calc(100vw-1.25rem),22rem)] flex-col overflow-hidden rounded-casino-lg border border-white/15 bg-[#0a090e] shadow-[0_16px_48px_rgba(0,0,0,0.55)] sm:bottom-5 sm:right-5"
              role="region"
              aria-label="Mini game player"
            >
              <div className="flex items-center justify-between border-b border-white/10 bg-black/90 px-1 py-0.5">
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-white/75 transition hover:bg-white/12 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary"
                  aria-label="Close mini player"
                  title="Close mini player"
                  onClick={() => setGamePoppedOut(false)}
                >
                  <IconX size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-white/75 transition hover:bg-white/12 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary"
                  aria-label="Return game to theater"
                  title="Return to theater"
                  onClick={() => setGamePoppedOut(false)}
                >
                  <IconMaximize2 size={15} aria-hidden />
                </button>
              </div>
              <div className="relative aspect-video w-full shrink-0 bg-black">
                <iframe
                  title={title}
                  src={iframeUrl}
                  className="absolute inset-0 h-full w-full border-0 bg-black"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gamepad; gyroscope; payment; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <div className="flex items-center gap-2 border-t border-white/10 bg-black/88 px-2 py-1.5">
                {meta?.thumbnail_url ? (
                  <img src={meta.thumbnail_url} alt="" className="size-9 shrink-0 rounded object-cover" />
                ) : (
                  <div className="size-9 shrink-0 rounded bg-white/12" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{title}</p>
                  <p className="truncate text-[10px] text-white/55">{providerLabel}</p>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

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
