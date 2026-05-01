import type { FC, ReactNode } from 'react'

export type OpsToolbarProps = {
  /** Primary line (section or page context). */
  title?: string
  /** Muted supporting line (e.g. last updated, scope). */
  subtitle?: string
  /** Right-aligned actions: Refresh, Export, etc. */
  actions?: ReactNode
  className?: string
}

/**
 * Standard ops page toolbar: left context, right actions.
 * Pair with PageBreadcrumb above for full wayfinding.
 */
export const OpsToolbar: FC<OpsToolbarProps> = ({ title, subtitle, actions, className = '' }) => (
  <div
    className={`d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3 ${className}`.trim()}
  >
    <div className="min-w-0">
      {title ? <div className="fw-semibold">{title}</div> : null}
      {subtitle ? <div className="text-secondary small">{subtitle}</div> : null}
    </div>
    {actions ? <div className="d-flex flex-wrap gap-2 align-items-center">{actions}</div> : null}
  </div>
)
