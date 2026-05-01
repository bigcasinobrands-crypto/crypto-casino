import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { IconMaximize2, IconX } from '../components/icons'
import { GAME_IFRAME_ALLOW } from '../lib/gameIframe'
import { CHAT_DRAWER_WIDTH_PX, usePlayerLayout } from './PlayerLayoutContext'
import { usePlayerAuth } from '../playerAuth'

export type PersistentMiniPlayerPayload = {
  iframeUrl: string
  title: string
  gameId: string
  thumbSrc: string
  providerLabel: string
}

type Ctx = {
  mini: PersistentMiniPlayerPayload | null
  openMini: (p: PersistentMiniPlayerPayload) => void
  closeMini: () => void
}

const PersistentMiniPlayerContext = createContext<Ctx | null>(null)

export function PersistentMiniPlayerProvider({ children }: { children: ReactNode }) {
  const [mini, setMini] = useState<PersistentMiniPlayerPayload | null>(null)
  const { isAuthenticated } = usePlayerAuth()

  useEffect(() => {
    if (!isAuthenticated) setMini(null)
  }, [isAuthenticated])

  const openMini = useCallback((p: PersistentMiniPlayerPayload) => {
    setMini(p)
  }, [])

  const closeMini = useCallback(() => setMini(null), [])

  const value = useMemo(() => ({ mini, openMini, closeMini }), [mini, openMini, closeMini])

  return (
    <PersistentMiniPlayerContext.Provider value={value}>
      {children}
      <PersistentMiniPlayerPortal />
    </PersistentMiniPlayerContext.Provider>
  )
}

export function usePersistentMiniPlayer(): Ctx {
  const v = useContext(PersistentMiniPlayerContext)
  if (!v) throw new Error('usePersistentMiniPlayer must be used within PersistentMiniPlayerProvider')
  return v
}

const VIEW_MARGIN_PX = 8

type PanelPos = { left: number; top: number }

function dockBottomRight(chatOpen: boolean, panelW: number, panelH: number): PanelPos {
  const sm = typeof window !== 'undefined' && window.matchMedia('(min-width:640px)').matches
  const edge = sm ? 20 : 16
  const rightReserve = (chatOpen ? CHAT_DRAWER_WIDTH_PX : 0) + edge
  const left = Math.round(window.innerWidth - panelW - rightReserve)
  const top = Math.round(window.innerHeight - panelH - edge)
  return clampTopLeft(left, top, panelW, panelH)
}

function clampTopLeft(left: number, top: number, panelW: number, panelH: number): PanelPos {
  const m = VIEW_MARGIN_PX
  const maxL = window.innerWidth - m - panelW
  const maxT = window.innerHeight - m - panelH
  return {
    left: Math.round(Math.min(maxL, Math.max(m, left))),
    top: Math.round(Math.min(maxT, Math.max(m, top))),
  }
}

function PersistentMiniPlayerPortal() {
  const navigate = useNavigate()
  const { mini, closeMini } = usePersistentMiniPlayer()
  const { chatOpen } = usePlayerLayout()
  const rootRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<PanelPos>({ left: 0, top: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ px: number; py: number; left: number; top: number } | null>(null)
  const panelPosRef = useRef<PanelPos>({ left: 0, top: 0 })
  const prevGameIdRef = useRef<string | undefined>(undefined)
  const prevChatOpenRef = useRef(false)

  useEffect(() => {
    panelPosRef.current = panelPos
  }, [panelPos])

  useLayoutEffect(() => {
    if (!mini) {
      prevGameIdRef.current = undefined
      prevChatOpenRef.current = chatOpen
      return
    }
    const el = rootRef.current
    if (!el) return
    const { width: w, height: h } = el.getBoundingClientRect()
    if (w < 2 || h < 2) return
    const prevId = prevGameIdRef.current
    const gameChanged = prevId !== mini.gameId
    const chatJustOpened = !prevChatOpenRef.current && chatOpen

    if (gameChanged) {
      prevGameIdRef.current = mini.gameId
      prevChatOpenRef.current = chatOpen
      // First mini open this session → dock; switching game in mini (pop-out elsewhere) → keep position.
      if (prevId === undefined) {
        setPanelPos(dockBottomRight(chatOpen, w, h))
      } else {
        setPanelPos((p) => clampTopLeft(p.left, p.top, w, h))
      }
      return
    }

    if (chatJustOpened) {
      prevChatOpenRef.current = chatOpen
      setPanelPos(dockBottomRight(true, w, h))
      return
    }

    prevChatOpenRef.current = chatOpen
    setPanelPos((p) => clampTopLeft(p.left, p.top, w, h))
  }, [mini, mini?.gameId, chatOpen])

  useEffect(() => {
    const onResize = () => {
      const el = rootRef.current
      if (!el || !mini) return
      const { width: w, height: h } = el.getBoundingClientRect()
      if (w < 2 || h < 2) return
      setPanelPos((p) => clampTopLeft(p.left, p.top, w, h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mini])

  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const p = panelPosRef.current
    dragStartRef.current = {
      px: e.clientX,
      py: e.clientY,
      left: p.left,
      top: p.top,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }, [])

  const onDragPointerMove = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current
    const el = rootRef.current
    if (!start || !el) return
    const { width: w, height: h } = el.getBoundingClientRect()
    const nl = start.left + (e.clientX - start.px)
    const nt = start.top + (e.clientY - start.py)
    setPanelPos(clampTopLeft(nl, nt, w, h))
  }, [])

  const onDragPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragStartRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    dragStartRef.current = null
    setDragging(false)
  }, [])

  const onDragDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const el = rootRef.current
      if (!el) return
      const { width: w, height: h } = el.getBoundingClientRect()
      setPanelPos(dockBottomRight(chatOpen, w, h))
    },
    [chatOpen],
  )

  if (!mini) return null

  const motionTransition = dragging ? '' : 'transition-[left,top] duration-200 ease-out'

  return createPortal(
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        left: panelPos.left,
        top: panelPos.top,
        zIndex: 500,
      }}
      className={`flex w-[min(calc(100vw-1.25rem),22rem)] flex-col overflow-hidden rounded-casino-lg border border-white/15 bg-casino-surface shadow-[0_16px_48px_rgba(0,0,0,0.55)] ${motionTransition}`}
      role="region"
      aria-label="Mini game player"
    >
      <div className="flex items-center justify-between gap-1 border-b border-white/10 bg-black/90 px-1 py-0.5">
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white/75 transition hover:bg-white/12 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary"
          aria-label="Close mini player"
          title="Close mini player"
          onClick={() => closeMini()}
        >
          <IconX size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="min-h-8 min-w-0 flex-1 cursor-grab touch-none select-none rounded-[4px] px-2 active:cursor-grabbing"
          title="Drag anywhere on screen · double-click to dock bottom-right"
          aria-label="Move mini player"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          onDoubleClick={onDragDoubleClick}
        />
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white/75 transition hover:bg-white/12 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary"
          aria-label="Open game lobby"
          title="Open full game lobby"
          onClick={() => {
            const id = mini.gameId.trim()
            if (id) {
              navigate(`/casino/game-lobby/${encodeURIComponent(id)}`)
            }
            closeMini()
          }}
        >
          <IconMaximize2 size={15} aria-hidden />
        </button>
      </div>
      <div className="relative aspect-video w-full shrink-0 bg-black">
        <iframe
          key={`${mini.gameId}\u0000${mini.iframeUrl}`}
          title={mini.title}
          src={mini.iframeUrl}
          className="absolute inset-0 h-full w-full border-0 bg-black"
          allow={GAME_IFRAME_ALLOW}
          allowFullScreen
        />
      </div>
      <div
        className="flex cursor-grab touch-none select-none items-center gap-2 border-t border-white/10 bg-black/88 px-2 py-1.5 active:cursor-grabbing"
        title="Drag anywhere on screen · double-click to dock bottom-right"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
        onDoubleClick={onDragDoubleClick}
      >
        <img src={mini.thumbSrc} alt="" className="pointer-events-none size-9 shrink-0 rounded object-cover" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{mini.title}</p>
          <p className="truncate text-[10px] text-white/55">{mini.providerLabel}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
