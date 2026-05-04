import { useEffect, useMemo, useState, type FC } from 'react'
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
  /** Last `src` that successfully fired `onLoad` — avoids vybebet skeleton flicker when URL/cache-buster bumps without a game-id change. */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const key = fallbackKey?.trim() || title
  const src = useMemo(() => resolveGameThumbnailUrl(url, key, thumbRev), [url, key, thumbRev])

  useEffect(() => {
    setBad(false)
  }, [src])

  const ready = !bad && loadedSrc === src
  const showShimmer = !bad && !ready

  const frame = 'relative h-full min-h-0 w-full overflow-hidden rounded-casino-md'

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
      {showShimmer ? (
        <div className="absolute inset-0 animate-pulse bg-casino-elevated" aria-hidden />
      ) : null}
      <img
        key={src}
        src={src}
        alt=""
        draggable={false}
        className={`h-full w-full object-cover object-center transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.04] ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
        loading="lazy"
        onLoad={() => setLoadedSrc(src)}
        onError={() => {
          setBad(true)
          setLoadedSrc(null)
        }}
      />
    </div>
  )
}
