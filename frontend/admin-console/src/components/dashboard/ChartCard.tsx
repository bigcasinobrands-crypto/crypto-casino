import { type FC, type ReactNode } from 'react'

interface ChartCardProps {
  title: string
  children: ReactNode
  activePeriod?: string
  periods?: string[]
  onPeriodChange?: (period: string) => void
  className?: string
}

const ChartCard: FC<ChartCardProps> = ({
  title,
  children,
  activePeriod,
  periods,
  onPeriodChange,
  className = '',
}) => {
  const selected =
    activePeriod && periods?.includes(activePeriod) ? activePeriod : periods?.[0] ?? '30d'

  return (
    <div className={`card shadow-sm mb-4 ${className}`.trim()}>
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2 border-bottom">
        <h3 className="card-title mb-0 fs-5">{title}</h3>
        {periods && periods.length > 0 ? (
          <div className="btn-group btn-group-sm" role="group" aria-label="Date range">
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn ${selected === p ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => onPeriodChange?.(p)}
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card-body">{children}</div>
    </div>
  )
}

export default ChartCard
