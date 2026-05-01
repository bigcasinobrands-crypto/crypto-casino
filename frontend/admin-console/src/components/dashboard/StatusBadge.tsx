import type { FC } from 'react'

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral'

const variantToBootstrap: Record<BadgeVariant, string> = {
  success: 'text-bg-success',
  error: 'text-bg-danger',
  warning: 'text-bg-warning',
  info: 'text-bg-info',
  neutral: 'text-bg-secondary',
}

interface StatusBadgeProps {
  label: string
  variant?: BadgeVariant
  dot?: boolean
}

const StatusBadge: FC<StatusBadgeProps> = ({ label, variant = 'neutral', dot = false }) => (
  <span className={`badge rounded-pill ${variantToBootstrap[variant]} d-inline-flex align-items-center gap-1`}>
    {dot ? <span className="rounded-circle bg-white bg-opacity-75 p-1" style={{ width: 6, height: 6 }} /> : null}
    {label}
  </span>
)

export default StatusBadge
