import { useEffect, useState } from 'react'
import { IconCircleDollarSign } from '../icons'

const WRAP = 'flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full'

/**
 * Renders a token logo from URL; on load failure falls back to the wallet placeholder
 * (avoids broken-image icons when CDN / Logo.dev returns a bad URL).
 */
export function CryptoLogoMark({
  url,
  className = 'text-casino-primary',
}: {
  url: string | undefined
  /** Applied to the dollar fallback icon */
  className?: string
}) {
  const [bad, setBad] = useState(false)
  const normalized = url?.trim() ?? ''

  // Same component instance is reused when the wallet currency changes; reset error state + image.
  useEffect(() => {
    setBad(false)
  }, [normalized])

  if (!normalized || bad) {
    return (
      <span className={WRAP} aria-hidden>
        <IconCircleDollarSign size={16} className={className} />
      </span>
    )
  }
  return (
    <span className={WRAP}>
      <img
        key={normalized}
        src={normalized}
        alt=""
        className="size-full object-cover"
        loading="eager"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setBad(true)}
      />
    </span>
  )
}
