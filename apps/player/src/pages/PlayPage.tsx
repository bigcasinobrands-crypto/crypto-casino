import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthModal } from '../authModalContext'
import { usePlayerAuth } from '../playerAuth'

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
        setErr('Launch failed')
        return
      }
      const j = (await res.json()) as { url: string }
      setUrl(j.url)
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

  if (err) return <p className="p-8 text-red-400">{err}</p>
  if (!url) return <p className="p-8 text-sm text-casino-muted">Loading game…</p>

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-2 p-4">
      <Link to="/" className="text-sm text-casino-primary">
        ← Lobby
      </Link>
      <iframe title="game" src={url} className="min-h-0 flex-1 rounded-casino-lg border border-casino-border bg-black" />
    </div>
  )
}
