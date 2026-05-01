import type { ReactNode } from 'react'

export type DefinitionRow = {
  field: string
  value: ReactNode
  /** Use monospace for IDs, ISO timestamps, codes. */
  mono?: boolean
}

type DefinitionTableProps = {
  rows: DefinitionRow[]
  className?: string
  /** When true, omit outer border for embedding in cards. */
  flush?: boolean
}

/**
 * Key/value table for integration status, flags, and structured API fields.
 *
 * **When to use this vs `ApiResultSummary`:**
 * - Use `DefinitionTable` for **known, flat** fields you want staff to scan quickly.
 * - Use `ApiResultSummary` for **nested/unknown** JSON, debug, or “technical details” collapsibles.
 */
export function DefinitionTable({ rows, className = '', flush = false }: DefinitionTableProps) {
  if (rows.length === 0) {
    return <p className="text-secondary small mb-0">No rows.</p>
  }
  const tableClass = flush
    ? 'table table-sm table-striped mb-0 align-middle'
    : 'table table-sm table-bordered mb-0 align-middle'
  return (
    <div className={`table-responsive ${className}`.trim()}>
      <table className={tableClass}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th
                scope="row"
                className="small text-secondary text-nowrap bg-body-secondary"
                style={{ width: '38%', maxWidth: 280 }}
              >
                {r.field}
              </th>
              <td className={`small ${r.mono ? 'font-monospace' : ''} text-break`}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
