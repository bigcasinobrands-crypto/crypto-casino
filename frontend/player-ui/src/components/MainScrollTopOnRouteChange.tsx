import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { isLobbyCatalogPathname, PLAYER_MAIN_SCROLL_ID } from '../lib/catalogReturn'

/**
 * Scrolls the main shell (`#player-main-scroll`) to the top on navigation for routes that are **not**
 * the catalog lobby (`/casino/games`, `/casino/slots`, …). Those lists keep scroll for load-more
 * (same URL + key) and delegate restore/reset to {@link LobbyPage}.
 */
export default function MainScrollTopOnRouteChange() {
  const { pathname, key } = useLocation()

  useLayoutEffect(() => {
    if (isLobbyCatalogPathname(pathname)) return
    const el = document.getElementById(PLAYER_MAIN_SCROLL_ID)
    if (!el) return
    const prev = el.style.scrollBehavior
    el.style.scrollBehavior = 'auto'
    el.scrollTop = 0
    el.style.scrollBehavior = prev
  }, [pathname, key])

  return null
}
