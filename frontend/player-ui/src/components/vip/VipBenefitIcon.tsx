import type { ReactNode } from 'react'
import {
  IconArrowUp,
  IconCloudRain,
  IconCoins,
  IconMail,
  IconSparkles,
  IconTrendingUp,
  IconZap,
} from '../icons'

type Props = { name?: string; className?: string }

export function VipBenefitIcon({ name, className }: Props): ReactNode {
  const n = (name ?? '').toLowerCase()
  const cn = className ?? ''
  switch (n) {
    case 'arrow-up-circle':
      return (
        <span className={`inline-flex ${cn}`} aria-hidden>
          <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="m16 10-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 6v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )
    case 'zap':
      return <IconZap size={14} className={cn} aria-hidden />
    case 'circle-dollar-sign':
      return <IconCoins size={14} className={cn} aria-hidden />
    case 'cloud-rain':
      return <IconCloudRain size={14} className={cn} aria-hidden />
    case 'mail':
      return <IconMail size={14} className={cn} aria-hidden />
    case 'trending-up':
      return <IconTrendingUp size={14} className={cn} aria-hidden />
    case 'sparkles':
      return <IconSparkles size={14} className={cn} aria-hidden />
    default:
      return <IconArrowUp size={14} className={cn} aria-hidden />
  }
}
