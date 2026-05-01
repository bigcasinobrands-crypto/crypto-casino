import { createContext, useContext, type ReactNode } from 'react'

/** Must stay in sync with `ChatDrawer` panel width (`w-[240px]`). */
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
