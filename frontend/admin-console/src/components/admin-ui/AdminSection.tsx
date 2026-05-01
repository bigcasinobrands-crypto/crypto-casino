import { useState, type ReactNode } from 'react'

/**
 * Collapsible section using Bootstrap / AdminLTE card styling (matches ComponentCard).
 */
export function AdminSection({
  title,
  desc,
  defaultOpen = true,
  children,
}: {
  title: string
  desc?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card shadow-sm mb-4">
      <div className="card-header d-flex flex-wrap align-items-start justify-content-between gap-2">
        <div className="min-w-0">
          <h3 className="card-title mb-0 fs-6">{title}</h3>
          {desc ? <p className="text-secondary small mb-0 mt-1">{desc}</p> : null}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary shrink-0"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {open ? <div className="card-body">{children}</div> : null}
    </div>
  )
}
