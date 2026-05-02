import { Suspense, type FC } from 'react'
import { Outlet } from 'react-router-dom'
import GlobalSearch from '../components/GlobalSearch'
import RouteFallback from '../components/RouteFallback'
import { useBlueOceanCatalogSync } from '../context/BlueOceanCatalogSyncContext'
import { useAdminLTEBodyLayout } from '../hooks/useAdminLTEBodyLayout'
import { useAdminLTEInit } from '../hooks/useAdminLTEInit'
import { useAdminLTEPushMenu } from '../hooks/useAdminLTEPushMenu'
import AdminLTEHeader from './AdminLTEHeader'
import AdminLTESidebar from './AdminLTESidebar'

/**
 * [AdminLTE v4](https://github.com/ColorlibHQ/AdminLTE) application shell.
 */
const AdminLTELayout: FC = () => {
  useAdminLTEBodyLayout()
  useAdminLTEInit()
  useAdminLTEPushMenu()
  const { phase } = useBlueOceanCatalogSync()
  const catalogSyncing = phase === 'syncing'

  return (
    <>
      <div className="app-wrapper">
        <AdminLTEHeader />
        <AdminLTESidebar />
        <main className="app-main min-w-0">
          <div className="app-content min-w-0">
            <div className="container-fluid px-2 px-sm-3 py-3">
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
      {catalogSyncing ? (
        <div
          className="position-fixed bottom-0 start-0 end-0 py-2 px-3 text-center small text-white"
          style={{ zIndex: 1050, background: 'linear-gradient(90deg, #0d6efd, #0a58ca)' }}
          role="status"
          aria-live="polite"
        >
          <span className="spinner-border spinner-border-sm me-2 align-middle" aria-hidden />
          BlueOcean catalog sync in progress — you can keep working; you will be notified when it finishes.
        </div>
      ) : null}
      <GlobalSearch />
    </>
  )
}


export default AdminLTELayout
