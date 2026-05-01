import { createElement, type ReactNode } from 'react'
import StatusBadge from '../dashboard/StatusBadge'

/** Renders a consistent on/off badge for DefinitionTable rows (avoids mixing non-component exports in DefinitionTable). */
export function definitionValueBoolean(v: boolean, trueLabel = 'Yes', falseLabel = 'No'): ReactNode {
  return createElement(StatusBadge, {
    label: v ? trueLabel : falseLabel,
    variant: v ? 'success' : 'neutral',
    dot: true,
  })
}
