import { lazy } from 'react'

/** Code-split route modules — catalog `/casino/*` stays eager in App for instant lobby boot. */
export const GameLobbyPageLazy = lazy(() => import('../pages/GameLobbyPage'))
export const CasinoSportsPageLazy = lazy(() => import('../pages/CasinoSportsPage'))
export const StudiosPageLazy = lazy(() => import('../pages/StudiosPage'))
export const VerifyEmailPageLazy = lazy(() => import('../pages/VerifyEmailPage'))
export const ProfilePageLazy = lazy(() => import('../pages/ProfilePage'))
export const BonusesPreviewPageLazy = lazy(() => import('../pages/BonusesPreviewPage'))
export const BonusesPageLazy = lazy(() => import('../pages/BonusesPage'))
export const VipPageLazy = lazy(() => import('../pages/VipPage'))
export const WalletDepositPageLazy = lazy(() => import('../pages/WalletDepositPage'))
export const LegalPageLazy = lazy(() => import('../pages/LegalPage'))
export const DemoEmbedPageLazy = lazy(() => import('../pages/DemoEmbedPage'))
