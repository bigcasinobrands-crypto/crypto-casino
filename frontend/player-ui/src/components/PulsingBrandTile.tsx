import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { PlayerHeaderWordmark } from './PlayerHeaderLogo'

type Size = 'card' | 'hero' | 'inline'

/** Centered wordmark — same typography as the header (`PlayerHeaderWordmark`), with optional pulse. */
export function PulsingBrandTile({
  className = '',
  size = 'card',
}: {
  className?: string
  size?: Size
}) {
  const reduceMotion = usePrefersReducedMotion()
  const pulse = reduceMotion ? 'opacity-90' : 'animate-pulse'
  const wordSize = size === 'hero' ? 'hero' : size === 'inline' ? 'inline' : 'card'
  return (
    <div className={`pointer-events-none flex items-center justify-center ${className}`.trim()}>
      <div className={pulse}>
        <PlayerHeaderWordmark size={wordSize} />
      </div>
    </div>
  )
}
