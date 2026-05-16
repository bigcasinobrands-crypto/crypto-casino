import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminAuthProvider } from './authContext'
import { MetricsDisplaySuppressProvider } from './context/MetricsDisplaySuppressContext'
import { AppToaster } from './components/AppToaster'
import { ReportingErrorBoundary } from './components/ReportingErrorBoundary'
import { BlueOceanCatalogSyncProvider } from './context/BlueOceanCatalogSyncContext'
import { AdminActivityLogProvider } from './notifications/AdminActivityLogContext'
import AdminLayout from './pages/AdminLayout'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const DemographicsOverviewPage = lazy(() => import('./pages/DemographicsOverviewPage'))
const TrafficSourcesPage = lazy(() => import('./pages/TrafficSourcesPage'))
const PaymentOpsPage = lazy(() => import('./pages/PaymentOpsPage'))
const FinanceCryptoPerformancePage = lazy(() => import('./pages/FinanceCryptoPerformancePage'))
const FinanceGeoByCountryPage = lazy(() => import('./pages/FinanceGeoByCountryPage'))
const DataTablePage = lazy(() => import('./pages/DataTablePage'))
const WithdrawalApprovalPage = lazy(() => import('./pages/WithdrawalApprovalPage'))
const PlayersPage = lazy(() => import('./pages/PlayersPage'))
const SupportLookupPage = lazy(() => import('./pages/SupportLookupPage'))
const PlayerDetailPage = lazy(() => import('./pages/PlayerDetailPage'))
const VipProgramPage = lazy(() => import('./pages/VipProgramPage'))
const VipSectionLayout = lazy(() => import('./pages/VipSectionLayout'))
const VipDeliveryRunsPage = lazy(() => import('./pages/VipDeliveryRunsPage'))
const VipDeliverySchedulesPage = lazy(() => import('./pages/VipDeliverySchedulesPage'))
const VipBroadcastPage = lazy(() => import('./pages/VipBroadcastPage'))
const GamesCatalogPage = lazy(() => import('./pages/GamesCatalogPage'))
const BlueOceanEventsPage = lazy(() => import('./pages/BlueOceanEventsPage'))
const BlueOceanOpsPage = lazy(() => import('./pages/BlueOceanOpsPage'))
const OddinIntegrationPage = lazy(() => import('./pages/OddinIntegrationPage'))
const BonusHubLayout = lazy(() => import('./pages/BonusHubLayout'))
const BonusesCatalogPage = lazy(() => import('./pages/BonusesCatalogPage'))
const BonusDeliveryPage = lazy(() => import('./pages/BonusDeliveryPage'))
const BonusRulesPage = lazy(() => import('./pages/BonusRulesPage'))
const BonusPromotionDetailPage = lazy(() => import('./pages/BonusPromotionDetailPage'))
const BonusRecommendationsPage = lazy(() => import('./pages/BonusRecommendationsPage'))
const PlayerRewardsLayoutPage = lazy(() => import('./pages/PlayerRewardsLayoutPage'))
const GlobalChatPage = lazy(() => import('./pages/GlobalChatPage'))
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'))
const SecurityBreakGlassPage = lazy(() => import('./pages/SecurityBreakGlassPage'))
const SecurityApprovalsPage = lazy(() => import('./pages/SecurityApprovalsPage'))
const ChallengesAdminPage = lazy(() => import('./pages/ChallengesAdminPage'))
const ChallengeAdminDetailPage = lazy(() => import('./pages/ChallengeAdminDetailPage'))
const ChallengesFlaggedPage = lazy(() => import('./pages/ChallengesFlaggedPage'))
const LogsPage = lazy(() => import('./pages/LogsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const StaffUsersPage = lazy(() => import('./pages/StaffUsersPage'))
const WebAuthnSecurityPage = lazy(() => import('./pages/WebAuthnSecurityPage'))
const BonusCampaignStatsPage = lazy(() => import('./pages/BonusCampaignStatsPage'))
const BonusHubCompliancePage = lazy(() => import('./pages/BonusHubCompliancePage'))
const BonusHubRiskPage = lazy(() => import('./pages/BonusHubRiskPage'))
const ContentCmsPage = lazy(() => import('./pages/ContentCmsPage'))
const ReferralProgramTiersPage = lazy(() => import('./pages/ReferralProgramTiersPage'))
const EmailSettingsPage = lazy(() => import('./pages/EmailSettingsPage'))
const KYCAIDSettingsPage = lazy(() => import('./pages/KYCAIDSettingsPage'))

function BonusHubOperationsRedirect() {
  const loc = useLocation()
  return <Navigate to={{ pathname: '/bonushub', search: loc.search }} replace />
}

export default function App() {
  return (
    <AdminAuthProvider>
      <MetricsDisplaySuppressProvider>
        <AdminActivityLogProvider>
        <BlueOceanCatalogSyncProvider>
          <AppToaster />
          <ReportingErrorBoundary>
            <Routes>
            <Route
              path="/login"
              element={
                <Suspense
                  fallback={
                    <div className="d-flex min-vh-100 align-items-center justify-content-center bg-body-secondary">
                      <span className="text-secondary small">Loading…</span>
                    </div>
                  }
                >
                  <LoginPage />
                </Suspense>
              }
            />
            <Route element={<AdminLayout />}>
              <Route path="/" element={<DashboardPage />} />

              {/* Analytics */}
              <Route path="/analytics" element={<Navigate to="/analytics/demographics" replace />} />
              <Route path="/analytics/demographics" element={<DemographicsOverviewPage />} />
              <Route path="/analytics/traffic-sources" element={<TrafficSourcesPage />} />

              {/* Finance */}
              <Route path="/finance" element={<PaymentOpsPage />} />
              <Route path="/finance/casino-analytics" element={<Navigate to="/finance" replace />} />
              <Route path="/finance/crypto-performance" element={<FinanceCryptoPerformancePage />} />
              <Route path="/finance/by-country" element={<FinanceGeoByCountryPage />} />
              <Route path="/payments-ops" element={<Navigate to="/finance" replace />} />
              <Route
                path="/deposits"
                element={
                  <DataTablePage
                    title="Deposits"
                    path="/v1/admin/integrations/payments/deposit-intents"
                    refreshIntervalMs={10000}
                  />
                }
              />
              <Route
                path="/withdrawals"
                element={
                  <DataTablePage
                    title="Withdrawals"
                    path="/v1/admin/integrations/payments/withdrawals"
                    refreshIntervalMs={10000}
                  />
                }
              />
              <Route path="/withdrawal-approvals" element={<WithdrawalApprovalPage />} />
              <Route
                path="/ledger"
                element={<DataTablePage title="Ledger" path="/v1/admin/ledger" refreshIntervalMs={10000} />}
              />

              {/* Players */}
              <Route path="/users" element={<PlayersPage />} />
              <Route path="/support" element={<SupportLookupPage />} />
              <Route path="/support/player/:id" element={<PlayerDetailPage />} />
              <Route path="/engagement/vip" element={<VipSectionLayout />}>
                <Route index element={<VipProgramPage />} />
                <Route path="hunt" element={<Navigate to="/engagement/vip/schedules" replace />} />
                <Route path="delivery" element={<VipDeliveryRunsPage />} />
                <Route path="schedules" element={<VipDeliverySchedulesPage />} />
                <Route path="broadcast" element={<VipBroadcastPage />} />
              </Route>
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
              <Route path="/integrations/oddin" element={<OddinIntegrationPage />} />
              <Route path="/bog" element={<Navigate to="/provider-ops" replace />} />
              <Route path="/blueocean" element={<Navigate to="/provider-ops" replace />} />

              {/* Engagement / Bonus Engine */}
              <Route path="/bonushub" element={<BonusHubLayout />}>
                <Route index element={<BonusesCatalogPage />} />
                <Route path="player-layout" element={<PlayerRewardsLayoutPage />} />
                <Route path="recommendations" element={<BonusRecommendationsPage />} />
                <Route path="calendar" element={<Navigate to="/bonushub" replace />} />
                <Route path="campaign-analytics" element={<BonusCampaignStatsPage />} />
                <Route path="operations" element={<BonusHubOperationsRedirect />} />
                <Route path="risk" element={<BonusHubRiskPage />} />
                <Route path="bonus-audit" element={<BonusHubCompliancePage />} />
                <Route path="wizard/new" element={<Navigate to="/bonushub" replace />} />
                <Route path="promotions/:id/delivery" element={<BonusDeliveryPage />} />
                <Route path="promotions/:id/rules" element={<BonusRulesPage />} />
                <Route path="promotions/:id" element={<BonusPromotionDetailPage />} />
              </Route>
              <Route path="/engagement/referrals" element={<ReferralProgramTiersPage />} />
              <Route path="/global-chat" element={<GlobalChatPage />} />
              <Route path="/engagement/challenges/flagged" element={<ChallengesFlaggedPage />} />
              <Route path="/engagement/challenges/new" element={<ChallengeAdminDetailPage />} />
              <Route path="/engagement/challenges/:id" element={<ChallengeAdminDetailPage />} />
              <Route path="/engagement/challenges" element={<ChallengesAdminPage />} />

              {/* Compliance & Risk */}
              <Route path="/audit-log" element={<AuditLogPage />} />
              <Route path="/security/break-glass" element={<SecurityBreakGlassPage />} />
              <Route path="/security/approvals" element={<SecurityApprovalsPage />} />

              {/* System */}
              <Route path="/diagnostics" element={<LogsPage />} />
              <Route path="/logs" element={<Navigate to="/diagnostics" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/system/email" element={<EmailSettingsPage />} />
              <Route path="/system/kycaid" element={<KYCAIDSettingsPage />} />
              <Route path="/content-cms" element={<ContentCmsPage />} />
              <Route path="/system/security-keys" element={<WebAuthnSecurityPage />} />
              <Route path="/system/staff-users" element={<StaffUsersPage />} />
            </Route>
            </Routes>
          </ReportingErrorBoundary>
        </BlueOceanCatalogSyncProvider>
      </AdminActivityLogProvider>
      </MetricsDisplaySuppressProvider>
    </AdminAuthProvider>
  )
}
