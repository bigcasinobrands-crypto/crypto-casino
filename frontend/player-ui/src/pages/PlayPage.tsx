import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import { pushRecent } from '../lib/gameStorage'
import { usePlayerAuth } from '../playerAuth'

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

export default function PlayPage() {
  const { gameId } = useParams()
  const { accessToken } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken || !gameId) return
    void (async () => {
      const res = await fetch('/v1/games/launch', {
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
        setErr(msg)
        return
      }
      const j = (await res.json()) as { url: string }
      setUrl(j.url)
      if (gameId) pushRecent(gameId)
    })()
  }, [accessToken, gameId])

  if (!accessToken) {
    return (
      <p className="p-8 text-sm text-casino-muted">
        <button type="button" className="text-casino-primary underline" onClick={() => openAuth('login')}>
          Sign in
        </button>{' '}
        to play.
      </p>
    )
  }

  if (err) {
    return (
      <div className="p-8 text-sm">
        <p className="text-red-400">{err}</p>
        <Link to="/casino/blueocean" className="mt-4 inline-block text-casino-primary underline">
          ← Back to games
        </Link>
      </div>
    )
  }
  if (!url) return <p className="p-8 text-sm text-casino-muted">Loading game…</p>

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-2 p-4">
      <Link to="/casino/blueocean" className="text-sm text-casino-primary">
        ← Games
      </Link>
      <iframe title="game" src={url} className="min-h-0 flex-1 rounded-casino-lg border border-casino-border bg-black" />
    </div>
  )
}
