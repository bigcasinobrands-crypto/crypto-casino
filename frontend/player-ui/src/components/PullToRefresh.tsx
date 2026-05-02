import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

/** Aligns with casino shell mobile breakpoint (< 768px). */
export const PULL_TO_REFRESH_MEDIA = '(max-width: 767px)'

const THRESHOLD_PX = 72
const MAX_VISUAL_PX = 100

function dampen(raw: number): number {
  const x = Math.max(0, raw)
  return Math.min(MAX_VISUAL_PX, x * 0.38 + x * x * 0.0022)
}

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const apply = () => setMatches(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [query])

  return matches
}

/**
 * Mobile pull-to-refresh: gesture on the main scroll surface (same as browser-like PTR when the
 * column is scrolled to top). Indicator is portaled `fixed` under the mobile header so it reads as
 * refreshing the whole page, not a nested “in-app” strip inside the scroll column.
 */
export function PullToRefreshOverlay({
  scrollRef,
  enabled: routeAllowsPtr,
}: {
  scrollRef: RefObject<HTMLElement | null>
  enabled: boolean
}) {
  const reduceMotion = usePrefersReducedMotion()
  const isMobileViewport = useMatchMedia(PULL_TO_REFRESH_MEDIA)
  const enabled = routeAllowsPtr && isMobileViewport

  const [pullPx, setPullPx] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const pullRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const refreshingRef = useRef(false)
  const startYRef = useRef(0)
  const touchActiveRef = useRef(false)

  useEffect(() => {
    refreshingRef.current = refreshing
  }, [refreshing])

  useEffect(() => {
    if (!enabled) return
    const el = scrollRef.current
    if (!el) return

    const flushPull = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        setPullPx(pullRef.current)
      })
    }

    const resetPull = () => {
      pullRef.current = 0
      setPullPx(0)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      startYRef.current = e.touches[0].clientY
      touchActiveRef.current = el.scrollTop <= 2
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!touchActiveRef.current || refreshingRef.current) return
      if (el.scrollTop > 2) {
        touchActiveRef.current = false
        resetPull()
        return
      }
      const y = e.touches[0].clientY
      const delta = y - startYRef.current
      if (delta <= 0) {
        pullRef.current = 0
        flushPull()
        return
      }
      e.preventDefault()
      pullRef.current = dampen(delta)
      flushPull()
    }

    const endGesture = () => {
      touchActiveRef.current = false
      const p = pullRef.current
      pullRef.current = 0

      if (refreshingRef.current) return

      if (p >= THRESHOLD_PX) {
        refreshingRef.current = true
        setRefreshing(true)
        setPullPx(Math.min(52, p))
        window.setTimeout(() => {
          window.location.reload()
        }, 120)
        return
      }

      setPullPx(0)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', endGesture)
    el.addEventListener('touchcancel', endGesture)

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', endGesture)
      el.removeEventListener('touchcancel', endGesture)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [enabled, scrollRef])

  if (!routeAllowsPtr) return null

  if (!isMobileViewport) return null

  const progress = Math.min(1, pullPx / THRESHOLD_PX)
  const showIndicator = pullPx > 2 || refreshing
  const heightPx = refreshing ? 52 : pullPx

  const strip = (
    <div
      className={`pointer-events-none fixed left-0 right-0 z-[208] flex justify-center overflow-hidden bg-casino-bg ${
        reduceMotion ? '' : 'transition-[height] duration-150 ease-out'
      }`}
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + var(--casino-header-h-mobile))',
        height: showIndicator ? heightPx : 0,
      }}
      aria-live="polite"
      aria-busy={refreshing}
    >
      <div className="flex h-16 flex-col items-center justify-center px-3">
        {refreshing ? (
          <>
            <span className="sr-only">Refreshing page</span>
            <PtrSpinner />
          </>
        ) : (
          <>
            <PtrArrow progress={progress} reduceMotion={reduceMotion} />
            <span className="sr-only">
              {progress >= 1 ? 'Release to refresh' : 'Pull down to refresh'}
            </span>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(strip, document.body)
}

function PtrSpinner() {
  return (
    <svg
      className="size-7 text-casino-primary motion-safe:animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function PtrArrow({ progress, reduceMotion }: { progress: number; reduceMotion: boolean }) {
  const rot = progress >= 1 ? 180 : 0
  return (
    <svg
      className={`size-6 text-casino-primary ${reduceMotion ? '' : 'transition-[transform,opacity] duration-200 ease-out'}`}
      style={{
        transform: `rotate(${rot}deg)`,
        opacity: 0.35 + progress * 0.65,
      }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}
