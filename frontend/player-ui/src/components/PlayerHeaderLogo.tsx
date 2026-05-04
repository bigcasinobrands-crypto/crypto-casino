import { Link } from 'react-router-dom'
import { useSiteContent } from '../hooks/useSiteContent'

type WordmarkSize = 'header' | 'hero' | 'card' | 'inline'

const WORDMARK_SIZE: Record<WordmarkSize, string> = {
  /** Same as original header link — top-left nav. */
  header: 'text-[15px] min-[1280px]:text-[17px]',
  /** Full-screen boot overlay. */
  hero: 'text-2xl min-[400px]:text-3xl min-[1280px]:text-4xl',
  /** Game tile + search skeletons. */
  card: 'text-base sm:text-lg',
  /** Studios strip placeholders. */
  inline: 'text-[11px] sm:text-xs',
}

type PlayerHeaderWordmarkProps = {
  className?: string
  size?: WordmarkSize
}

/**
 * Lowercase extrabold wordmark — must match the header link typography (not the SVG asset).
 * Uses `branding.site_name` from CMS when present.
 */
export function PlayerHeaderWordmark({ className = '', size = 'header' }: PlayerHeaderWordmarkProps) {
  const { getContent } = useSiteContent()
  const label = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'
  return (
    <span
      className={`font-extrabold lowercase leading-none tracking-[-0.02em] text-white ${WORDMARK_SIZE[size]} ${className}`.trim()}
    >
      {label}
    </span>
  )
}

type PlayerHeaderLogoProps = {
  className?: string
}

export default function PlayerHeaderLogo({ className = '' }: PlayerHeaderLogoProps) {
  const { getContent } = useSiteContent()
  const label = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'
  return (
    <Link
      to="/casino/games"
      className={`brand-logo-link shrink-0 text-white no-underline outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-casino-bg ${className}`}
      aria-label={`${label} — home`}
    >
      <PlayerHeaderWordmark size="header" />
    </Link>
  )
}
