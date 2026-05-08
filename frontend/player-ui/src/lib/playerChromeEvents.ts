/** Wallet / rewards header dropdowns coordinate via document events (mobile portals + z-index). */
export const PLAYER_CHROME_CLOSE_WALLET_EVENT = 'vybe-player-close-wallet-dropdown'
export const PLAYER_CHROME_CLOSE_REWARDS_EVENT = 'vybe-player-close-rewards-dropdown'
export const PLAYER_CHROME_CLOSE_NOTIFICATIONS_EVENT = 'vybe-player-close-notifications-dropdown'
/** Global Chat drawer — close when opening rewards / wallet chrome that overlaps it. */
export const PLAYER_CHROME_CLOSE_CHAT_EVENT = 'vybe-player-close-chat-drawer'
/** Mobile left drawer — close when opening wallet/rewards; open menu closes wallet+rewards via App. */
export const PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT = 'vybe-player-close-mobile-menu'

/** Open the shell {@link WalletFlowModal} (deposit / withdraw) — same path as header Deposit. */
export const PLAYER_CHROME_OPEN_WALLET_MODAL_EVENT = 'vybe-player-open-wallet-modal'
/** Open Refer & Earn (affiliate intro + share link) — sidebar / mobile drawer. */
export const PLAYER_CHROME_OPEN_AFFILIATE_MODAL_EVENT = 'vybe-player-open-affiliate-modal'
