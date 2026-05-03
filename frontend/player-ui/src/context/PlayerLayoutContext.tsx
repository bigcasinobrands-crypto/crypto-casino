import { createContext, useContext, type ReactNode } from 'react'

/**
 * Fixed chat column width at ≥1280px (see `--shell-chat-panel-w` in casino-shell.css). Main column also
 * reserves `--shell-chat-gap` beside the drawer — mini-player docking uses panel width only as an approximation.
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
