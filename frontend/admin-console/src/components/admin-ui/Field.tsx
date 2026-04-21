import type { ReactNode } from 'react'
import { adminHintCls, adminLabelCls } from './inputStyles'

export function Field({
  label,
  hint,
  htmlFor,
  error,
  children,
  className = '',
}: {
  label: string
  hint?: string
  htmlFor?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className={adminLabelCls} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className={adminHintCls}>{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}
