import type { FC } from 'react'

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral'

const colorMap: Record<BadgeVariant, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

interface StatusBadgeProps {
  label: string
  variant?: BadgeVariant
  dot?: boolean
}

const StatusBadge: FC<StatusBadgeProps> = ({ label, variant = 'neutral', dot = false }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorMap[variant]}`}>
    {dot && <span className={`h-1.5 w-1.5 rounded-full ${variant === 'success' ? 'bg-green-500' : variant === 'error' ? 'bg-red-500' : variant === 'warning' ? 'bg-amber-500' : variant === 'info' ? 'bg-blue-500' : 'bg-gray-400'}`} />}
    {label}
  </span>
)

export default StatusBadge
