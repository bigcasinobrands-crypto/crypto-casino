import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayerAuth } from '../playerAuth'

type Game = {
  id: string
  title: string
  provider: string
  category: string
}

export default function LobbyPage() {
  const { accessToken, me, balanceMinor, refreshProfile, logout } = usePlayerAuth()
  const [games, setGames] = useState<Game[]>([])

  useEffect(() => {
    void (async () => {
      const res = await fetch('/v1/games')
      if (!res.ok) return
      const j = (await res.json()) as { games: Game[] }
      setGames(j.games ?? [])
    })()
  }, [])

  useEffect(() => {
    if (accessToken) void refreshProfile()
  }, [accessToken, refreshProfile])

  return (
    <div className="p-4">
      {accessToken ? (
        <p className="mb-4 text-sm text-casino-muted">
          Logged in as <span className="text-casino-foreground">{me?.email}</span> — balance minor units:{' '}
          <span className="text-casino-primary">{balanceMinor ?? '…'}</span>
          <button
            type="button"
            className="ml-4 text-xs text-casino-muted underline"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => (
          <Link
            key={g.id}
            to={`/play/${encodeURIComponent(g.id)}`}
            className="rounded-casino-lg border border-casino-border bg-casino-surface p-4 text-sm transition hover:border-casino-primary"
          >
            <div className="font-medium text-casino-foreground">{g.title}</div>
            <div className="text-casino-muted">{g.category}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
