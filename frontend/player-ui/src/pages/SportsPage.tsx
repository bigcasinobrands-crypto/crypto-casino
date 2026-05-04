import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import {
  IconChevronLeft,
  IconExternalLink,
  IconMaximize2,
  IconMinimize2,
} from '../components/icons'
import { GAME_IFRAME_ALLOW } from '../lib/gameIframe'
import { pushRecent } from '../lib/gameStorage'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'

type SportsbookContext = {
  title: string
  thumbnail_url?: string | null
  catalog_game_id?: string | null
  uses_custom_xapi?: boolean
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
      return 'Sportsbook is not available (provider not configured).'
    case 'bog_error':
      if (/invalid\s+user\s+details/i.test(fallback)) {
        return fallback
      }
      if (
        /demo\s+game\s+not\s+available|not\s+available\s+at\s+this\s+moment/i.test(fallback) ||
        (/demo/i.test(fallback) && /not\s+available/i.test(fallback))
      ) {
        return 'The provider refused free play for this product right now. Try real play if funded, or retry later.'
      }
      return fallback
    case 'demo_unavailable':
      return 'Demo play is not available for this product.'
    case 'not_found':
      return 'Sportsbook is not in the catalog yet.'
    case 'sportsbook_unconfigured':
      return fallback
    case 'unauthorized':
      return 'Your session expired or is invalid. Sign out and sign in again.'
    default:
      return fallback
  }
}

const chromeIconBtn =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-35 sm:h-8 sm:w-8'

const CONTEXT_PATH = '/v1/sportsbook/context'

/**
 * Blue Ocean sportsbook: server resolves BO product via BLUEOCEAN_SPORTSBOOK_* env (or catalog fallback)
 * and launches with POST /v1/sportsbook/launch (getGame/getGameDemo or custom XAPI method).
 */
export default function SportsPage() {
  const navigate = useNavigate()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  /** `network` = fetch failed (API down / wrong proxy). `api` = HTTP error body from core (e.g. sportsbook not configured). */
  const [catalogLoadErr, setCatalogLoadErr] = useState<null | 'network' | { api: string }>(null)
  const [shell, setShell] = useState<SportsbookContext | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)
  const [launchRetryNonce, setLaunchRetryNonce] = useState(0)
  const [launchModeChoice, setLaunchModeChoice] = useState<LaunchPlayMode | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [gamePoppedOut, setGamePoppedOut] = useState(false)
  const authPromptedRef = useRef(false)

  const catalogGameId =
    typeof shell?.catalog_game_id === 'string' && shell.catalog_game_id.trim() !== ''
      ? shell.catalog_game_id.trim()
      : ''
  const recentKey = catalogGameId || 'blueocean-sportsbook'

  const postAuthTarget = '/casino/sports'

  const demoAllowed = true
  const realAllowed = true

  useEffect(() => {
    if (isAuthenticated || catalogLoadErr !== null || !shell) return
    if (authPromptedRef.current) return
    authPromptedRef.current = true
    openAuth('login', { navigateTo: postAuthTarget })
  }, [isAuthenticated, catalogLoadErr, shell, openAuth])

  useEffect(() => {
    authPromptedRef.current = false
  }, [recentKey])

  useEffect(() => {
    setLaunchModeChoice(null)
  }, [recentKey])

  useEffect(() => {
    setGamePoppedOut(false)
  }, [recentKey])

  useEffect(() => {
    if (!iframeUrl) setGamePoppedOut(false)
  }, [iframeUrl])

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
    if (!gamePoppedOut) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGamePoppedOut(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gamePoppedOut])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setCatalogLoadErr(null)
      setShell(null)
      try {
        const res = await playerFetch(CONTEXT_PATH)
        if (!res.ok) {
          const parsed = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(parsed, res.status, `GET ${CONTEXT_PATH}`, rid)
          if (!cancelled) {
            setCatalogLoadErr({
              api: formatApiError(
                parsed,
                'Sportsbook is not configured. Set BLUEOCEAN_SPORTSBOOK_BOG_GAME_ID or BLUEOCEAN_SPORTSBOOK_GAME_ID on the API.',
              ),
            })
          }
          return
        }
        const j = (await res.json()) as SportsbookContext
        if (!cancelled) setShell(j)
      } catch {
        toastPlayerNetworkError('Network error.', 'GET /v1/sportsbook/context')
        if (!cancelled) setCatalogLoadErr('network')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !shell || !launchModeChoice) return
    let cancelled = false
    void (async () => {
      if (!cancelled) {
        setLaunchErr(null)
        setIframeUrl(null)
      }
      try {
        const res = await apiFetch('/v1/sportsbook/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
            'POST /v1/sportsbook/launch',
            rid,
          )
          if (!cancelled) setLaunchErr(msg)
          return
        }
        const j = (await res.json()) as { url: string }
        if (!cancelled) {
          setIframeUrl(j.url)
          pushRecent(recentKey)
        }
      } catch {
        toastPlayerNetworkError(
          'Network error while launching. Check your connection and try again.',
          'POST /v1/sportsbook/launch',
        )
        if (!cancelled) setLaunchErr('Network error while launching. Check your connection and try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, apiFetch, shell, launchModeChoice, launchRetryNonce, recentKey])

  const showLaunchModeModal = Boolean(
    isAuthenticated && shell && catalogLoadErr === null && launchModeChoice === null && !iframeUrl && !launchErr,
  )

  useEffect(() => {
    if (!isAuthenticated || !shell || catalogLoadErr !== null || iframeUrl || launchErr || launchModeChoice !== null)
      return
    if (demoAllowed && !realAllowed) {
      setLaunchModeChoice('demo')
      return
    }
    if (!demoAllowed && realAllowed) {
      setLaunchModeChoice('real')
    }
  }, [isAuthenticated, shell, catalogLoadErr, iframeUrl, launchErr, launchModeChoice, demoAllowed, realAllowed])

  useEffect(() => {
    if (!showLaunchModeModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/casino/games')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showLaunchModeModal, navigate])

  const goBack = () => navigate('/casino/games')

  const openSignIn = () => openAuth('login', { navigateTo: postAuthTarget })
  const openRegister = () => openAuth('register', { navigateTo: postAuthTarget })

  const title = shell?.title?.trim() || 'Sportsbook'
  const providerLabel = 'Blue Ocean'
  const launchPending = Boolean(
    isAuthenticated && launchModeChoice !== null && catalogLoadErr === null && !iframeUrl && !launchErr,
  )
  const metaLoading = catalogLoadErr === null && !shell

  if (catalogLoadErr !== null) {
    if (catalogLoadErr === 'network') {
      return (
        <div className="mx-auto max-w-md px-4 py-7 text-center text-sm">
          <p className="text-red-400">Could not reach the game API.</p>
          <p className="mt-2 text-xs leading-relaxed text-casino-muted">
            The browser never got a response from <span className="font-mono text-[11px]">/v1/sportsbook/context</span>{' '}
            (often HTTP 0). From the repo root: start Postgres and Redis{' '}
            <span className="font-mono text-[11px]">npm run compose:up</span>, then the core API{' '}
            <span className="font-mono text-[11px]">npm run dev:api</span> (or{' '}
            <span className="font-mono text-[11px]">npm run dev:casino:stack</span> for DB + API + player). Keep{' '}
            <span className="font-mono text-[11px]">DEV_API_PROXY</span> pointing at the API (see{' '}
            <span className="font-mono text-[11px]">frontend/player-ui/.env.example</span>).
          </p>
          <button type="button" className="mt-3 inline-block text-casino-primary underline" onClick={goBack}>
            Back to games
          </button>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-md px-4 py-7 text-center text-sm">
        <p className="text-red-400">{catalogLoadErr.api}</p>
        <p className="mt-2 text-xs text-casino-muted">
          Configure BLUEOCEAN_SPORTSBOOK_BOG_GAME_ID or BLUEOCEAN_SPORTSBOOK_GAME_ID on the core API (see{' '}
          <span className="font-mono text-[11px]">services/core/.env.example</span>), or ensure a sportsbook row exists in
          the synced catalog (migration <span className="font-mono text-[11px]">00023_sportsbook_system_game.sql</span>
          ).
        </p>
        <button type="button" className="mt-3 inline-block text-casino-primary underline" onClick={goBack}>
          Back to games
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex w-full min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-4xl shrink-0 px-3 pt-3 sm:px-4 sm:pt-4 lg:max-w-5xl">
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
                  onClick={goBack}
                >
                  <IconChevronLeft size={14} aria-hidden />
                  <span className="hidden sm:inline">Games</span>
                </button>
                <span className="rounded bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white/85 sm:px-2 sm:py-0.5 sm:text-[10px]">
                  Sportsbook
                </span>
              </div>
              <div className="relative z-20 flex shrink-0 items-center gap-px sm:gap-0.5">
                <button
                  type="button"
                  className={`${chromeIconBtn} ${gamePoppedOut ? 'bg-white/10 text-white' : ''}`}
                  title={gamePoppedOut ? 'Return to theater' : 'Pop out (mini player)'}
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
                    gamePoppedOut
                      ? 'Return the player to the theater to use full screen'
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
              {shell?.thumbnail_url ? (
                <img
                  src={shell.thumbnail_url}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    isAuthenticated && iframeUrl && !gamePoppedOut ? 'opacity-0' : 'opacity-40'
                  }`}
                  aria-hidden
                />
              ) : null}
              <div
                className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 ${
                  isAuthenticated && iframeUrl && !gamePoppedOut ? 'pointer-events-none opacity-0' : ''
                }`}
                aria-hidden
              />

              {isAuthenticated && iframeUrl && gamePoppedOut ? (
                <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm font-semibold text-white/95 sm:text-base">Playing in mini player</p>
                  <button
                    type="button"
                    className="mt-0.5 rounded-casino-sm bg-white/12 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/18 sm:text-sm"
                    onClick={() => setGamePoppedOut(false)}
                  >
                    Return to theater
                  </button>
                </div>
              ) : null}

              {isAuthenticated && iframeUrl && !gamePoppedOut ? (
                <iframe
                  title={title}
                  src={iframeUrl}
                  className="absolute inset-0 z-10 h-full w-full border-0 bg-black"
                  allow={GAME_IFRAME_ALLOW}
                  allowFullScreen
                />
              ) : null}

              {!isAuthenticated ? (
                <div className="absolute inset-0 z-[8] flex flex-col items-center justify-center gap-3 p-4 text-center sm:p-5">
                  <div className="max-w-sm rounded-casino-md border border-white/15 bg-black/75 px-4 py-4 shadow-xl backdrop-blur-md sm:px-5 sm:py-4">
                    <p className="text-sm font-semibold text-white sm:text-base">Sportsbook</p>
                    <p className="mt-1.5 text-xs text-white/65 sm:text-sm">
                      Sign in to load the sportsbook. After you continue, the player opens here automatically.
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
                      onClick={goBack}
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
                  aria-labelledby="sports-launch-mode-title"
                >
                  <button
                    type="button"
                    className="absolute inset-0 border-0 bg-black/60 backdrop-blur-[3px]"
                    aria-label="Close and go back"
                    onClick={goBack}
                  />
                  <div className="relative z-10 w-full max-w-[min(100%,20rem)] overflow-hidden rounded-casino-lg border border-white/15 bg-black/90 shadow-2xl ring-1 ring-white/10">
                    <div className="border-b border-white/10 px-3 py-2.5 sm:px-4 sm:py-3">
                      <h2 id="sports-launch-mode-title" className="text-sm font-bold text-white sm:text-base">
                        Choose how to play
                      </h2>
                    </div>
                    <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:gap-2.5">
                        <button
                          type="button"
                          disabled={!realAllowed}
                          title={!realAllowed ? 'This product only supports free play.' : undefined}
                          className="flex-1 rounded-casino-md bg-casino-primary px-3 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 sm:py-3 sm:text-sm"
                          onClick={() => setLaunchModeChoice('real')}
                        >
                          Real money
                        </button>
                        <button
                          type="button"
                          disabled={!demoAllowed}
                          title={!demoAllowed ? 'Free play is not available.' : undefined}
                          className="flex-1 rounded-casino-md border border-white/18 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-white/16 disabled:pointer-events-none disabled:opacity-40 sm:py-3 sm:text-sm"
                          onClick={() => setLaunchModeChoice('demo')}
                        >
                          Free play
                        </button>
                      </div>
                      <button
                        type="button"
                        className="w-full text-center text-xs font-medium text-casino-primary underline-offset-2 hover:underline sm:text-sm"
                        onClick={goBack}
                      >
                        Back to games
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {isAuthenticated && !iframeUrl && (launchPending || launchErr) ? (
                <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 p-3 text-center sm:gap-3 sm:p-5">
                  {launchPending ? (
                    <>
                      <div
                        className="size-10 animate-spin rounded-full border-2 border-white/20 border-t-casino-primary sm:size-11"
                        aria-hidden
                      />
                      <p className="text-xs font-medium text-white/90 sm:text-sm">Connecting to sportsbook…</p>
                    </>
                  ) : null}
                  {launchErr ? (
                    <div className="mx-auto w-full max-w-[min(100%,17.5rem)] rounded-casino-md border border-white/12 bg-black/85 px-3 py-2.5 shadow-xl backdrop-blur-md sm:max-w-xs sm:px-3.5 sm:py-3">
                      <p className="text-xs font-semibold tracking-tight text-white sm:text-[13px]">
                        Could not load the sportsbook
                      </p>
                      <p className="mt-1.5 break-words text-[11px] leading-snug text-red-300/95 sm:text-xs">
                        {launchErr}
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
                          onClick={goBack}
                        >
                          Back to games
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {metaLoading ? (
                <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/50">
                  <p className="text-xs font-medium text-white/80 sm:text-sm">Loading sportsbook…</p>
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
            </div>
          </div>
        </div>

        {isAuthenticated && iframeUrl ? (
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
              {catalogGameId ? (
                <>
                  {' · '}
                  <Link
                    to={`/casino/game-lobby/${encodeURIComponent(catalogGameId)}`}
                    className="font-medium text-casino-primary underline-offset-2 hover:underline"
                  >
                    Open full game lobby
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
