import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Dropdown } from '../ui/dropdown/Dropdown'
import { PigmoShellGlyph } from '../pigmo/PigmoShellGlyph'

type DemoRow = {
  id: string
  name: string
  project: string
  meta: string
  image: string
  online: boolean
}

const DEMO_NOTIFICATIONS: DemoRow[] = [
  {
    id: '1',
    name: 'Terry Franci',
    project: 'Project — Nganter App',
    meta: 'Project · 5 min ago',
    image: '/images/user/user-02.jpg',
    online: true,
  },
  {
    id: '2',
    name: 'Alena Franci',
    project: 'Project — Nganter App',
    meta: 'Project · 8 min ago',
    image: '/images/user/user-03.jpg',
    online: true,
  },
  {
    id: '3',
    name: 'Jocelyn Kenter',
    project: 'Project — Nganter App',
    meta: 'Project · 15 min ago',
    image: '/images/user/user-04.jpg',
    online: true,
  },
  {
    id: '4',
    name: 'Brandon Philips',
    project: 'Project — Nganter App',
    meta: 'Project · 1 hr ago',
    image: '/images/user/user-05.jpg',
    online: false,
  },
  {
    id: '5',
    name: 'Terry Franci',
    project: 'Project — Nganter App',
    meta: 'Project · 5 min ago',
    image: '/images/user/user-02.jpg',
    online: true,
  },
  {
    id: '6',
    name: 'Alena Franci',
    project: 'Project — Nganter App',
    meta: 'Project · 8 min ago',
    image: '/images/user/user-03.jpg',
    online: true,
  },
]

export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifying, setNotifying] = useState(true)

  function toggleDropdown() {
    setIsOpen(!isOpen)
  }

  function closeDropdown() {
    setIsOpen(false)
  }

  const handleClick = () => {
    toggleDropdown()
    setNotifying(false)
  }

  return (
    <div className="dropdown">
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm rounded-circle p-2 dropdown-toggle position-relative d-inline-flex align-items-center justify-content-center"
        style={{ width: '2.5rem', height: '2.5rem' }}
        onClick={handleClick}
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        {notifying ? (
          <span className="position-absolute top-0 end-0 translate-middle p-1 bg-warning border border-light rounded-circle z-1">
            <span className="visually-hidden">Unread</span>
          </span>
        ) : null}
        <PigmoShellGlyph
          slot="bell"
          size={18}
          fallback={<i className="bi bi-bell" aria-hidden />}
        />
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="dropdown-menu-end mt-1 p-0 shadow z-1050"
        style={{ width: 'min(22.5rem, calc(100vw - 1.5rem))' }}
      >
        <div className="dropdown-header d-flex align-items-center justify-content-between gap-2 py-2 px-3 border-bottom border-secondary-subtle mb-0">
          <span className="fw-semibold text-body">Notifications</span>
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
            onClick={closeDropdown}
          />
        </div>

        <ul className="list-unstyled mb-0 overflow-auto" style={{ maxHeight: '22rem' }}>
          {DEMO_NOTIFICATIONS.map((row) => (
            <li key={row.id} className="border-bottom border-secondary-subtle">
              <button
                type="button"
                className="dropdown-item d-flex gap-3 py-2 px-3 text-start rounded-0"
                onClick={closeDropdown}
              >
                <span className="position-relative flex-shrink-0">
                  <img
                    width={40}
                    height={40}
                    src={row.image}
                    alt=""
                    className="rounded-circle"
                    style={{ width: 40, height: 40, objectFit: 'cover' }}
                  />
                  <span
                    className={`position-absolute bottom-0 end-0 rounded-circle border border-2 border-body ${
                      row.online ? 'bg-success' : 'bg-secondary'
                    }`}
                    style={{ width: 10, height: 10 }}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-grow-1">
                  <span className="d-block small lh-sm">
                    <span className="fw-semibold text-body">{row.name}</span>
                    <span className="text-body-secondary"> requests permission to change </span>
                    <span className="fw-semibold text-body">{row.project}</span>
                  </span>
                  <span className="d-block text-body-secondary mt-1" style={{ fontSize: '0.75rem' }}>
                    {row.meta}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-top border-secondary-subtle">
          <Link
            to="/"
            className="dropdown-item text-center small fw-medium py-2"
            onClick={closeDropdown}
          >
            View all notifications
          </Link>
        </div>
      </Dropdown>
    </div>
  )
}
