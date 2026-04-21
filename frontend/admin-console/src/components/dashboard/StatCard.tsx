import type { FC, ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: string
  icon?: ReactNode
  delta?: number
  deltaLabel?: string
  className?: string
}

const StatCard: FC<StatCardProps> = ({ label, value, icon, delta, deltaLabel, className = '' }) => {
  const deltaColor = delta && delta > 0 ? 'text-green-500' : delta && delta < 0 ? 'text-red-500' : 'text-gray-400'
  const deltaArrow = delta && delta > 0 ? '↑' : delta && delta < 0 ? '↓' : ''

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          {delta !== undefined && (
            <p className={`mt-1 text-sm font-medium ${deltaColor}`}>
              {deltaArrow} {Math.abs(delta).toFixed(1)}% {deltaLabel || ''}
            </p>
          )}
        </div>
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

export default StatCard
