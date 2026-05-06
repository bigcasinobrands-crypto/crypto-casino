import { useEffect, useState } from 'react'

/** Matches `.casino-shell-mobile-header` / bottom nav breakpoint (<768px). */
const QUERY = '(max-width: 767px)'

export function useMobilePlayerChrome(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const fn = () => setNarrow(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  return narrow
}
