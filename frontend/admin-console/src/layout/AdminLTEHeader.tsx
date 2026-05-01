import { useCallback, type FC } from 'react'
import { Link } from 'react-router-dom'
import NotificationDropdown from '../components/header/NotificationDropdown'
import UserDropdown from '../components/header/UserDropdown'
import PlayerConsoleBar from '../components/cross-app/PlayerConsoleBar'
import { PigmoShellGlyph } from '../components/pigmo/PigmoShellGlyph'

const AdminLTEHeader: FC = () => {
  const openGlobalSearch = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    )
  }, [])

  return (
    <nav className="app-header navbar navbar-expand bg-body border-bottom">
      <div className="container-fluid">
        <ul className="navbar-nav">
          <li className="nav-item">
            <a
              className="nav-link"
              data-lte-toggle="sidebar"
              href="#nav"
              role="button"
              onClick={(e) => e.preventDefault()}
            >
              <PigmoShellGlyph
                slot="menu"
                size={20}
                fallback={<i className="bi bi-list" />}
              />
            </a>
          </li>
          <li className="nav-item d-none d-md-block">
            <Link to="/" className="nav-link">
              Home
            </Link>
          </li>
        </ul>

        <ul className="navbar-nav ms-auto flex-row align-items-center gap-1 flex-wrap">
          <li className="nav-item d-none d-md-block">
            <button
              type="button"
              className="nav-link btn btn-link text-decoration-none border-0"
              onClick={openGlobalSearch}
              title="Search (Ctrl+K)"
            >
              <PigmoShellGlyph
                slot="search"
                size={18}
                fallback={<i className="bi bi-search" />}
              />
            </button>
          </li>
          <li className="nav-item d-md-none">
            <button
              type="button"
              className="nav-link btn btn-link text-decoration-none border-0"
              onClick={openGlobalSearch}
              title="Search"
            >
              <PigmoShellGlyph
                slot="search"
                size={18}
                fallback={<i className="bi bi-search" />}
              />
            </button>
          </li>
          <li className="nav-item d-none d-lg-block">
            <PlayerConsoleBar />
          </li>
          <li className="nav-item">
            <NotificationDropdown />
          </li>
          <li className="nav-item">
            <UserDropdown />
          </li>
        </ul>
      </div>
    </nav>
  )
}

export default AdminLTEHeader
