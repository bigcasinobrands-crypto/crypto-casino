import { useEffect } from 'react'

/**
 * AdminLTE expects `layout-fixed sidebar-expand-lg` on **document.body** (see upstream HTML).
 * Our app mounts into `#root`, so we apply these classes while the authenticated shell is mounted.
 */
const BODY_LAYOUT_CLASSES = ['layout-fixed', 'sidebar-expand-lg', 'bg-body-tertiary'] as const

export function useAdminLTEBodyLayout() {
  useEffect(() => {
    const b = document.body
    for (const c of BODY_LAYOUT_CLASSES) {
      b.classList.add(c)
    }
    return () => {
      for (const c of BODY_LAYOUT_CLASSES) {
        b.classList.remove(c)
      }
    }
  }, [])
}
