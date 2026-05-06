import { useEffect, useState } from 'react'

/** Viewports that use compact shell (sidebar hidden until hamburger) — matches “below desktop” header breakpoint. */
const QUERY = '(max-width: 1279px)'

export function useSubDesktopPlayerChrome(): boolean {
  const [sub, setSub] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const fn = () => setSub(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  return sub
}
