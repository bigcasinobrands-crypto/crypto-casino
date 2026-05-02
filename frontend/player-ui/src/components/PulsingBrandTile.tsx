import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { DEFAULT_PLAYER_LOGO_PNG } from '../lib/brandLogoAssets'

/** Bundled wordmark — same default as `BrandLogo` / CMS fallback. */
export const BRAND_LOADER_LOGO_SRC = DEFAULT_PLAYER_LOGO_PNG

type Size = 'card' | 'hero' | 'inline'

function sizeClasses(size: Size): string {
  switch (size) {
    case 'hero':
      return 'block h-auto w-[min(78vw,280px)] max-w-[300px] object-contain object-center'
    case 'inline':
      return 'block h-auto max-h-8 w-auto max-w-[132px] object-contain object-center sm:max-h-9 sm:max-w-[152px]'
    case 'card':
    default:
      /* Horizontal wordmark centered in portrait game tiles */
      return 'block h-auto max-h-[38px] w-[84%] max-w-[168px] object-contain object-center sm:max-h-[42px] sm:max-w-[184px]'
  }
}

/** Centered vybebet logo with a gentle pulse (respects reduced motion). */
export function PulsingBrandTile({
  className = '',
  size = 'card',
}: {
  className?: string
  size?: Size
}) {
  const reduceMotion = usePrefersReducedMotion()
  return (
    <div className={`pointer-events-none flex items-center justify-center ${className}`.trim()}>
      <img
        src={BRAND_LOADER_LOGO_SRC}
        alt=""
        draggable={false}
        width={200}
        height={46}
        className={`${sizeClasses(size)} ${reduceMotion ? 'opacity-90' : 'animate-vybebet-brand-pulse'}`.trim()}
      />
    </div>
  )
}
