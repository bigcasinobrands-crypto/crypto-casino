/**
 * Renders nested/unknown API payloads as labeled fields (not raw JSON).
 *
 * Prefer `DefinitionTable` from `components/ops` for flat, known integration fields
 * where operators need fast scanability. Use `ApiResultSummary` for debug,
 * expanded row details, or `<details>` “Technical” sections.
 */
import type { ReactNode } from 'react'
import { humanFieldLabel } from '../../lib/adminFormatting'

function ValueView({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (depth > 5) {
    return <span className="text-body-secondary">…</span>
  }
  if (value === null || value === undefined) {
    return <span className="text-body-secondary">—</span>
  }
  if (typeof value === 'boolean') {
    return <span className="text-body">{value ? 'Yes' : 'No'}</span>
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return <span className="text-body text-break">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-body-secondary">None</span>
    }
    if (value.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) {
      return <span className="text-body">{value.map((x) => String(x)).join(', ')}</span>
    }
    return (
      <ul className="mt-1 mb-0 ps-3 small">
        {value.map((item, i) => (
          <li key={i}>
            <ValueView value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    )
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 0) {
      return <span className="text-body-secondary">Empty</span>
    }
    if (depth === 0) {
      return (
        <div className="row g-2 small mb-0">
          {keys.map((k) => (
            <div className="col-12 col-md-6" key={k}>
              <div className="text-body-secondary fw-medium mb-0" style={{ fontSize: '0.75rem' }}>
                {humanFieldLabel(k)}
              </div>
              <div className="text-body">
                <ValueView value={o[k]} depth={depth + 1} />
              </div>
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className="mb-0 ms-2 border-start border-secondary-subtle ps-2 small">
        {keys.map((k) => (
          <div key={k} className="mb-2">
            <div className="text-body-secondary fw-medium" style={{ fontSize: '0.7rem' }}>
              {humanFieldLabel(k)}
            </div>
            <div className="text-body">
              <ValueView value={o[k]} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return <span className="text-body">{String(value)}</span>
}

export function ApiResultSummary({ data, embedded }: { data: unknown; embedded?: boolean }) {
  if (data === null || data === undefined) {
    return <p className="text-body-secondary small mb-0">No data.</p>
  }
  const wrap = embedded ? 'text-body small' : 'card card-body shadow-sm bg-body-tertiary border-0'
  return (
    <div className={wrap}>
      <ValueView value={data} depth={0} />
    </div>
  )
}
