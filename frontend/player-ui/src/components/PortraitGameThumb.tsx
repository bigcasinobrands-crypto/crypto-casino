import { useMemo, useState, type FC } from 'react'
import { resolveGameThumbnailUrl } from '../lib/gameThumbnailFallback'

/** Portrait game tile image with Pigmo-style CDN fallback when `thumbnail_url` is empty (shared by lobby grids and game lobby). */
export const PortraitGameThumb: FC<{
  url?: string
  title: string
  fallbackKey?: string
  /** From API `thumb_rev` — changes when the game row updates so tiles refetch art after sync. */
  thumbRev?: number
}> = ({ url, title, fallbackKey, thumbRev }) => {
  const [bad, setBad] = useState(false)
  const key = fallbackKey?.trim() || title
  const src = useMemo(() => resolveGameThumbnailUrl(url, key, thumbRev), [url, key, thumbRev])

  const frame = 'h-full min-h-0 w-full overflow-hidden rounded-casino-md'

  if (bad) {
    return (
      <div
        className={`${frame} flex items-center justify-center bg-casino-elevated px-2 text-center text-xs text-casino-muted`}
      >
        {title}
      </div>
    )
  }
  return (
    <div className={frame}>
      <img
        key={`${key}:${thumbRev ?? 0}`}
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover object-center transition-transform duration-300 ease-out group-hover:scale-[1.04]"
        loading="lazy"
        onError={() => setBad(true)}
      />
    </div>
  )
}
