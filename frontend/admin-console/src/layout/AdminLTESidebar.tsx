import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ADMIN_NAV_SECTIONS } from './adminNavConfig'

const STORAGE_KEY = 'admin-sidebar-sections-v1'

function loadManualOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as Record<string, boolean>
    return typeof j === 'object' && j !== null ? j : {}
  } catch {
    return {}
  }
}

function navLinkClass(isActive: boolean) {
  return `nav-link ${isActive ? 'active' : ''}`.trim()
}

/**
 * AdminLTE's Treeview registers on DOMContentLoaded, before React renders the sidebar,
 * so clicks never attach. We expand/collapse sections in React instead.
 */
const AdminLTESidebar: FC = () => {
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)
  /**
   * Per-section open state. If a key is absent, the section follows `hasActive` (open when a child route matches).
   * If present, the boolean is the explicit open/closed choice (allows collapsing while a child is active).
   */
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>(loadManualOpen)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(manualOpen))
    } catch {
      /* ignore quota / private mode */
    }
  }, [manualOpen])

  useEffect(() => {
    const root = navRef.current
    if (!root) return
    window.requestAnimationFrame(() => {
      const active = root.querySelector<HTMLElement>('.nav-link.active')
      active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [location.pathname, location.search])

  const isSubActive = useCallback(
    (path: string) => {
      const p = location.pathname
      const search = location.search || ''
      const sp = new URLSearchParams(search)
      const tab = sp.get('tab') || 'dashboard'

      if (path === '/') return p === '/'
      if (path === '/analytics/demographics') return p === '/analytics/demographics'
      if (path === '/analytics/traffic-sources') return p === '/analytics/traffic-sources'
      if (path === '/support') return p.startsWith('/support')
      if (path === '/games') return p === '/games' || p === '/games-catalog'
      if (path === '/games/blueocean-events') return p === '/games/blueocean-events'
      if (path === '/bonushub/risk') return p === '/bonushub/risk'
      if (path === '/bonushub/operations') {
        return p === '/bonushub/operations'
      }
      if (path === '/bonushub/wizard/new') return p === '/bonushub/wizard/new'
      if (path === '/bonushub/calendar') return p === '/bonushub/calendar'
      if (path === '/bonushub/campaign-analytics') return p === '/bonushub/campaign-analytics'
      if (path === '/bonushub/recommendations') return p === '/bonushub/recommendations'
      if (path === '/bonushub/player-layout') return p === '/bonushub/player-layout'
      if (path === '/bonushub/bonus-audit') return p === '/bonushub/bonus-audit'
      if (path === '/bonushub') {
        if (p === '/bonushub') return true
        if (p.startsWith('/bonushub/promotions/')) return true
        return false
      }
      if (path === '/global-chat') return p.startsWith('/global-chat')
      if (path === '/finance/fystack-webhooks') return p === '/finance/fystack-webhooks'
      if (path === '/finance/casino-analytics') return p === '/finance/casino-analytics'
      if (path === '/finance/crypto-performance') return p === '/finance/crypto-performance'
      if (path === '/system/staff-users') return p === '/system/staff-users'
      if (path === '/system/security-keys') return p === '/system/security-keys'
      if (path === '/security/break-glass') return p === '/security/break-glass'
      if (path === '/security/approvals') return p === '/security/approvals'
      if (path === '/engagement/vip') return p === '/engagement/vip' || p === '/vip-program'
      if (path === '/engagement/vip/delivery') return p === '/engagement/vip/delivery'
      if (path === '/engagement/vip/schedules') return p === '/engagement/vip/schedules'
      if (path === '/engagement/vip/broadcast') return p === '/engagement/vip/broadcast'
      if (path.includes('?')) {
        const base = path.split('?')[0]
        if (p !== base) return false
        const want = new URLSearchParams(path.split('?')[1] || '').get('tab')
        return want === tab
      }
      return p === path
    },
    [location.pathname, location.search],
  )

  const sectionHasActiveChild = useCallback(
    (subItems: { path: string }[] | undefined) => {
      if (!subItems) return false
      return subItems.some((s) => isSubActive(s.path))
    },
    [isSubActive],
  )

  const sectionIsOpen = (sectionName: string, hasActive: boolean) => {
    if (Object.prototype.hasOwnProperty.call(manualOpen, sectionName)) {
      return manualOpen[sectionName]
    }
    return hasActive
  }

  const toggleSection = (sectionName: string, hasActive: boolean) => {
    const cur = sectionIsOpen(sectionName, hasActive)
    setManualOpen((prev) => ({ ...prev, [sectionName]: !cur }))
  }

  return (
    <aside className="app-sidebar bg-body-secondary shadow" data-bs-theme="dark">
      <div className="sidebar-brand">
        <Link to="/" className="brand-link">
          <img
            src="/images/logo/logo-icon.svg"
            alt="Admin"
            className="brand-image opacity-75 shadow"
            width={32}
            height={32}
          />
          <span className="brand-text fw-light">Crypto Casino</span>
        </Link>
      </div>
      <div className="sidebar-wrapper">
        <nav ref={navRef} className="mt-2">
          <ul
            className="nav sidebar-menu flex-column"
            role="navigation"
            aria-label="Main navigation"
            id="navigation"
          >
            {ADMIN_NAV_SECTIONS.map((section) => {
              if (section.path && !section.subItems) {
                return (
                  <li key={section.name} className="nav-item">
                    <NavLink to={section.path} end className={({ isActive }) => navLinkClass(isActive)}>
                      <i className={`nav-icon ${section.iconClass}`} />
                      <p>{section.name}</p>
                    </NavLink>
                  </li>
                )
              }
              const subs = section.subItems ?? []
              const hasActive = sectionHasActiveChild(subs)
              const isOpen = sectionIsOpen(section.name, hasActive)
              return (
                <li key={section.name} className={`nav-item ${isOpen ? 'menu-open' : ''}`}>
                  <button
                    type="button"
                    className="nav-link d-flex align-items-center w-100 border-0 bg-transparent text-start"
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(section.name, hasActive)}
                  >
                    <i className={`nav-icon ${section.iconClass}`} />
                    <p>
                      {section.name}
                      <i className="nav-arrow bi bi-chevron-right" aria-hidden />
                    </p>
                  </button>
                  <ul className={`nav nav-treeview${isOpen ? '' : ' d-none'}`}>
                    {subs.map((sub) => (
                      <li key={sub.path + sub.name} className="nav-item">
                        <NavLink
                          to={sub.path}
                          className={() => navLinkClass(isSubActive(sub.path))}
                        >
                          <p className="d-flex align-items-center gap-2">
                            {sub.name}
                            {sub.new ? (
                              <span className="badge text-bg-info ms-auto" style={{ fontSize: '0.65rem' }}>
                                new
                              </span>
                            ) : null}
                          </p>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </aside>
  )
}

export default AdminLTESidebar
