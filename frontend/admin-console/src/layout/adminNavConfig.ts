/** Sidebar navigation for AdminLTE shell (Bonus Engine, Finance, etc.). */

export type AdminNavSubItem = {
  name: string
  path: string
  new?: boolean
}

export type AdminNavSection = {
  name: string
  iconClass: string
  path?: string
  subItems?: AdminNavSubItem[]
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    name: 'Dashboard',
    iconClass: 'bi bi-speedometer2',
    path: '/',
  },
  {
    name: 'Finance',
    iconClass: 'bi bi-wallet2',
    subItems: [
      { name: 'Overview', path: '/finance' },
      { name: 'Crypto performance', path: '/finance/crypto-performance', new: true },
      { name: 'By country (ledger)', path: '/finance/by-country', new: true },
      { name: 'Deposits', path: '/deposits' },
      { name: 'Withdrawals', path: '/withdrawals' },
      { name: 'Withdrawal approvals', path: '/withdrawal-approvals', new: true },
      { name: 'Ledger', path: '/ledger' },
    ],
  },
  {
    name: 'Demographics & Traffic',
    iconClass: 'bi bi-globe2',
    subItems: [
      { name: 'Geo & visitors', path: '/analytics/demographics', new: true },
      { name: 'Sources & attribution', path: '/analytics/traffic-sources', new: true },
    ],
  },
  {
    name: 'Players',
    iconClass: 'bi bi-people',
    subItems: [
      { name: 'All players', path: '/users' },
      { name: 'Player lookup', path: '/support' },
    ],
  },
  {
    name: 'Games',
    iconClass: 'bi bi-controller',
    subItems: [
      { name: 'Catalog', path: '/games' },
      { name: 'BlueOcean events', path: '/games/blueocean-events', new: true },
      { name: 'Launches', path: '/game-launches' },
      { name: 'Disputes', path: '/game-disputes' },
      { name: 'Provider ops', path: '/provider-ops' },
      { name: 'Oddin Bifrost', path: '/integrations/oddin', new: true },
    ],
  },
  {
    name: 'Bonus Engine',
    iconClass: 'bi bi-gift',
    subItems: [
      { name: 'Promotions', path: '/bonushub' },
      { name: 'Risk queue', path: '/bonushub/risk' },
      { name: 'Campaign analytics', path: '/bonushub/campaign-analytics', new: true },
      { name: 'Rewards map', path: '/bonushub/player-layout' },
      { name: 'Smart suggestions', path: '/bonushub/recommendations' },
      { name: 'Compliance trail', path: '/bonushub/bonus-audit', new: true },
    ],
  },
  {
    name: 'CMS',
    iconClass: 'bi bi-columns-gap',
    subItems: [
      { name: 'Content overview', path: '/content-cms', new: true },
    ],
  },
  {
    name: 'VIP Engine',
    iconClass: 'bi bi-gem',
    subItems: [
      { name: 'Program', path: '/engagement/vip', new: true },
      { name: 'Player messaging', path: '/engagement/vip/broadcast', new: true },
      { name: 'Bonus scheduling', path: '/engagement/vip/schedules', new: true },
      { name: 'Delivery runs', path: '/engagement/vip/delivery', new: true },
    ],
  },
  {
    name: 'Engagement',
    iconClass: 'bi bi-heart',
    subItems: [
      { name: 'Global chat', path: '/global-chat', new: true },
      { name: 'Challenges', path: '/engagement/challenges', new: true },
    ],
  },
  {
    name: 'Compliance & Risk',
    iconClass: 'bi bi-shield-check',
    subItems: [
      { name: 'Audit log', path: '/audit-log', new: true },
      { name: '4-eyes approvals', path: '/security/approvals', new: true },
      { name: 'Break-glass grants', path: '/security/break-glass', new: true },
    ],
  },
  {
    name: 'System',
    iconClass: 'bi bi-gear',
    subItems: [
      { name: 'Diagnostics', path: '/diagnostics' },
      { name: 'Security keys', path: '/system/security-keys', new: true },
      { name: 'Staff users', path: '/system/staff-users', new: true },
      { name: 'Settings', path: '/settings' },
    ],
  },
]
