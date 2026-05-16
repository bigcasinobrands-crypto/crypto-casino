import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import RouteFallback from '../components/RouteFallback'

const navItems: {
  to: string
  label: string
  end?: boolean
  match?: (pathname: string) => boolean
}[] = [
  {
    to: '/raffles',
    label: 'Campaigns',
    end: true,
    match: (pathname) =>
      pathname === '/raffles' ||
      pathname === '/raffles/new' ||
      /^\/raffles\/[^/]+\/edit$/.test(pathname) ||
      /^\/raffles\/[^/]+$/.test(pathname),
  },
]

export default function RafflesAdminLayout() {
  const { pathname } = useLocation()

  const itemActive = (item: (typeof navItems)[0], isActive: boolean) =>
    item.match ? item.match(pathname) : isActive

  return (
    <div className="container-fluid py-3">
      <header className="border-bottom pb-3 mb-3">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-2">
            <li className="breadcrumb-item">
              <Link to="/">Home</Link>
            </li>
            <li className="breadcrumb-item active" aria-current="page">
              Raffles
            </li>
          </ol>
        </nav>
        <h1 className="h3 mb-2">Raffles</h1>
        <p className="text-secondary small mb-0">
          Weekly raffle campaigns: ticket issuance from play, purchasing, weighted draws, publishing winners, and ledger payouts.
          Draw lifecycle actions require <span className="fw-semibold text-body">superadmin</span>.
        </p>
      </header>

      <nav
        className="bonushub-sidenav nav nav-pills d-flex flex-row flex-wrap gap-2 mb-4"
        aria-label="Raffles sections"
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
