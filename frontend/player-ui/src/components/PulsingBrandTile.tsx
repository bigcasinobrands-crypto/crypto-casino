import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

type Size = 'card' | 'hero' | 'inline'

const LOGO_SRC = '/vybebet-logo.svg'

function logoClass(size: Size): string {
  switch (size) {
    case 'hero':
      return 'h-11 w-auto max-w-[min(72vw,260px)] sm:h-14'
    case 'inline':
      return 'h-6 w-auto max-w-[120px] sm:h-8 sm:max-w-[140px]'
    case 'card':
    default:
      return 'h-8 w-auto max-w-[min(84%,168px)] sm:h-10 sm:max-w-[184px]'
  }
}

/** Centered vybebet wordmark — same asset as header; pulse fills perceived wait without CMS dependency. */
export function PulsingBrandTile({
  className = '',
  size = 'card',
}: {
  className?: string
  size?: Size
}) {
  const reduceMotion = usePrefersReducedMotion()
  const pulse = reduceMotion ? 'opacity-90' : 'animate-pulse'
  return (
    <div className={`pointer-events-none flex items-center justify-center ${className}`.trim()}>
      <img
        src={LOGO_SRC}
        alt=""
        decoding="async"
        fetchPriority={size === 'hero' ? 'high' : 'auto'}
        className={`object-contain object-center ${logoClass(size)} ${pulse}`.trim()}
        aria-hidden
      />
    </div>
  )
}
