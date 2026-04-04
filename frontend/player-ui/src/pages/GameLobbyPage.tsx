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
    case 'demo_unavailable':
      return 'Demo play is not available for this game.'
    case 'not_found':
      return 'Game not found or unavailable.'
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
  const { accessToken } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  const [meta, setMeta] = useState<GameMeta | null>(null)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)
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
      const res = await fetch(playerApiUrl('/v1/games/launch'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
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
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, gameId])

  if (!gameId) {
    return <Navigate to="/casino/games" replace />
  }

  const title = meta?.title ?? 'Game lobby'

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

        {!metaErr && accessToken && launchErr ? (
          <div className="text-sm">
            <p className="text-red-400">{launchErr}</p>
            <Link to="/casino/games" className="mt-4 inline-block text-casino-primary underline">
              Back to games
            </Link>
          </div>
        ) : null}

        {!metaErr && accessToken && !launchErr && !iframeUrl ? (
          <p className="text-center text-sm text-casino-muted">Loading game…</p>
        ) : null}

        {!metaErr && accessToken && iframeUrl ? (
          <iframe
            title={title}
            src={iframeUrl}
            className="min-h-[min(70vh,720px)] w-full flex-1 rounded-casino-lg border border-casino-border bg-black"
            allow="fullscreen; payment; autoplay"
          />
        ) : null}
      </div>
    </div>
  )
}
