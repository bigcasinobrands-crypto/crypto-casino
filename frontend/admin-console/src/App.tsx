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
import BonusHubLayout from './pages/BonusHubLayout'
import BonusesCatalogPage from './pages/BonusesCatalogPage'
import BonusHubOperationsPage from './pages/BonusHubOperationsPage'
import BonusWizardPage from './pages/BonusWizardPage'
import BonusDeliveryPage from './pages/BonusDeliveryPage'
import BonusRulesPage from './pages/BonusRulesPage'
import BonusCalendarPage from './pages/BonusCalendarPage'
import BonusRecommendationsPage from './pages/BonusRecommendationsPage'
import PlayerRewardsLayoutPage from './pages/PlayerRewardsLayoutPage'
import GlobalChatPage from './pages/GlobalChatPage'
import AuditLogPage from './pages/AuditLogPage'
import WithdrawalApprovalPage from './pages/WithdrawalApprovalPage'
import VipProgramPage from './pages/VipProgramPage'
import BlueOceanEventsPage from './pages/BlueOceanEventsPage'
import FystackWebhookInboxPage from './pages/FystackWebhookInboxPage'
import BonusCampaignStatsPage from './pages/BonusCampaignStatsPage'
import StaffUsersPage from './pages/StaffUsersPage'

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

              {/* Finance */}
              <Route path="/finance" element={<PaymentOpsPage />} />
              <Route path="/finance/fystack-webhooks" element={<FystackWebhookInboxPage />} />
              <Route path="/payments-ops" element={<Navigate to="/finance" replace />} />
              <Route
                path="/deposits"
                element={
                  <DataTablePage
                    title="Deposits"
                    path="/v1/admin/integrations/fystack/payments"
                    refreshIntervalMs={10000}
                  />
                }
              />
              <Route path="/fystack" element={<Navigate to="/deposits" replace />} />
              <Route
                path="/withdrawals"
                element={
                  <DataTablePage
                    title="Withdrawals"
                    path="/v1/admin/integrations/fystack/withdrawals"
                    refreshIntervalMs={10000}
                  />
                }
              />
              <Route path="/fystack-wd" element={<Navigate to="/withdrawals" replace />} />
              <Route path="/withdrawal-approvals" element={<WithdrawalApprovalPage />} />
              <Route
                path="/ledger"
                element={<DataTablePage title="Ledger" path="/v1/admin/ledger" refreshIntervalMs={10000} />}
              />

              {/* Players */}
              <Route path="/users" element={<PlayersPage />} />
              <Route path="/support" element={<SupportLookupPage />} />
              <Route path="/support/player/:id" element={<PlayerDetailPage />} />
              <Route path="/engagement/vip" element={<VipProgramPage />} />
              <Route path="/vip-program" element={<Navigate to="/engagement/vip" replace />} />

              {/* Games */}
              <Route path="/games" element={<GamesCatalogPage />} />
              <Route path="/games/blueocean-events" element={<BlueOceanEventsPage />} />
              <Route path="/games-catalog" element={<Navigate to="/games" replace />} />
              <Route
                path="/game-launches"
                element={<DataTablePage title="Game launches" path="/v1/admin/game-launches" />}
              />
              <Route
                path="/game-disputes"
                element={<DataTablePage title="Game disputes" path="/v1/admin/game-disputes" />}
              />
              <Route path="/provider-ops" element={<BlueOceanOpsPage />} />
              <Route path="/bog" element={<Navigate to="/provider-ops" replace />} />
              <Route
                path="/blueocean"
                element={<Navigate to="/provider-ops" replace />}
              />

              {/* Engagement */}
              <Route path="/bonushub" element={<BonusHubLayout />}>
                <Route index element={<BonusesCatalogPage />} />
                <Route path="player-layout" element={<PlayerRewardsLayoutPage />} />
                <Route path="recommendations" element={<BonusRecommendationsPage />} />
                <Route path="calendar" element={<BonusCalendarPage />} />
                <Route path="campaign-analytics" element={<BonusCampaignStatsPage />} />
                <Route path="operations" element={<BonusHubOperationsPage />} />
                <Route path="wizard/new" element={<BonusWizardPage />} />
                <Route path="promotions/:id/delivery" element={<BonusDeliveryPage />} />
                <Route path="promotions/:id/rules" element={<BonusRulesPage />} />
              </Route>
              <Route path="/global-chat" element={<GlobalChatPage />} />

              {/* Compliance & Risk */}
              <Route path="/audit-log" element={<AuditLogPage />} />

              {/* System */}
              <Route path="/diagnostics" element={<LogsPage />} />
              <Route path="/logs" element={<Navigate to="/diagnostics" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/system/staff-users" element={<StaffUsersPage />} />
            </Route>
          </Routes>
        </ReportingErrorBoundary>
      </AdminActivityLogProvider>
    </AdminAuthProvider>
  )
}
