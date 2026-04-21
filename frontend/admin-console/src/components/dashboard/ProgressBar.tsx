import type { FC } from 'react'

interface ProgressBarProps {
  value: number
  max?: number
  label?: string
  showPct?: boolean
  color?: string
}

const ProgressBar: FC<ProgressBarProps> = ({ value, max = 100, label, showPct = true, color = 'bg-brand-500' }) => {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div>
      {(label || showPct) && (
        <div className="mb-1 flex items-center justify-between text-sm">
          {label && <span className="text-gray-600 dark:text-gray-400">{label}</span>}
          {showPct && <span className="font-medium text-gray-800 dark:text-white">{pct.toFixed(1)}%</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default ProgressBar
