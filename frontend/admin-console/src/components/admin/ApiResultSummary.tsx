import type { ReactNode } from 'react'
import { humanFieldLabel } from '../../lib/adminFormatting'

function ValueView({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (depth > 5) {
    return <span className="text-gray-500 dark:text-gray-400">…</span>
  }
  if (value === null || value === undefined) {
    return <span className="text-gray-400">—</span>
  }
  if (typeof value === 'boolean') {
    return <span>{value ? 'Yes' : 'No'}</span>
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return <span className="break-words">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-gray-400">None</span>
    }
    if (value.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) {
      return <span>{value.map((x) => String(x)).join(', ')}</span>
    }
    return (
      <ul className="mt-1 list-disc space-y-2 pl-4 text-sm">
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
      return <span className="text-gray-400">Empty</span>
    }
    return (
      <dl
        className={
          depth === 0
            ? 'grid gap-2 sm:grid-cols-2'
            : 'mt-1 space-y-2 border-l border-gray-200 pl-3 dark:border-gray-600'
        }
      >
        {keys.map((k) => (
          <div key={k} className={depth === 0 ? 'min-w-0' : ''}>
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{humanFieldLabel(k)}</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              <ValueView value={o[k]} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <span>{String(value)}</span>
}

/** Renders API JSON as labeled fields instead of a raw blob (default admin UX). */
export function ApiResultSummary({ data, embedded }: { data: unknown; embedded?: boolean }) {
  if (data === null || data === undefined) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No data.</p>
  }
  const wrap = embedded
    ? 'text-sm'
    : 'rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40'
  return (
    <div className={wrap}>
      <ValueView value={data} depth={0} />
    </div>
  )
}
