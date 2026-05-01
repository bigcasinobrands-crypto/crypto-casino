import type { ReactNode } from 'react'

export type ComponentCardTone = 'default' | 'info' | 'warning' | 'danger'

const toneToClass: Record<ComponentCardTone, string> = {
  default: '',
  info: 'border-info',
  warning: 'border-warning',
  danger: 'border-danger',
}

interface ComponentCardProps {
  title: string
  children: React.ReactNode
  className?: string
  desc?: string
  /** Optional Bootstrap icon in header (e.g. `bi-plug`). */
  iconClass?: string
  /** Right side of header (buttons, links). */
  headerActions?: ReactNode
  /** Left border accent for emphasis. */
  tone?: ComponentCardTone
}

const ComponentCard: React.FC<ComponentCardProps> = ({
  title,
  children,
  className = '',
  desc = '',
  iconClass,
  headerActions,
  tone = 'default',
}) => {
  const accent = tone !== 'default' ? `border-start border-4 ${toneToClass[tone]}` : ''
  return (
    <div className={`card shadow-sm mb-4 ${accent} ${className}`.trim()}>
      <div className="card-header d-flex flex-wrap align-items-start justify-content-between gap-2">
        <div className="min-w-0">
          <h3 className="card-title mb-0 fs-6 d-flex align-items-center gap-2">
            {iconClass ? <i className={`bi ${iconClass} text-body-secondary`} aria-hidden /> : null}
            <span>{title}</span>
          </h3>
          {desc ? (
            <p className="text-secondary small mb-0 mt-2 lh-sm text-break">{desc}</p>
          ) : null}
        </div>
        {headerActions ? <div className="d-flex flex-wrap gap-1 align-items-center">{headerActions}</div> : null}
      </div>
      <div className="card-body">{children}</div>
    </div>
  )
}

export default ComponentCard
