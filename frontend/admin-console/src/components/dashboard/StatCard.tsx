import { type FC, type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react'

export type StatCardVariant = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary'

interface StatCardProps {
  label: string
  value: string
  /** Bootstrap Icon class, e.g. `bi-graph-up-arrow` (preferred for AdminLTE). */
  iconClass?: string
  icon?: ReactNode
  variant?: StatCardVariant
  delta?: number
  deltaLabel?: string
  className?: string
}

const StatCard: FC<StatCardProps> = ({
  label,
  value,
  iconClass,
  icon,
  variant = 'primary',
  delta,
  deltaLabel,
  className = '',
}) => {
  const bg = `text-bg-${variant}`
  const deltaText =
    delta !== undefined ? (
      <small className="d-block mt-1 opacity-75">
        {delta > 0 ? '↑' : delta < 0 ? '↓' : ''} {Math.abs(delta).toFixed(1)}% {deltaLabel ?? ''}
      </small>
    ) : null

  let iconEl: ReactNode = null
  if (iconClass) {
    iconEl = <i className={`small-box-icon bi ${iconClass}`} aria-hidden />
  } else if (icon && isValidElement(icon)) {
    iconEl = cloneElement(icon as ReactElement<{ className?: string }>, {
      className: 'small-box-icon',
    })
  } else if (icon) {
    iconEl = <span className="small-box-icon d-inline-flex opacity-25">{icon}</span>
  }

  return (
    <div className={`small-box stat-card ${bg} ${className}`.trim()}>
      <div className="inner">
        <h3 className="mb-0 text-break lh-sm" style={{ fontSize: 'clamp(1rem, 2.4vw, 1.4rem)' }}>
          {value}
        </h3>
        <p>
          {label}
          {deltaText}
        </p>
      </div>
      {iconEl}
    </div>
  )
}

export default StatCard
