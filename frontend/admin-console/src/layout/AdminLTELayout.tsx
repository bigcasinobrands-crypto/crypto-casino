import { Suspense, type FC } from 'react'
import { Outlet } from 'react-router-dom'
import GlobalSearch from '../components/GlobalSearch'
import RouteFallback from '../components/RouteFallback'
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
      <GlobalSearch />
    </>
  )
}


export default AdminLTELayout
