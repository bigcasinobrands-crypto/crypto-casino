import { Link } from 'react-router-dom'

const LOGO_SRC = '/vybebet-logo.svg'

type BrandLogoProps = {
  onNavigate?: () => void
  compact?: boolean
  className?: string
}

export default function BrandLogo({ onNavigate, compact, className = '' }: BrandLogoProps) {
  const imgClass = compact
    ? 'h-6 w-auto max-w-[118px] object-contain object-left sm:h-7 sm:max-w-[138px]'
    : 'h-8 w-auto max-w-[150px] object-contain object-left sm:h-9 sm:max-w-[190px]'
  return (
    <Link
      to="/casino/games"
      onClick={onNavigate}
      className={`flex shrink-0 items-center rounded-casino-md outline-none ring-casino-primary/0 transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-casino-primary ${className}`}
    >
      <img
        src={LOGO_SRC}
        alt="vybebet"
        width={200}
        height={46}
        decoding="async"
        className={imgClass}
      />
    </Link>
  )
}
