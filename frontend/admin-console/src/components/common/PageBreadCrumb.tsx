import { Link } from 'react-router-dom'

export type BreadcrumbTrailItem = { label: string; to?: string }

interface BreadcrumbProps {
  pageTitle: string
  /** Optional line under the H1 (AdminLTE-style content header). */
  subtitle?: string
  /** Crumbs between Home and the active page title. */
  trail?: BreadcrumbTrailItem[]
}

const PageBreadcrumb: React.FC<BreadcrumbProps> = ({ pageTitle, subtitle, trail }) => {
  return (
    <div className="row mb-3 align-items-start">
      <div className="col-sm-6">
        <h1 className="m-0 fs-2">{pageTitle}</h1>
        {subtitle ? <p className="text-secondary small mb-0 mt-1">{subtitle}</p> : null}
      </div>
      <div className="col-sm-6 mt-2 mt-sm-0">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb float-sm-end mb-0">
            <li className="breadcrumb-item">
              <Link to="/">Home</Link>
            </li>
            {(trail ?? []).map((t) => (
              <li key={t.label} className="breadcrumb-item">
                {t.to ? <Link to={t.to}>{t.label}</Link> : t.label}
              </li>
            ))}
            <li className="breadcrumb-item active" aria-current="page">
              {pageTitle}
            </li>
          </ol>
        </nav>
      </div>
    </div>
  )
}

export default PageBreadcrumb
