import { useEffect, useState, useCallback } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import { isFavourite, pushRecent, toggleFavourite } from '../lib/gameStorage'
import { playerApiUrl } from '../lib/playerApiUrl'
import { usePlayerAuth } from '../playerAuth'

type GameMeta = {
  id: string
  title: string
  thumbnail_url?: string
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

/**
 * Full-page game lobby: player opens this route after picking a thumbnail on the catalog.
 * Launches the provider iframe here (not on the grid).
 */
export default function GameLobbyPage() {
  const { gameId: rawId } = useParams()
  const gameId = rawId ? decodeURIComponent(rawId) : ''
  const [, setSearchParams] = useSearchParams()
  const { accessToken, apiFetch } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  const [meta, setMeta] = useState<GameMeta | null>(null)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)
  const [launchRetryNonce, setLaunchRetryNonce] = useState(0)
  const [, bumpFav] = useState(0)
  const refreshFav = useCallback(() => bumpFav((n) => n + 1), [])

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
    setLaunchErr(null)
    setIframeUrl(null)
    let cancelled = false
    void (async () => {
      try {
        // Use apiFetch so 401 triggers refresh + retry (raw fetch shows "invalid or expired token").
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

  if (!gameId) {
    return <Navigate to="/casino/games" replace />
  }

  const title = meta?.title ?? 'Game lobby'
  const launchPending = Boolean(accessToken && !metaErr && !iframeUrl && !launchErr)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-casino-border bg-casino-surface px-4 py-3">
        <Link
          to="/casino/games"
          className="text-sm font-medium text-casino-primary hover:underline"
        >
          ← Games
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-casino-foreground md:text-lg">
          {title}
        </h1>
        {meta ? (
          <button
            type="button"
            title={isFavourite(meta.id) ? 'Remove favourite' : 'Favourite'}
            className="shrink-0 rounded-casino-md border border-casino-border px-3 py-1.5 text-sm text-casino-primary hover:bg-casino-elevated"
            onClick={() => {
              toggleFavourite(meta.id)
              refreshFav()
            }}
          >
            {isFavourite(meta.id) ? '★ Saved' : '☆ Save'}
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {metaErr ? (
          <div className="mx-auto max-w-md text-center text-sm">
            <p className="text-red-400">{metaErr}</p>
            <Link to="/casino/games" className="mt-4 inline-block text-casino-primary underline">
              Back to games
            </Link>
          </div>
        ) : null}

        {!metaErr && !accessToken ? (
          <div className="mx-auto flex max-w-lg flex-col items-center gap-6 text-center">
            {meta?.thumbnail_url ? (
              <div className="aspect-[3/4] w-48 overflow-hidden rounded-casino-lg border border-casino-border bg-casino-elevated shadow-lg sm:w-56">
                <img src={meta.thumbnail_url} alt="" className="h-full w-full object-cover" />
              </div>
            ) : null}
            <p className="text-sm text-casino-muted">Sign in to play this game.</p>
            <button
              type="button"
              className="w-full max-w-xs rounded-casino-md bg-casino-primary py-3 font-semibold text-casino-bg"
              onClick={() => {
                setSearchParams((sp) => {
                  sp.set('auth', 'login')
                  return sp
                })
                openAuth('login')
              }}
            >
              Sign in to play
            </button>
            <Link to="/casino/games" className="text-sm text-casino-primary underline">
              Back to games
            </Link>
          </div>
        ) : null}

        {!metaErr && accessToken ? (
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {/* YouTube-style theater: chrome bar + fixed 16:9 stage */}
            <div className="overflow-hidden rounded-casino-lg border border-casino-border bg-black shadow-2xl ring-1 ring-white/5">
              <div className="flex items-center gap-3 border-b border-white/10 bg-zinc-950 px-3 py-2 sm:px-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/95">{title}</p>
                  <p className="truncate text-xs text-white/45">Casino play</p>
                </div>
                {launchPending ? (
                  <span
                    className="inline-flex size-5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-casino-primary"
                    aria-hidden
                  />
                ) : iframeUrl ? (
                  <span className="shrink-0 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    Live
                  </span>
                ) : launchErr ? (
                  <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200">
                    Preview
                  </span>
                ) : null}
              </div>

              <div className="relative aspect-video w-full bg-zinc-950">
                {meta?.thumbnail_url ? (
                  <img
                    src={meta.thumbnail_url}
                    alt=""
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                      iframeUrl ? 'opacity-0' : 'opacity-40'
                    }`}
                    aria-hidden
                  />
                ) : null}
                <div
                  className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/30 ${
                    iframeUrl ? 'pointer-events-none opacity-0' : ''
                  }`}
                  aria-hidden
                />

                {iframeUrl ? (
                  <iframe
                    title={title}
                    src={iframeUrl}
                    className="absolute inset-0 z-10 h-full w-full border-0 bg-black"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gamepad; gyroscope; payment; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : null}

                {!iframeUrl && (launchPending || launchErr) ? (
                  <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 p-6 text-center">
                    {launchPending ? (
                      <>
                        <div
                          className="size-12 animate-spin rounded-full border-2 border-white/20 border-t-casino-primary"
                          aria-hidden
                        />
                        <p className="text-sm font-medium text-white/90">Connecting to provider…</p>
                        <p className="max-w-sm text-xs text-white/55">
                          On staging, the game window may take longer or fail while credentials are
                          not live.
                        </p>
                      </>
                    ) : null}
                    {launchErr ? (
                      <div className="max-w-md rounded-casino-lg border border-white/10 bg-black/75 px-5 py-4 shadow-xl backdrop-blur-md">
                        <p className="text-sm font-semibold text-white">Could not load the game</p>
                        <p className="mt-2 text-sm text-red-300/95">{launchErr}</p>
                        <p className="mt-3 text-xs text-white/50">
                          This is common in staging when the provider sandbox is down or IP-blocked.
                          The player frame stays here so the rest of the lobby UX still feels
                          complete.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                          <button
                            type="button"
                            className="rounded-casino-md bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white/90"
                            onClick={() => {
                              setLaunchErr(null)
                              setLaunchRetryNonce((n) => n + 1)
                            }}
                          >
                            Try again
                          </button>
                          <Link
                            to="/casino/games"
                            className="text-sm font-medium text-casino-primary underline decoration-white/30 underline-offset-2 hover:decoration-casino-primary"
                          >
                            Back to games
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {iframeUrl ? (
              <p className="mt-3 text-center text-xs text-casino-muted">
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
          </div>
        ) : null}
      </div>
    </div>
  )
}
