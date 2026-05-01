import { useState, type FC } from 'react'
import { DropdownItem } from '../ui/dropdown/DropdownItem'
import { Dropdown } from '../ui/dropdown/Dropdown'
import { useAdminAuth } from '../../authContext'
import { getPigmoShellIconUrl } from '../../lib/pigmoShellIconMap'
import { PigmoShellGlyph } from '../pigmo/PigmoShellGlyph'

function initialsFromEmail(email: string | null): string {
  if (!email) return '?'
  const part = email.split('@')[0]?.trim() ?? ''
  if (!part) return '?'
  const letters = part.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2)
  return letters.length > 0 ? letters.toUpperCase() : '?'
}

const UserDropdown: FC = () => {
  const { email, role, logout } = useAdminAuth()
  const [isOpen, setIsOpen] = useState(false)

  function toggleDropdown() {
    setIsOpen(!isOpen)
  }

  function closeDropdown() {
    setIsOpen(false)
  }

  const initials = initialsFromEmail(email)
  const pigmoUser = Boolean(getPigmoShellIconUrl('user'))

  return (
    <div className="dropdown">
      <button
        type="button"
        onClick={toggleDropdown}
        className="btn btn-link nav-link d-flex align-items-center text-body text-decoration-none dropdown-toggle py-1 px-2"
        aria-expanded={isOpen}
      >
        <span
          className={`rounded-circle d-inline-flex align-items-center justify-content-center fw-semibold small me-2 flex-shrink-0 ${
            pigmoUser ? 'border border-secondary-subtle bg-body-secondary bg-opacity-10' : 'bg-primary text-white'
          }`}
          style={{ width: '2.25rem', height: '2.25rem' }}
        >
          <PigmoShellGlyph
            slot="user"
            size={20}
            monochrome={false}
            fallback={<span aria-hidden>{initials}</span>}
          />
        </span>

        <span className="me-1 text-truncate small fw-medium" style={{ maxWidth: '9rem' }}>
          {email ?? 'Staff'}
        </span>
        <i
          className={`bi bi-chevron-down text-body-secondary flex-shrink-0 small transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="dropdown-menu-end mt-1 p-0 shadow"
        style={{ minWidth: '16.5rem' }}
      >
        <div className="px-3 py-2 border-bottom border-secondary-subtle">
          <div className="small text-body-secondary">Staff account</div>
          <div className="text-body fw-medium text-truncate" title={email ?? undefined}>
            {email ?? '—'}
          </div>
          {role ? (
            <div className="small text-body-secondary mt-1">
              Role: <span className="text-body">{role}</span>
            </div>
          ) : null}
        </div>

        <DropdownItem
          tag="a"
          to="/settings"
          onItemClick={closeDropdown}
          className="d-flex align-items-center gap-2 py-2 px-3"
        >
          <i className="bi bi-gear text-body-secondary" aria-hidden />
          <span className="text-body">Settings</span>
        </DropdownItem>

        <hr className="dropdown-divider my-0" />

        <button
          type="button"
          className="dropdown-item d-flex align-items-center gap-2 py-2 px-3 text-danger fw-medium"
          onClick={() => {
            closeDropdown()
            void logout()
          }}
        >
          <i className="bi bi-box-arrow-right" aria-hidden />
          Sign out
        </button>
      </Dropdown>
    </div>
  )
}

export default UserDropdown
