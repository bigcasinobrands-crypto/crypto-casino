import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import RouteFallback from '../components/RouteFallback'

type MatchFn = (pathname: string, search: string) => boolean

const navItems: { to: string; label: string; end?: boolean; match?: MatchFn }[] = [
  {
    to: '/bonushub',
    label: 'Promotions',
    end: true,
    match: (pathname) => pathname === '/bonushub' || pathname.startsWith('/bonushub/promotions/'),
  },
  { to: '/bonushub/risk', label: 'Risk queue', end: true },
  { to: '/bonushub/campaign-analytics', label: 'Campaign analytics', end: true },
  { to: '/bonushub/player-layout', label: 'Rewards map', end: true },
  {
    to: '/bonushub/recommendations',
    label: 'Smart suggestions',
    end: true,
    match: (pathname) => pathname === '/bonushub/recommendations',
  },
  { to: '/bonushub/bonus-audit', label: 'Compliance trail', end: true },
]

export default function BonusHubLayout() {
  const { pathname, search } = useLocation()

  const itemActive = (item: (typeof navItems)[0], isActive: boolean) =>
    item.match ? item.match(pathname, search) : isActive

  return (
    <div className="container-fluid py-3">
      <header className="border-bottom pb-3 mb-3">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-2">
            <li className="breadcrumb-item">
              <Link to="/">Home</Link>
            </li>
            <li className="breadcrumb-item active" aria-current="page">
              Bonus Engine
            </li>
          </ol>
        </nav>
        <h1 className="h3 mb-2">Bonus Engine</h1>
        <div className="text-secondary small mb-0">
          <span className="fw-semibold text-body">Lifecycle:</span> create → publish → deliver → reconcile → audit.
          Deposit bonuses need the worker and Redis —{' '}
          <details className="d-inline">
            <summary className="d-inline cursor-pointer link-primary">Dev setup</summary>
            <code className="ms-1 small user-select-all">npm run dev:with-worker</code>
          </details>
        </div>
      </header>

      <nav
        className="bonushub-sidenav nav nav-pills d-flex flex-row flex-wrap gap-2 mb-4"
        aria-label="Bonus Engine sections"
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `nav-link text-nowrap ${itemActive(item, isActive) ? 'active' : ''}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="min-w-0">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
