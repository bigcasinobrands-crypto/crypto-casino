import { useState, type FC, type ReactNode } from 'react'

interface ChartCardProps {
  title: string
  children: ReactNode
  periods?: string[]
  onPeriodChange?: (period: string) => void
  className?: string
}

const ChartCard: FC<ChartCardProps> = ({ title, children, periods, onPeriodChange, className = '' }) => {
  const [active, setActive] = useState(periods?.[0] || '30d')

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h3>
        {periods && (
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => { setActive(p); onPeriodChange?.(p) }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active === p
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

export default ChartCard
