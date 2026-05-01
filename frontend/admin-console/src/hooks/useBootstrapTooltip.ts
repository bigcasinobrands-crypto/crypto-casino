import { useEffect, useRef, type RefObject } from 'react'
import { Tooltip } from 'bootstrap'

/**
 * Attach a Bootstrap 5 tooltip on hover/focus. Uses `container: 'body'` so it isn’t clipped by cards.
 */
export function useBootstrapTooltip<T extends HTMLElement = HTMLElement>(
  title: string | undefined,
  customClass = 'cc-admin-tooltip',
): RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!title) return
    const el = ref.current
    if (!el) return
    const tip = new Tooltip(el, {
      title,
      placement: 'top',
      trigger: 'hover focus',
      container: 'body',
      customClass,
    })
    return () => {
      tip.dispose()
    }
  }, [title, customClass])

  return ref
}
