/** Shared layout helpers for Oddin's iframe height (avoid double scroll; match shell headers). */

export function measureShellHeaderOffsetPx(): number {
  if (typeof document === 'undefined') return 64
  const selectors = ['.casino-shell-mobile-header', '.casino-shell-tablet-header', '.casino-shell-desktop-header']
  let maxBottom = 0
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect()
    if (r.height <= 0 || r.width <= 0) continue
    maxBottom = Math.max(maxBottom, r.bottom)
  }
  return maxBottom > 0 ? Math.round(maxBottom) : 64
}

function measureMobileBottomNavInsetPx(): number {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches) return 0
  const el = document.querySelector('.casino-shell-mobile-nav')
  if (!(el instanceof HTMLElement)) return 0
  const r = el.getBoundingClientRect()
  if (r.height <= 0 || r.top <= 0) return 0
  return Math.max(0, Math.round(window.innerHeight - r.top))
}

export function bifrostHeightPx(): number {
  if (typeof window === 'undefined') return 720
  const top = measureShellHeaderOffsetPx()
  const bottom = measureMobileBottomNavInsetPx()
  return Math.max(320, window.innerHeight - top - bottom)
}
