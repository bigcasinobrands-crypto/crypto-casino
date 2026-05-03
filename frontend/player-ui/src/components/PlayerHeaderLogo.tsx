import { Link } from 'react-router-dom'
import { useSiteContent } from '../hooks/useSiteContent'

type PlayerHeaderLogoProps = {
  className?: string
}

/** Bold lowercase wordmark — matches footer `branding.site_name` when present. */
export default function PlayerHeaderLogo({ className = '' }: PlayerHeaderLogoProps) {
  const { getContent } = useSiteContent()
  const label = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'

  return (
    <Link
      to="/casino/games"
      className={`brand-logo-link shrink-0 text-[15px] font-extrabold lowercase leading-none tracking-[-0.02em] text-white no-underline outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-casino-bg min-[1280px]:text-[17px] ${className}`}
      aria-label={`${label} — home`}
    >
      {label}
    </Link>
  )
}
