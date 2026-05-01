import { NavLink, Outlet } from 'react-router-dom'

const subNav = [
  { to: '/engagement/vip', end: true, label: 'Program' },
  { to: '/engagement/vip/broadcast', end: false, label: 'Player messaging' },
  { to: '/engagement/vip/schedules', end: false, label: 'Bonus scheduling' },
  { to: '/engagement/vip/delivery', end: false, label: 'Delivery runs' },
] as const

export default function VipSectionLayout() {
  return (
    <div>
      <ul className="nav nav-pills flex-wrap gap-1 mb-3">
        {subNav.map((x) => (
          <li className="nav-item" key={x.to}>
            <NavLink to={x.to} end={x.end} className="nav-link py-1 px-2 small">
              {x.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <Outlet />
    </div>
  )
}
