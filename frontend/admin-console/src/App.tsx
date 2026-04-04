import { Route, Routes } from 'react-router-dom'
import { AdminAuthProvider } from './authContext'
import AdminLayout from './pages/AdminLayout'
import DashboardPage from './pages/DashboardPage'
import DataTablePage from './pages/DataTablePage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/users"
            element={<DataTablePage title="Players" path="/v1/admin/users" />}
          />
          <Route
            path="/ledger"
            element={<DataTablePage title="Ledger" path="/v1/admin/ledger" />}
          />
          <Route
            path="/blueocean"
            element={
              <DataTablePage title="BlueOcean events" path="/v1/admin/events/blueocean" />
            }
          />
          <Route
            path="/fystack"
            element={
              <DataTablePage
                title="Fystack payments"
                path="/v1/admin/integrations/fystack/payments"
              />
            }
          />
          <Route
            path="/fystack-wd"
            element={
              <DataTablePage
                title="Fystack withdrawals"
                path="/v1/admin/integrations/fystack/withdrawals"
              />
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </AdminAuthProvider>
  )
}
