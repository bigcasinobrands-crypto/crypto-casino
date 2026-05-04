import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { PulsingBrandTile } from '../components/PulsingBrandTile'

const STORAGE_KEY = 'player-ui-initial-load-v1'

type Ctx = {
  /** Marks the first tab-session load as finished; full-screen boot overlay hides. Safe to call multiple times. */
  completeInitialLoad: () => void
}

const InitialLoadContext = createContext<Ctx | null>(null)

function readShouldShowOverlay(): boolean {
  try {
    return !sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return true
  }
}

export function InitialAppLoadProvider({ children }: { children: ReactNode }) {
  const [overlayVisible, setOverlayVisible] = useState(readShouldShowOverlay)

  const completeInitialLoad = useCallback(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore quota / private mode */
    }
    setOverlayVisible(false)
  }, [])

  const value = useMemo(() => ({ completeInitialLoad }), [completeInitialLoad])

  return (
    <InitialLoadContext.Provider value={value}>
      {children}
      {overlayVisible ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[400] flex items-center justify-center bg-casino-bg"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <PulsingBrandTile size="hero" />
        </div>
      ) : null}
    </InitialLoadContext.Provider>
  )
}

export function useCompleteInitialLoad(): () => void {
  const ctx = useContext(InitialLoadContext)
  if (!ctx) {
    return () => {}
  }
  return ctx.completeInitialLoad
}

/**
 * Casino dashboard home (`/casino/games`) clears the overlay in LobbyPage once the shell lays out;
 * non-catalog routes clear via BootNonLobbyRoutes.
 */
export function BootNonLobbyRoutes(): null {
  const { pathname } = useLocation()
  const complete = useCompleteInitialLoad()

  useEffect(() => {
    /* `/` redirects to `/casino/games` — wait for that route before deciding (avoid clearing overlay too early). */
    if (pathname === '/' || pathname === '') return
    /* Lobby catalog sections (`/casino/games`, `/casino/slots`, …) complete via LobbyPage / LobbyHomeSections. */
    if (/^\/casino\/[^/]+$/.test(pathname)) return
    complete()
  }, [pathname, complete])

  return null
}
