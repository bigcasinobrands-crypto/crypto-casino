import { useEffect } from 'react'

/**
 * Warns on tab close / refresh when there are unsaved edits.
 * Pair with an in-UI "Save" / "Discard" bar for full coverage (browser cannot intercept in-app navigation).
 */
export function useUnsavedChangesWarning(active: boolean, message = 'You have unsaved changes. Leave anyway?') {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = message
      return message
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active, message])
}
