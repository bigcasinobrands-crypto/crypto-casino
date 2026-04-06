import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminAuthProvider } from './authContext'
import { AppToaster } from './components/AppToaster'
import { ReportingErrorBoundary } from './components/ReportingErrorBoundary'
import { AdminActivityLogProvider } from './notifications/AdminActivityLogContext'
import AdminLayout from './pages/AdminLayout'
import BlueOceanOpsPage from './pages/BlueOceanOpsPage'
import DashboardPage from './pages/DashboardPage'
import DataTablePage from './pages/DataTablePage'
import GamesCatalogPage from './pages/GamesCatalogPage'
import LoginPage from './pages/LoginPage'
import LogsPage from './pages/LogsPage'
import PlayerDetailPage from './pages/PlayerDetailPage'
import PlayersPage from './pages/PlayersPage'
import SettingsPage from './pages/SettingsPage'
import SupportLookupPage from './pages/SupportLookupPage'
import PaymentOpsPage from './pages/PaymentOpsPage'

export default function App() {
  return (
    <AdminAuthProvider>
      <AdminActivityLogProvider>
        <AppToaster />
        <ReportingErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AdminLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/users" element={<PlayersPage />} />
              <Route path="/support" element={<SupportLookupPage />} />
              <Route path="/support/player/:id" element={<PlayerDetailPage />} />
              <Route path="/bog" element={<BlueOceanOpsPage />} />
              <Route path="/payments-ops" element={<PaymentOpsPage />} />
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
                element={<DataTablePage title="Ledger" path="/v1/admin/ledger" refreshIntervalMs={10000} />}
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
                    refreshIntervalMs={10000}
                  />
                }
              />
              <Route
                path="/fystack-wd"
                element={
                  <DataTablePage
                    title="Fystack withdrawals"
                    path="/v1/admin/integrations/fystack/withdrawals"
                    refreshIntervalMs={10000}
                  />
                }
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/logs" element={<LogsPage />} />
            </Route>
          </Routes>
        </ReportingErrorBoundary>
      </AdminActivityLogProvider>
    </AdminAuthProvider>
  )
}
