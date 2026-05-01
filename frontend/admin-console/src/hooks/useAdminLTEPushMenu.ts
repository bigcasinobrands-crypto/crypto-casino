import { useEffect } from 'react'

const SELECTOR_SIDEBAR_TOGGLE = '[data-lte-toggle="sidebar"]'
const CLASS_SIDEBAR_MINI = 'sidebar-mini'
const CLASS_SIDEBAR_COLLAPSE = 'sidebar-collapse'
const CLASS_SIDEBAR_OPEN = 'sidebar-open'

type PushConfig = {
  sidebarBreakpoint: number
}

/**
 * Mirrors AdminLTE PushMenu behavior without relying on `globalThis.adminlte`
 * (Vite may bundle AdminLTE without exposing that global). Used because AdminLTE
 * registers toggles on DOMContentLoaded before React renders `.app-sidebar`.
 */
function createSidebarPushMenu(config: PushConfig) {
  let sidebarBreakpoint = config.sidebarBreakpoint

  const isCollapsed = () =>
    document.body.classList.contains(CLASS_SIDEBAR_COLLAPSE)
  const isExplicitlyOpen = () =>
    document.body.classList.contains(CLASS_SIDEBAR_OPEN)
  const isMiniMode = () => document.body.classList.contains(CLASS_SIDEBAR_MINI)
  const isMobileSize = () => window.innerWidth <= sidebarBreakpoint

  const expand = () => {
    document.body.classList.remove(CLASS_SIDEBAR_COLLAPSE)
    if (isMobileSize()) {
      document.body.classList.add(CLASS_SIDEBAR_OPEN)
    }
  }

  const collapse = () => {
    document.body.classList.remove(CLASS_SIDEBAR_OPEN)
    document.body.classList.add(CLASS_SIDEBAR_COLLAPSE)
  }

  const toggle = () => {
    if (isCollapsed()) {
      expand()
    } else {
      collapse()
    }
  }

  const setupSidebarBreakPoint = () => {
    const sidebarExpand = document.querySelector<HTMLElement>(
      '[class*="sidebar-expand"]',
    )
    if (!sidebarExpand) return
    const content = getComputedStyle(sidebarExpand, '::before').getPropertyValue(
      'content',
    )
    if (!content || content === 'none') return
    const breakpointValue = Number(String(content).replace(/[^\d.-]/g, ''))
    if (!Number.isNaN(breakpointValue)) {
      sidebarBreakpoint = breakpointValue
    }
  }

  const updateStateByResponsiveLogic = () => {
    if (isMobileSize()) {
      if (!isExplicitlyOpen()) {
        collapse()
      }
    } else if (!(isMiniMode() && isCollapsed())) {
      expand()
    }
  }

  const init = () => {
    setupSidebarBreakPoint()
    updateStateByResponsiveLogic()
  }

  return {
    init,
    toggle,
    collapse,
    expand,
    setupSidebarBreakPoint,
    updateStateByResponsiveLogic,
  }
}

export function useAdminLTEPushMenu() {
  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>('.app-sidebar')
    const wrapper = document.querySelector<HTMLElement>('.app-wrapper')
    if (!sidebar || !wrapper) return

    const breakpointAttr = sidebar.dataset.sidebarBreakpoint
    const parsed =
      breakpointAttr === undefined ? 992 : Number(breakpointAttr)
    const config: PushConfig = {
      sidebarBreakpoint: Number.isNaN(parsed) ? 992 : parsed,
    }

    const pushMenu = createSidebarPushMenu(config)
    pushMenu.init()

    let overlay = wrapper.querySelector<HTMLElement>('.sidebar-overlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.className = 'sidebar-overlay'
      wrapper.append(overlay)
    }

    let overlayTouchMoved = false
    const onOverlayTouchStart = () => {
      overlayTouchMoved = false
    }
    const onOverlayTouchMove = () => {
      overlayTouchMoved = true
    }
    const onOverlayTouchEnd = (event: TouchEvent) => {
      if (!overlayTouchMoved) {
        event.preventDefault()
        pushMenu.collapse()
      }
      overlayTouchMoved = false
    }
    const onOverlayClick = (event: MouseEvent) => {
      event.preventDefault()
      pushMenu.collapse()
    }

    overlay.addEventListener('touchstart', onOverlayTouchStart, { passive: true })
    overlay.addEventListener('touchmove', onOverlayTouchMove, { passive: true })
    overlay.addEventListener('touchend', onOverlayTouchEnd, { passive: false })
    overlay.addEventListener('click', onOverlayClick)

    const toggleButtons = document.querySelectorAll<HTMLElement>(
      SELECTOR_SIDEBAR_TOGGLE,
    )
    const onToggleClick = (event: Event) => {
      event.preventDefault()
      const target = event.currentTarget as HTMLElement | null
      if (!target) return
      let button: HTMLElement | null = target
      if (button.dataset.lteToggle !== 'sidebar') {
        button = button.closest(SELECTOR_SIDEBAR_TOGGLE)
      }
      if (button) pushMenu.toggle()
    }
    toggleButtons.forEach((btn) => btn.addEventListener('click', onToggleClick))

    const onResize = () => {
      pushMenu.setupSidebarBreakPoint()
      pushMenu.updateStateByResponsiveLogic()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      overlay.removeEventListener('touchstart', onOverlayTouchStart)
      overlay.removeEventListener('touchmove', onOverlayTouchMove)
      overlay.removeEventListener('touchend', onOverlayTouchEnd)
      overlay.removeEventListener('click', onOverlayClick)
      toggleButtons.forEach((btn) =>
        btn.removeEventListener('click', onToggleClick),
      )
    }
  }, [])
}
