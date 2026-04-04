import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import BrandLogo from '../components/BrandLogo'
import {
  IconBarChart3,
  IconChevronLeft,
  IconExternalLink,
  IconMaximize2,
  IconMinimize2,
} from '../components/icons'
import {
  getCatalogReturnForNavigation,
  RESTORE_MAIN_SCROLL_STATE_KEY,
} from '../lib/catalogReturn'
import { isFavourite, pushRecent, toggleFavourite } from '../lib/gameStorage'
import { playerApiUrl } from '../lib/playerApiUrl'
import { usePlayerAuth } from '../playerAuth'

type GameMeta = {
  id: string
  title: string
  thumbnail_url?: string
  provider?: string
  provider_system?: string
  category?: string
  live?: boolean
}

const PortraitThumb: FC<{ url?: string; title: string }> = ({ url, title }) => {
  const [bad, setBad] = useState(false)
  if (!url || bad) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-casino-elevated px-2 text-center text-xs text-casino-muted">
        {title}
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="h-full w-full object-cover object-center transition-transform duration-300 ease-out group-hover:scale-[1.04]"
      loading="lazy"
      onError={() => setBad(true)}
    />
  )
}

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
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-35'

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
  const [, bumpFav] = useState(0)
  const refreshFav = useCallback(() => bumpFav((n) => n + 1), [])
  const [relatedGames, setRelatedGames] = useState<GameMeta[]>([])

  const stageRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const authPromptedRef = useRef(false)

  const postAuthTarget = useMemo(
    () => (gameId ? `/casino/game-lobby/${encodeURIComponent(gameId)}` : '/casino/games'),
    [gameId],
  )

  const metaLoading = Boolean(gameId && !metaErr && !meta)

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

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    void (async () => {
      setMetaErr(null)
      try {
        const res = await fetch(
          playerApiUrl(
            `/v1/games?integration=blueocean&limit=1&ids=${encodeURIComponent(gameId)}`,
          ),
        )
        if (!res.ok) {
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
        if (!cancelled) setMetaErr('Network error loading game.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId])

  useEffect(() => {
    if (!accessToken || !gameId) return
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
          body: JSON.stringify({ game_id: gameId }),
        })
        if (!res.ok) {
          const apiErr = await readApiError(res)
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
        if (!cancelled) setLaunchErr('Network error while launching. Check your connection and try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, apiFetch, gameId, launchRetryNonce])

  useEffect(() => {
    if (!accessToken || !meta?.provider_system || !gameId) {
      setRelatedGames([])
      return
    }
    const ps = meta.provider_system.trim()
    if (!ps) {
      setRelatedGames([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          playerApiUrl(
            `/v1/games?integration=blueocean&limit=40&sort=name&provider=${encodeURIComponent(ps)}`,
          ),
        )
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { games: GameMeta[] }
        const list = (j.games ?? []).filter((g) => g.id !== gameId).slice(0, 18)
        if (!cancelled) setRelatedGames(list)
      } catch {
        if (!cancelled) setRelatedGames([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, gameId, meta?.provider_system])

  if (!gameId) {
    return <Navigate to="/casino/games" replace />
  }

  const title = meta?.title ?? (metaLoading ? 'Loading game…' : 'Game lobby')
  const providerLabel = meta?.provider?.trim() || (metaLoading ? '…' : 'Casino')
  const edgeLabel =
    meta?.live || meta?.category?.toLowerCase() === 'live' ? 'Live table' : 'Casino play'
  const launchPending = Boolean(accessToken && !metaErr && !iframeUrl && !launchErr)
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

  const goBackToCatalog = useCallback(() => {
    const ret = getCatalogReturnForNavigation()
    if (ret) {
      navigate(ret.path, { state: { [RESTORE_MAIN_SCROLL_STATE_KEY]: ret.scrollTop } })
    } else {
      navigate('/casino/games')
    }
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {metaErr ? (
        <div className="mx-auto max-w-md px-4 py-10 text-center text-sm">
          <p className="text-red-400">{metaErr}</p>
          <button
            type="button"
            className="mt-4 inline-block text-casino-primary underline"
            onClick={goBackToCatalog}
          >
            Back to games
          </button>
        </div>
      ) : null}

      {showTheater ? (
        <div className="flex w-full min-w-0 flex-1 flex-col">
          <div
            ref={stageRef}
            className="w-full shrink-0 overflow-hidden border-b border-casino-border bg-[#07060a] shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
          >
            <div className="flex items-center gap-2 border-b border-white/[0.07] px-2 py-2 sm:gap-3 sm:px-4">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  aria-label="Back to games"
                  className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-2 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white sm:text-sm"
                  onClick={goBackToCatalog}
                >
                  <IconChevronLeft size={16} aria-hidden />
                  <span className="hidden sm:inline">Games</span>
                </button>
                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/85 sm:text-[11px]">
                  {edgeLabel}
                </span>
              </div>
              <div className="hidden shrink-0 sm:flex">
                <BrandLogo compact className="shrink-0" />
              </div>
              <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                <button
                  type="button"
                  className={chromeIconBtn}
                  title="Open in new tab"
                  disabled={!iframeUrl}
                  onClick={() => iframeUrl && window.open(iframeUrl, '_blank', 'noopener,noreferrer')}
                >
                  <IconExternalLink size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${chromeIconBtn} opacity-50`}
                  title="Statistics (coming soon)"
                  aria-disabled="true"
                  disabled
                >
                  <IconBarChart3 size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={chromeIconBtn}
                  title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  onClick={() => toggleFullscreen()}
                >
                  {isFullscreen ? <IconMinimize2 size={16} aria-hidden /> : <IconMaximize2 size={16} aria-hidden />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2.5 sm:px-4">
              <div className="min-w-0 flex-1">
                <h1
                  className={`truncate text-sm font-bold text-white sm:text-base ${metaLoading ? 'animate-pulse' : ''}`}
                >
                  {title}
                </h1>
                <p className="truncate text-xs text-white/45">{providerLabel}</p>
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] text-lg text-amber-400/90 transition hover:bg-white/10"
                  onClick={onFavouriteClick}
                >
                  {isFavourite(meta.id) ? '★' : '☆'}
                </button>
              ) : metaLoading ? (
                <div className="h-9 w-9 shrink-0 rounded-[4px] bg-white/10" aria-hidden />
              ) : null}
            </div>

            <div className="relative aspect-video w-full bg-black">
              {meta?.thumbnail_url ? (
                <img
                  src={meta.thumbnail_url}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    accessToken && iframeUrl ? 'opacity-0' : 'opacity-40'
                  }`}
                  aria-hidden
                />
              ) : null}
              <div
                className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 ${
                  accessToken && iframeUrl ? 'pointer-events-none opacity-0' : ''
                }`}
                aria-hidden
              />

              {accessToken && iframeUrl ? (
                <iframe
                  title={title}
                  src={iframeUrl}
                  className="absolute inset-0 z-10 h-full w-full border-0 bg-black"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gamepad; gyroscope; payment; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : null}

              {!accessToken ? (
                <div className="absolute inset-0 z-[8] flex flex-col items-center justify-center gap-4 p-6 text-center">
                  <div className="max-w-sm rounded-casino-lg border border-white/15 bg-black/75 px-6 py-5 shadow-2xl backdrop-blur-md">
                    <p className="text-base font-semibold text-white">Play this game</p>
                    <p className="mt-2 text-sm text-white/65">
                      Sign in or create an account. After you continue, this game loads here automatically.
                    </p>
                    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                      <button
                        type="button"
                        className="rounded-casino-md bg-casino-primary px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110"
                        onClick={openSignIn}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        className="rounded-casino-md border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15"
                        onClick={openRegister}
                      >
                        Register
                      </button>
                    </div>
                    <button
                      type="button"
                      className="mt-4 inline-block text-sm font-medium text-casino-primary underline-offset-2 hover:underline"
                      onClick={goBackToCatalog}
                    >
                      Back to games
                    </button>
                  </div>
                </div>
              ) : null}

              {accessToken && !iframeUrl && (launchPending || launchErr) ? (
                <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 p-4 text-center sm:p-6">
                  {launchPending ? (
                    <>
                      <div
                        className="size-12 animate-spin rounded-full border-2 border-white/20 border-t-casino-primary"
                        aria-hidden
                      />
                      <p className="text-sm font-medium text-white/90">Connecting to provider…</p>
                      <p className="max-w-sm text-xs text-white/55">
                        On staging, the game window may take longer or fail while credentials are not live.
                      </p>
                    </>
                  ) : null}
                  {launchErr ? (
                    <div className="mx-auto w-full max-w-[min(100%,17.5rem)] rounded-casino-md border border-white/12 bg-black/85 px-3.5 py-3 shadow-xl backdrop-blur-md sm:max-w-xs sm:px-4 sm:py-3.5">
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
          </div>

          {accessToken && iframeUrl ? (
            <p className="px-4 py-3 text-center text-xs text-casino-muted">
              Having trouble?{' '}
              <button
                type="button"
                className="font-medium text-casino-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setIframeUrl(null)
                  setLaunchErr(null)
                  setLaunchRetryNonce((n) => n + 1)
                }}
              >
                Reload player
              </button>
            </p>
          ) : null}

          {accessToken && relatedGames.length > 0 && meta ? (
            <section className="border-t border-casino-border bg-casino-surface/40 px-4 py-6 md:px-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-sm font-bold text-casino-foreground">
                  More from {meta.provider?.trim() || 'this studio'}
                </h2>
                <Link
                  to="/casino/games"
                  className="text-xs font-semibold text-casino-primary hover:underline"
                >
                  Browse all games
                </Link>
              </div>
              <div className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
                {relatedGames.map((g) => (
                  <Link
                    key={g.id}
                    to={`/casino/game-lobby/${encodeURIComponent(g.id)}`}
                    className="group w-[104px] shrink-0 sm:w-[118px]"
                  >
                    <div className="game-thumb-link aspect-[3/4] w-full overflow-hidden">
                      <PortraitThumb url={g.thumbnail_url} title={g.title} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-center text-[11px] font-medium leading-tight text-casino-muted transition group-hover:text-casino-foreground">
                      {g.title}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
