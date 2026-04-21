import { NavLink, Outlet, useLocation } from 'react-router-dom'

const tier2Btn = (active: boolean) =>
  [
    'block shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap lg:whitespace-normal',
    active
      ? 'bg-brand-500 text-white shadow-sm'
      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10',
  ].join(' ')

type MatchFn = (pathname: string, search: string) => boolean

const navItems: { to: string; label: string; end?: boolean; match?: MatchFn }[] = [
  {
    to: '/bonushub',
    label: 'Promotions',
    end: true,
    match: (pathname) => pathname === '/bonushub' || pathname.startsWith('/bonushub/promotions/'),
  },
  { to: '/bonushub/player-layout', label: 'Rewards map', end: true },
  {
    to: '/bonushub/recommendations',
    label: 'Smart suggestions',
    end: true,
    match: (pathname) => pathname === '/bonushub/recommendations',
  },
  { to: '/bonushub/calendar', label: 'Calendar', end: true },
  { to: '/bonushub/campaign-analytics', label: 'Campaign analytics', end: true },
  {
    to: '/bonushub/operations',
    label: 'Operations',
    end: true,
    match: (pathname, search) =>
      pathname === '/bonushub/operations' && new URLSearchParams(search).get('tab') !== 'risk',
  },
  {
    to: '/bonushub/operations?tab=risk',
    label: 'Risk queue',
    match: (pathname, search) =>
      pathname === '/bonushub/operations' && new URLSearchParams(search).get('tab') === 'risk',
  },
  { to: '/bonushub/wizard/new', label: 'Create promotion', end: true },
]

export default function BonusHubLayout() {
  const { pathname, search } = useLocation()

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1600px] flex-col px-4 pb-10 pt-4 sm:px-6">
      <header className="mb-4 shrink-0 border-b border-gray-200 pb-4 dark:border-gray-700">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Bonus Engine</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          Promotions, publishing, and operations in one place. Deposit bonuses need the worker and Redis —{' '}
          <details className="inline">
            <summary className="cursor-pointer font-medium text-brand-600 dark:text-brand-400">Setup hint</summary>
            <span className="ml-1 font-mono text-xs text-gray-600 dark:text-gray-300">
              npm run dev:with-worker
            </span>
          </details>
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 pb-2 lg:w-52 lg:flex-col lg:border-b-0 lg:border-r lg:border-gray-200 lg:pr-4 lg:pb-0 dark:border-gray-700"
          aria-label="Bonus Engine sections"
        >
          {navItems.map(({ to, label, end, match }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => tier2Btn(match ? match(pathname, search) : isActive)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
