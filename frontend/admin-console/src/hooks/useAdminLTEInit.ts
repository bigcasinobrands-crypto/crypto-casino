import { useEffect } from 'react'
import { OverlayScrollbars } from 'overlayscrollbars'

/**
 * Matches AdminLTE demo: custom scrollbars in `.sidebar-wrapper` on viewports > 992px.
 */
export function useAdminLTEInit() {
  useEffect(() => {
    const el = document.querySelector('.sidebar-wrapper')
    if (!el || !(el instanceof HTMLElement)) return

    const mq = window.matchMedia('(max-width: 992px)')
    let inst: ReturnType<typeof OverlayScrollbars> | undefined

    const apply = () => {
      inst?.destroy()
      inst = undefined
      if (!mq.matches) {
        inst = OverlayScrollbars(el, {
          scrollbars: {
            theme: 'os-theme-light',
            autoHide: 'leave',
            clickScroll: true,
          },
        })
      }
    }

    apply()
    mq.addEventListener('change', apply)
    return () => {
      mq.removeEventListener('change', apply)
      inst?.destroy()
    }
  }, [])
}
