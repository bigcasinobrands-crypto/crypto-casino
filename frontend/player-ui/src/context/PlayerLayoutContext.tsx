import { createContext, useContext, type ReactNode } from 'react'

/**
 * Reference width at ≥1280px. Shell layout also uses 280px for 640–1279 (see `ChatDrawer` + `shell-chat-open` in casino-shell.css).
 */
export const CHAT_DRAWER_WIDTH_PX = 240

type Ctx = {
  chatOpen: boolean
}

const PlayerLayoutContext = createContext<Ctx>({ chatOpen: false })

export function PlayerLayoutProvider({ chatOpen, children }: { chatOpen: boolean; children: ReactNode }) {
  return <PlayerLayoutContext.Provider value={{ chatOpen }}>{children}</PlayerLayoutContext.Provider>
}

export function usePlayerLayout(): Ctx {
  return useContext(PlayerLayoutContext)
}
