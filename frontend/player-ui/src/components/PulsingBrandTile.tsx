import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

type Size = 'card' | 'hero' | 'inline'

function skeletonBox(size: Size, reduceMotion: boolean): string {
  const pulse = reduceMotion ? 'opacity-75' : 'animate-pulse'
  switch (size) {
    case 'hero':
      return `h-14 w-[min(72vw,260px)] rounded-xl bg-white/[0.08] ${pulse}`
    case 'inline':
      return `h-7 w-[120px] rounded-md bg-white/[0.08] sm:h-8 sm:w-[140px] ${pulse}`
    case 'card':
    default:
      return `h-[38px] w-[84%] max-w-[168px] rounded-lg bg-white/[0.08] sm:h-[42px] sm:max-w-[184px] ${pulse}`
  }
}

/** Neutral loading placeholder (no brand artwork — avoids CMS/logo coupling during shell loads). */
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
      <div className={skeletonBox(size, reduceMotion)} aria-hidden />
    </div>
  )
}
