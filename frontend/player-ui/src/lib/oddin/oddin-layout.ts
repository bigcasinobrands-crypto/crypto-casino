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

/**
 * Fixed bottom nav — phones always; tablets only on `/esports` (`.casino-shell-mobile-nav--esports-tablet`).
 * Must not gate on viewport width: inset was `0` on 768–1279px while the bar was still visible.
 */
function measureBottomNavInsetPx(): number {
  if (typeof window === 'undefined') return 0
  const el = document.querySelector('.casino-shell-mobile-nav')
  if (!(el instanceof HTMLElement)) return 0
  const st = window.getComputedStyle(el)
  if (st.display === 'none' || st.visibility === 'hidden') return 0
  const r = el.getBoundingClientRect()
  if (r.height <= 0) return 0
  /** Distance from nav top edge to layout viewport bottom — clears fixed tab bar + OS inset it overlaps. */
  const layoutH = window.innerHeight
  const gap = Math.max(0, layoutH - r.top)
  return Math.round(gap)
}

export function bifrostHeightPx(): number {
  if (typeof window === 'undefined') return 720
  const layoutH = window.innerHeight
  const top = measureShellHeaderOffsetPx()
  const bottom = measureBottomNavInsetPx()
  return Math.max(320, layoutH - top - bottom)
}

/**
 * Prefer the laid-out `#bifrost` slot (flex + banners + shell padding). Falls back to viewport math
 * when height is not ready yet — avoids iframe taller than its host, which caused outer/body overscroll on iOS.
 *
 * The Oddin shell uses `padding-bottom: env(safe-area)` only on `.casino-shell-scroll--oddin-bifrost`, so flex
 * often sizes `#bifrost` to the full viewport below the header while our tab bar is `position: fixed`.
 * Reporting that full flex height makes Bifrost pin controls (e.g. My Bets) under the nav. Always cap by
 * `bifrostHeightPx()` so the iframe budget matches visible area above the bar.
 */
export function bifrostContentHeightPx(): number {
  const viewportBudget = bifrostHeightPx()
  if (typeof document === 'undefined') return viewportBudget
  const el = document.getElementById('bifrost')
  if (el instanceof HTMLElement) {
    let h = el.clientHeight
    if (!Number.isFinite(h) || h <= 0) {
      const br = el.getBoundingClientRect()
      h = br.height
    }
    if (Number.isFinite(h) && h > 0) {
      return Math.max(280, Math.min(Math.floor(h), viewportBudget))
    }
  }
  return viewportBudget
}
