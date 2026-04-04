import { NavLink } from 'react-router-dom'

const items = [
  { to: '/casino/blueocean', label: 'Blue Ocean' },
  { to: '/casino/lobby', label: 'Lobby' },
  { to: '/casino/featured', label: 'Featured' },
  { to: '/casino/slots', label: 'Slots' },
  { to: '/casino/live', label: 'Live' },
  { to: '/casino/new', label: 'New' },
  { to: '/casino/favourites', label: 'Favourites' },
  { to: '/casino/recent', label: 'Recent' },
]

export default function CasinoSidebar() {
  return (
    <aside className="hidden w-52 flex-col border-r border-casino-border bg-casino-surface md:flex">
      <div className="px-4 py-4">
        <NavLink
          to="/casino/blueocean"
          className="text-sm font-bold text-casino-primary hover:opacity-90"
        >
          Crypto Casino
        </NavLink>
      </div>
      <nav className="flex flex-col gap-1 px-2 pb-4">
        {items.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              isActive
                ? 'rounded-casino-md bg-casino-elevated px-3 py-2 text-sm text-casino-primary'
                : 'rounded-casino-md px-3 py-2 text-sm text-casino-muted hover:bg-casino-elevated/60 hover:text-casino-foreground'
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
