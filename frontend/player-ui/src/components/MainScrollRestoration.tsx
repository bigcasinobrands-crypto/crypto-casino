import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearCatalogReturn,
  PLAYER_MAIN_SCROLL_ID,
  RESTORE_MAIN_SCROLL_STATE_KEY,
  type RestoreScrollLocationState,
} from '../lib/catalogReturn'

/**
 * After `navigate(catalogPath, { state: { __restoreMainScroll } })`, restores `<main>` scroll and clears state.
 */
export default function MainScrollRestoration() {
  const location = useLocation()
  const navigate = useNavigate()

  useLayoutEffect(() => {
    const st = location.state as RestoreScrollLocationState | null
    const y = st?.[RESTORE_MAIN_SCROLL_STATE_KEY]
    if (typeof y !== 'number' || !Number.isFinite(y)) return

    const apply = () => {
      const el = document.getElementById(PLAYER_MAIN_SCROLL_ID)
      if (!el) return
      const prevBehavior = el.style.scrollBehavior
      el.style.scrollBehavior = 'auto'
      el.scrollTop = Math.max(0, y)
      el.style.scrollBehavior = prevBehavior
    }
    apply()
    requestAnimationFrame(apply)

    clearCatalogReturn()

    const path = `${location.pathname}${location.search}${location.hash}`
    navigate(path, { replace: true, state: {} })
  }, [location.key, location.pathname, location.search, location.hash, location.state, navigate])

  return null
}
