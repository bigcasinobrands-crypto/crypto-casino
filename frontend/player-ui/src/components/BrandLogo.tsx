import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSiteContent } from '../hooks/useSiteContent'
import { usePlayerBrandLogoSrc } from '../hooks/usePlayerBrandLogo'
import { DEFAULT_PLAYER_LOGO_PNG, DEFAULT_PLAYER_LOGO_SVG } from '../lib/brandLogoAssets'

type BrandLogoProps = {
  onNavigate?: () => void
  compact?: boolean
  /** Tighter wordmark for auth modal / small dialogs on narrow screens. */
  micro?: boolean
  /** Use when wrapped in `ShellBrandLogoSlot`: slot is `w-fit` so the asset keeps natural proportions. */
  inHeaderSlot?: boolean
  className?: string
}

export default function BrandLogo({
  onNavigate,
  compact,
  micro,
  inHeaderSlot,
  className = '',
}: BrandLogoProps) {
  const { getContent } = useSiteContent()
  const primarySrc = usePlayerBrandLogoSrc()
  const siteLabel = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'

  const [src, setSrc] = useState(primarySrc)
  useEffect(() => {
    setSrc(primarySrc)
  }, [primarySrc])

  /** Cap size by max height only where needed; intrinsic dimensions preserved (`h-auto w-auto`, `object-contain`). */
  const imgClass = micro
    ? 'block h-auto max-h-8 w-auto max-w-[152px] shrink-0 object-contain object-left md:max-h-9 md:max-w-[172px]'
    : compact && inHeaderSlot
      ? // Header: never fill a fixed rectangle — scale down only if taller than bar (uniform scale).
        'block h-auto w-auto shrink-0 object-contain object-left max-h-[52px] md:max-h-[48px] min-[1280px]:max-h-[52px]'
      : compact
        ? 'block h-auto max-h-[56px] w-auto max-w-[280px] shrink-0 object-contain object-left md:max-h-11 md:max-w-[320px] min-[1280px]:max-h-[54px] min-[1280px]:max-w-[380px]'
        : 'block h-auto max-h-14 w-auto max-w-[260px] shrink-0 object-contain object-left md:max-h-16 md:max-w-[300px] min-[1280px]:max-h-[72px] min-[1280px]:max-w-[380px]'

  /** Opacity hover via `.brand-logo-link` + `@layer components` (fine pointer only). */
  const linkClass =
    compact && inHeaderSlot
      ? `brand-logo-link inline-flex h-fit w-fit min-w-0 max-w-full items-center justify-start rounded-casino-md outline-none ring-casino-primary/0 transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary ${className}`
      : `brand-logo-link inline-flex shrink-0 items-center rounded-casino-md outline-none ring-casino-primary/0 transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary ${className}`

  const handleError = () => {
    setSrc((prev) => {
      if (prev === DEFAULT_PLAYER_LOGO_SVG) return prev
      if (prev === DEFAULT_PLAYER_LOGO_PNG) return DEFAULT_PLAYER_LOGO_SVG
      return DEFAULT_PLAYER_LOGO_PNG
    })
  }

  return (
    <Link
      to="/casino/games"
      onClick={onNavigate}
      className={linkClass}
    >
      <img
        src={src}
        alt={siteLabel}
        decoding="async"
        className={imgClass}
        onError={handleError}
      />
    </Link>
  )
}
