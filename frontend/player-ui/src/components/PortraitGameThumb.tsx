import { useState, type FC } from 'react'

/** Portrait game tile image with placeholder fallback (shared by lobby grids and game lobby). */
export const PortraitGameThumb: FC<{ url?: string; title: string }> = ({ url, title }) => {
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
