import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminAuthProvider } from './authContext'
import AdminLayout from './pages/AdminLayout'
import BlueOceanOpsPage from './pages/BlueOceanOpsPage'
import DashboardPage from './pages/DashboardPage'
import DataTablePage from './pages/DataTablePage'
import GamesCatalogPage from './pages/GamesCatalogPage'
import LoginPage from './pages/LoginPage'
import PlayerDetailPage from './pages/PlayerDetailPage'
import SettingsPage from './pages/SettingsPage'
import SupportLookupPage from './pages/SupportLookupPage'

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
          <Route path="/support" element={<SupportLookupPage />} />
          <Route path="/support/player/:id" element={<PlayerDetailPage />} />
          <Route path="/bog" element={<BlueOceanOpsPage />} />
          <Route path="/games" element={<GamesCatalogPage />} />
          <Route path="/games-catalog" element={<Navigate to="/games" replace />} />
          <Route
            path="/game-launches"
            element={<DataTablePage title="Game launches" path="/v1/admin/game-launches" />}
          />
          <Route
            path="/game-disputes"
            element={<DataTablePage title="Game disputes" path="/v1/admin/game-disputes" />}
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
