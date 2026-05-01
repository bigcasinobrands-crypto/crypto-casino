import { Link } from 'react-router-dom'
import { playerApiUrl } from '../../lib/playerApiUrl'

export type GameThumbRow = { id: string; title: string; thumbnail_url: string }

export function GameThumbGrid({
  title,
  ids,
  gamesById,
  variant,
}: {
  title: string
  ids: string[]
  gamesById: Map<string, GameThumbRow>
  variant: 'allowed' | 'excluded'
}) {
  if (ids.length === 0) return null
  const ring =
    variant === 'allowed' ? 'ring-1 ring-casino-success/30' : 'ring-1 ring-amber-500/25'
  return (
    <div className="mt-3">
      <h4 className="m-0 text-[10px] font-extrabold uppercase tracking-wide text-casino-muted">{title}</h4>
      <ul className="mt-2 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
        {ids.map((gid) => {
          const g = gamesById.get(gid)
          const thumb = g?.thumbnail_url?.trim() ? playerApiUrl(g.thumbnail_url.trim()) : null
          const label = g?.title?.trim() || gid
          return (
            <li key={gid} className="min-w-0">
              <Link
                to={`/casino/game-lobby/${encodeURIComponent(gid)}`}
                className={`block overflow-hidden rounded-casino-md bg-casino-elevated/80 ${ring} transition hover:brightness-110`}
              >
                <div className="aspect-square w-full bg-gradient-to-b from-casino-primary/15 to-casino-elevated">
                  {thumb ? (
                    <img src={thumb} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[10px] font-bold text-casino-muted">
                      Game
                    </div>
                  )}
                </div>
                <p className="m-0 truncate px-1 py-1 text-[9px] font-semibold text-casino-foreground" title={label}>
                  {label}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
