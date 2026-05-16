type ContentStatus = 'draft' | 'published' | 'review'
type ContentType = 'homepage' | 'policy' | 'legal' | 'navigation' | 'footer' | 'promotional' | 'account' | 'game'
type FieldType = 'text' | 'textarea' | 'richtext' | 'cta' | 'image' | 'toggle' | 'seo'

export type CMSSectionField = {
  id: string
  label: string
  type: FieldType
  value: string | boolean
  placeholder?: string
}

export type CMSSection = {
  id: string
  title: string
  description: string
  fields: CMSSectionField[]
  optional: boolean
  enabled: boolean
  sortOrder: number
  lastEditedAt: string
  lastEditedBy: string
}

export type CMSPage = {
  id: string
  name: string
  route: string
  contentType: ContentType
  status: ContentStatus
  lastUpdated: string
  sections: CMSSection[]
  seo: {
    title: string
    description: string
    ogImage: string
  }
}

export type CMSPolicyVersion = {
  version: string
  effectiveDate: string
  changeSummary: string
  publishedAt: string
  publishedBy: string
}

export type CMSPolicyPage = {
  id: string
  title: string
  route: string
  jurisdiction: string
  effectiveDate: string
  version: string
  status: ContentStatus
  body: string
  changeSummary: string
  history: CMSPolicyVersion[]
  lastUpdated: string
}

export type CMSBanner = {
  id: string
  label: string
  text: string
  image: string
  ctaLabel: string
  ctaLink: string
  placement: string
  status: 'active' | 'scheduled' | 'paused'
  startDate: string
  endDate: string
}

export type CMSFaq = {
  id: string
  category: string
  question: string
  answer: string
  sortOrder: number
  active: boolean
}

export type CMSNavLink = {
  id: string
  label: string
  href: string
  group: 'header' | 'footer' | 'legal' | 'support' | 'social' | 'telegram'
}

export type CMSDuplicateWarning = {
  id: string
  severity: 'low' | 'medium' | 'high'
  area: string
  summary: string
  files: string[]
  recommendation: string
}

export type CMSActivityLogItem = {
  id: string
  admin: string
  target: string
  actionType: 'draft_saved' | 'published' | 'updated' | 'reverted'
  previousValueSummary: string
  newValueSummary: string
  publishStatus: 'draft' | 'published'
  date: string
}

export type CMSScanSummary = {
  editablePagesCount: number
  policyPagesCount: number
  activeBannersCount: number
  editableHomepageSectionsCount: number
  duplicateWarningsCount: number
  contentNeedingReviewCount: number
  recentlyUpdatedContentCount: number
}

type CMSStore = {
  pages: CMSPage[]
  policies: CMSPolicyPage[]
  banners: CMSBanner[]
  faqs: CMSFaq[]
  links: CMSNavLink[]
  duplicates: CMSDuplicateWarning[]
  activity: CMSActivityLogItem[]
  homepage: HomepageContentModel
}

export type HomeHeroTile = {
  id: string
  badge: string
  title: string
  subtitle: string
  ctaLabel: string
  ctaLink: string
  image: string
  active: boolean
}

export type HomeRaffleTile = HomeHeroTile & {
  ticketsLabel: string
  countdownText: string
}

export type HomeStudioItem = {
  id: string
  name: string
  logo: string
  sortOrder: number
  active: boolean
}

export type HomepageContentModel = {
  raffleTile: HomeRaffleTile
  promoTiles: HomeHeroTile[]
  studios: HomeStudioItem[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

const store: CMSStore = {
  pages: [
    {
      id: 'page-home',
      name: 'Casino Home',
      route: '/casino/games',
      contentType: 'homepage',
      status: 'published',
      lastUpdated: '2026-05-03T21:24:00.000Z',
      seo: {
        title: 'Play Online Casino Games',
        description: 'Discover games, promos and live casino content.',
        ogImage: '/assets/seo/home-og.jpg',
      },
      sections: [
        {
          id: 'hero',
          title: 'Hero section',
          description: 'Top hero banners and introductory copy',
          optional: false,
          enabled: true,
          sortOrder: 1,
          lastEditedAt: '2026-05-03T21:24:00.000Z',
          lastEditedBy: 'admin@vybebet.com',
          fields: [
            { id: 'hero-title', label: 'Hero title', type: 'text', value: 'Play smart. Win big.' },
            { id: 'hero-subtitle', label: 'Hero subtitle', type: 'textarea', value: 'Top games, quick deposits, transparent gameplay.' },
            { id: 'hero-cta-label', label: 'Hero CTA label', type: 'cta', value: 'Play now' },
            { id: 'hero-cta-link', label: 'Hero CTA link', type: 'cta', value: '/casino/games' },
            { id: 'hero-image', label: 'Hero image', type: 'image', value: '/assets/hero/main-banner.png' },
          ],
        },
        {
          id: 'home-sections',
          title: 'Homepage sections',
          description: 'Featured rows and section toggles',
          optional: true,
          enabled: true,
          sortOrder: 2,
          lastEditedAt: '2026-05-03T21:24:00.000Z',
          lastEditedBy: 'admin@vybebet.com',
          fields: [
            { id: 'featured-enabled', label: 'Enable featured row', type: 'toggle', value: true },
            { id: 'challenges-enabled', label: 'Enable challenges row', type: 'toggle', value: true },
            { id: 'new-games-enabled', label: 'Enable new releases row', type: 'toggle', value: true },
          ],
        },
      ],
    },
    {
      id: 'page-studios',
      name: 'Studios',
      route: '/casino/studios',
      contentType: 'game',
      status: 'published',
      lastUpdated: '2026-05-02T18:01:00.000Z',
      seo: {
        title: 'Studios',
        description: 'Browse game providers and studio catalogs.',
        ogImage: '/assets/seo/studios-og.jpg',
      },
      sections: [
        {
          id: 'studios-heading',
          title: 'Studios heading',
          description: 'Page title and search hint',
          optional: false,
          enabled: true,
          sortOrder: 1,
          lastEditedAt: '2026-05-02T18:01:00.000Z',
          lastEditedBy: 'content@vybebet.com',
          fields: [
            { id: 'studios-title', label: 'Page title', type: 'text', value: 'Studios' },
            { id: 'studios-search', label: 'Search placeholder', type: 'text', value: 'Search studios' },
          ],
        },
      ],
    },
    {
      id: 'page-bonuses',
      name: 'Bonuses',
      route: '/bonuses',
      contentType: 'promotional',
      status: 'review',
      lastUpdated: '2026-05-04T09:00:00.000Z',
      seo: {
        title: 'My Bonuses',
        description: 'Manage active and available promotions.',
        ogImage: '/assets/seo/bonuses-og.jpg',
      },
      sections: [
        {
          id: 'bonuses-header',
          title: 'Bonuses header',
          description: 'Heading and helper copy',
          optional: false,
          enabled: true,
          sortOrder: 1,
          lastEditedAt: '2026-05-04T09:00:00.000Z',
          lastEditedBy: 'ops@vybebet.com',
          fields: [
            { id: 'bonuses-title', label: 'Title', type: 'text', value: 'My Bonuses' },
            { id: 'bonuses-subtitle', label: 'Subtitle', type: 'textarea', value: 'Offers appear here when you qualify.' },
          ],
        },
      ],
    },
    {
      id: 'page-profile',
      name: 'Profile',
      route: '/profile',
      contentType: 'account',
      status: 'published',
      lastUpdated: '2026-05-04T16:14:00.000Z',
      seo: {
        title: 'Profile',
        description: 'Player profile, settings and wallet overview.',
        ogImage: '/assets/seo/profile-og.jpg',
      },
      sections: [
        {
          id: 'profile-tabs',
          title: 'Profile tabs',
          description: 'Tab labels and account helper sections',
          optional: false,
          enabled: true,
          sortOrder: 1,
          lastEditedAt: '2026-05-04T16:14:00.000Z',
          lastEditedBy: 'ops@vybebet.com',
          fields: [
            { id: 'profile-overview-label', label: 'Overview label', type: 'text', value: 'Overview' },
            { id: 'profile-transactions-label', label: 'Transactions label', type: 'text', value: 'Transactions' },
            { id: 'profile-help-title', label: 'Help title', type: 'text', value: 'Help & support' },
          ],
        },
      ],
    },
    {
      id: 'page-footer-nav',
      name: 'Footer and Navigation',
      route: '*global*',
      contentType: 'navigation',
      status: 'published',
      lastUpdated: '2026-05-01T11:20:00.000Z',
      seo: {
        title: 'Global content',
        description: 'Footer and navigation labels.',
        ogImage: '/assets/seo/global-og.jpg',
      },
      sections: [
        {
          id: 'header-links',
          title: 'Header navigation labels',
          description: 'Main nav labels and special links',
          optional: false,
          enabled: true,
          sortOrder: 1,
          lastEditedAt: '2026-05-01T11:20:00.000Z',
          lastEditedBy: 'admin@vybebet.com',
          fields: [
            { id: 'nav-casino', label: 'Casino label', type: 'text', value: 'Casino' },
            { id: 'nav-sports', label: 'E-Sports label', type: 'text', value: 'E-Sports' },
            { id: 'nav-bonuses', label: 'Bonuses label', type: 'text', value: 'Bonuses' },
          ],
        },
      ],
    },
  ],
  policies: [
    {
      id: 'policy-terms',
      title: 'Terms and Conditions',
      route: '/terms',
      jurisdiction: 'Global',
      effectiveDate: '2026-04-01',
      version: 'v2.4',
      status: 'published',
      body: '<h2>Terms and Conditions</h2><p>Current published terms content.</p>',
      changeSummary: 'Updated bonus forfeiture and dispute wording.',
      lastUpdated: '2026-04-01T10:00:00.000Z',
      history: [
        {
          version: 'v2.4',
          effectiveDate: '2026-04-01',
          changeSummary: 'Updated bonus forfeiture and dispute wording.',
          publishedAt: '2026-04-01T10:00:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
        {
          version: 'v2.3',
          effectiveDate: '2025-12-20',
          changeSummary: 'Clarified player account closure clauses.',
          publishedAt: '2025-12-20T09:30:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
      ],
    },
    {
      id: 'policy-privacy',
      title: 'Privacy Policy',
      route: '/privacy',
      jurisdiction: 'Global',
      effectiveDate: '2026-03-15',
      version: 'v1.9',
      status: 'published',
      body: '<h2>Privacy Policy</h2><p>Current published privacy content.</p>',
      changeSummary: 'Added telemetry and cookie processing notes.',
      lastUpdated: '2026-03-15T08:15:00.000Z',
      history: [
        {
          version: 'v1.9',
          effectiveDate: '2026-03-15',
          changeSummary: 'Added telemetry and cookie processing notes.',
          publishedAt: '2026-03-15T08:15:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
      ],
    },
    {
      id: 'policy-aml',
      title: 'AML Policy',
      route: '/aml',
      jurisdiction: 'Global',
      effectiveDate: '2026-02-10',
      version: 'v1.5',
      status: 'review',
      body: '<h2>AML Policy</h2><p>Current AML content draft.</p>',
      changeSummary: 'Pending legal review on KYC evidence clauses.',
      lastUpdated: '2026-05-03T12:10:00.000Z',
      history: [
        {
          version: 'v1.4',
          effectiveDate: '2026-02-10',
          changeSummary: 'Expanded sanctions-screening language.',
          publishedAt: '2026-02-10T11:00:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
      ],
    },
    {
      id: 'policy-kyc',
      title: 'KYC Policy',
      route: '/kyc-policy',
      jurisdiction: 'Global',
      effectiveDate: '2026-01-05',
      version: 'v1.2',
      status: 'draft',
      body: '<h2>KYC Policy</h2><p>Draft KYC policy text.</p>',
      changeSummary: 'Initial policy draft linked to AML updates.',
      lastUpdated: '2026-05-05T07:20:00.000Z',
      history: [
        {
          version: 'v1.1',
          effectiveDate: '2026-01-05',
          changeSummary: 'Baseline verification and source-of-funds requirements.',
          publishedAt: '2026-01-05T08:00:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
      ],
    },
    {
      id: 'policy-rg',
      title: 'Responsible Gaming',
      route: '/responsible-gambling',
      jurisdiction: 'Global',
      effectiveDate: '2026-02-19',
      version: 'v1.6',
      status: 'published',
      body: '<h2>Responsible Gaming</h2><p>Current RG page content.</p>',
      changeSummary: 'Updated limit and self-exclusion wording.',
      lastUpdated: '2026-02-19T14:10:00.000Z',
      history: [
        {
          version: 'v1.6',
          effectiveDate: '2026-02-19',
          changeSummary: 'Updated limit and self-exclusion wording.',
          publishedAt: '2026-02-19T14:10:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
      ],
    },
    {
      id: 'policy-cookie',
      title: 'Cookie Policy',
      route: '/cookie-policy',
      jurisdiction: 'Global',
      effectiveDate: '2026-03-28',
      version: 'v1.3',
      status: 'published',
      body: '<h2>Cookie Policy</h2><p>Current cookie policy text.</p>',
      changeSummary: 'Added retention window details.',
      lastUpdated: '2026-03-28T09:50:00.000Z',
      history: [
        {
          version: 'v1.3',
          effectiveDate: '2026-03-28',
          changeSummary: 'Added retention window details.',
          publishedAt: '2026-03-28T09:50:00.000Z',
          publishedBy: 'legal@vybebet.com',
        },
      ],
    },
  ],
  banners: [
    {
      id: 'banner-home-main',
      label: 'Homepage Main Banner',
      text: 'Claim your welcome package',
      image: '/assets/hero/main-banner.png',
      ctaLabel: 'View offers',
      ctaLink: '/bonuses',
      placement: 'homepage.hero',
      status: 'active',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    },
    {
      id: 'banner-studios',
      label: 'Studios Promo',
      text: 'Discover new game studios',
      image: '/assets/banners/studios-promo.png',
      ctaLabel: 'Browse studios',
      ctaLink: '/casino/studios',
      placement: 'studios.top',
      status: 'scheduled',
      startDate: '2026-05-10',
      endDate: '2026-06-10',
    },
  ],
  faqs: [
    {
      id: 'faq-1',
      category: 'Payments',
      question: 'How long do deposits take?',
      answer: 'Deposits are usually credited within minutes after network confirmation.',
      sortOrder: 1,
      active: true,
    },
    {
      id: 'faq-2',
      category: 'Account',
      question: 'How can I reset my password?',
      answer: 'Use the forgot password flow on the sign-in modal and follow the email instructions.',
      sortOrder: 2,
      active: true,
    },
  ],
  links: [
    { id: 'lnk-head-casino', label: 'Casino', href: '/casino/games', group: 'header' },
    { id: 'lnk-head-sports', label: 'E-Sports', href: '/casino/sports', group: 'header' },
    { id: 'lnk-head-bonus', label: 'Bonuses', href: '/bonuses', group: 'header' },
    { id: 'lnk-foot-terms', label: 'Terms of Service', href: '/terms', group: 'legal' },
    { id: 'lnk-foot-privacy', label: 'Privacy Policy', href: '/privacy', group: 'legal' },
    { id: 'lnk-foot-rg', label: 'Responsible Gaming', href: '/responsible-gambling', group: 'legal' },
    { id: 'lnk-foot-support', label: 'Help & Support', href: '/support', group: 'support' },
    { id: 'lnk-social-telegram', label: 'Telegram', href: 'https://t.me/vybebet', group: 'telegram' },
  ],
  duplicates: [
    {
      id: 'dup-legal-links',
      severity: 'medium',
      area: 'Legal route labels',
      summary: 'Legal links and route labels are repeated in footer and route maps.',
      files: ['frontend/player-ui/src/App.tsx', 'frontend/player-ui/src/components/SiteFooter.tsx'],
      recommendation: 'Use one shared legal-link structure consumed by routes and footer.',
    },
    {
      id: 'dup-deposit-copy',
      severity: 'high',
      area: 'Deposit and wallet copy',
      summary: 'Deposit step copy and warnings are duplicated across route and modal components.',
      files: [
        'frontend/player-ui/src/pages/WalletDepositPage.tsx',
        'frontend/player-ui/src/components/WalletFlowModal.tsx',
      ],
      recommendation: 'Consolidate to shared content schema and render from one source.',
    },
    {
      id: 'dup-policy-fallback',
      severity: 'low',
      area: 'Legal fallback content',
      summary: 'Fallback legal policies are maintained in multiple locale-specific files.',
      files: [
        'frontend/player-ui/src/legal/legalFallbackBodies.en.ts',
        'frontend/player-ui/src/legal/fr-CA/bodies',
      ],
      recommendation: 'Keep locale split but centralize metadata and section scaffolding.',
    },
  ],
  activity: [
    {
      id: 'act-1',
      admin: 'admin@vybebet.com',
      target: '/casino/games · Hero section',
      actionType: 'published',
      previousValueSummary: 'Hero subtitle used old welcome text.',
      newValueSummary: 'Hero subtitle updated for Spring campaign.',
      publishStatus: 'published',
      date: '2026-05-04T11:05:00.000Z',
    },
    {
      id: 'act-2',
      admin: 'legal@vybebet.com',
      target: '/aml · AML Policy',
      actionType: 'draft_saved',
      previousValueSummary: 'Version v1.4 published text.',
      newValueSummary: 'Added enhanced due diligence clauses.',
      publishStatus: 'draft',
      date: '2026-05-03T12:10:00.000Z',
    },
  ],
  homepage: {
    raffleTile: {
      id: 'raffle-tile',
      badge: '1D 9H 35M',
      title: '$25K Raffle',
      subtitle: 'Your tickets:',
      ctaLabel: 'Learn more',
      ctaLink: '/raffle',
      image: '/assets/hero/raffle-banner.png',
      active: true,
      ticketsLabel: '0',
      countdownText: '1d 9h 35m',
    },
    promoTiles: [
      {
        id: 'promo-roulette',
        badge: 'NEW RELEASE',
        title: 'vybebet Roulette',
        subtitle: 'Half the house edge of normal roulette!',
        ctaLabel: 'Play Now!',
        ctaLink: '/casino/games',
        image: '/assets/hero/roulette-banner.png',
        active: true,
      },
      {
        id: 'promo-rewards',
        badge: 'REWARDS',
        title: 'Become a vybebet VIP',
        subtitle: "The world's most lucrative VIP programme",
        ctaLabel: 'Explore VIP',
        ctaLink: '/vip',
        image: '/assets/hero/rewards-banner.png',
        active: true,
      },
    ],
    studios: [
      { id: 'studio-gamingcorps', name: 'Gaming Corps', logo: '/assets/studios/gaming-corps.png', sortOrder: 1, active: true },
      { id: 'studio-pragmatic', name: 'Pragmatic Play', logo: '/assets/studios/pragmatic.png', sortOrder: 2, active: true },
      { id: 'studio-habanero', name: 'Habanero', logo: '/assets/studios/habanero.png', sortOrder: 3, active: true },
      { id: 'studio-slotmill', name: 'Slotmill', logo: '/assets/studios/slotmill.png', sortOrder: 4, active: true },
      { id: 'studio-hacksaw', name: 'Hacksaw', logo: '/assets/studios/hacksaw.png', sortOrder: 5, active: true },
      { id: 'studio-thunderkick', name: 'Thunderkick', logo: '/assets/studios/thunderkick.png', sortOrder: 6, active: true },
      { id: 'studio-nolimit', name: 'NoLimit City', logo: '/assets/studios/nolimit.png', sortOrder: 7, active: true },
    ],
  },
}

function appendActivity(
  actionType: CMSActivityLogItem['actionType'],
  target: string,
  previousValueSummary: string,
  newValueSummary: string,
  publishStatus: CMSActivityLogItem['publishStatus'],
) {
  store.activity.unshift({
    id: `act-${Math.random().toString(36).slice(2, 10)}`,
    admin: 'current.admin@vybebet.com',
    target,
    actionType,
    previousValueSummary,
    newValueSummary,
    publishStatus,
    date: nowIso(),
  })
}

export async function scanExistingContent(): Promise<CMSScanSummary> {
  const editablePagesCount = store.pages.length
  const policyPagesCount = store.policies.length
  const activeBannersCount = store.banners.filter((b) => b.status === 'active').length
  const homepage = store.pages.find((p) => p.route === '/casino/games')
  const editableHomepageSectionsCount = homepage ? homepage.sections.length : 0
  const duplicateWarningsCount = store.duplicates.length
  const contentNeedingReviewCount =
    store.pages.filter((p) => p.status === 'review').length + store.policies.filter((p) => p.status === 'review').length
  const recentlyUpdatedContentCount = [...store.pages, ...store.policies].filter((p) => {
    const ageMs = Date.now() - new Date(p.lastUpdated).getTime()
    return ageMs <= 1000 * 60 * 60 * 24 * 7
  }).length
  return {
    editablePagesCount,
    policyPagesCount,
    activeBannersCount,
    editableHomepageSectionsCount,
    duplicateWarningsCount,
    contentNeedingReviewCount,
    recentlyUpdatedContentCount,
  }
}

export async function getEditableContentPages(): Promise<CMSPage[]> {
  return clone(store.pages)
}

export async function getContentPageByRoute(route: string): Promise<CMSPage | null> {
  const page = store.pages.find((p) => p.route === route)
  return page ? clone(page) : null
}

export async function updatePageSection(
  route: string,
  sectionId: string,
  updatedFields: Array<{ id: string; value: string | boolean }>,
): Promise<CMSPage | null> {
  const page = store.pages.find((p) => p.route === route)
  if (!page) return null
  const section = page.sections.find((s) => s.id === sectionId)
  if (!section) return null
  const previous = section.fields
    .map((f) => `${f.label}: ${String(f.value).slice(0, 24)}`)
    .slice(0, 3)
    .join(' | ')
  for (const input of updatedFields) {
    const field = section.fields.find((f) => f.id === input.id)
    if (field) field.value = input.value
  }
  section.lastEditedAt = nowIso()
  section.lastEditedBy = 'current.admin@vybebet.com'
  page.lastUpdated = nowIso()
  page.status = 'draft'
  const next = section.fields
    .map((f) => `${f.label}: ${String(f.value).slice(0, 24)}`)
    .slice(0, 3)
    .join(' | ')
  appendActivity('updated', `${route} · ${section.title}`, previous, next, 'draft')
  return clone(page)
}

export async function saveContentDraft(route: string): Promise<{ ok: boolean; updatedAt: string }> {
  const page = store.pages.find((p) => p.route === route)
  if (!page) return { ok: false, updatedAt: nowIso() }
  page.status = 'draft'
  page.lastUpdated = nowIso()
  appendActivity('draft_saved', route, 'Current page content', 'Draft saved', 'draft')
  return { ok: true, updatedAt: page.lastUpdated }
}

export async function publishContentChanges(route: string): Promise<{ ok: boolean; publishedAt: string }> {
  const page = store.pages.find((p) => p.route === route)
  if (!page) return { ok: false, publishedAt: nowIso() }
  page.status = 'published'
  page.lastUpdated = nowIso()
  appendActivity('published', route, 'Draft content', 'Published content', 'published')
  return { ok: true, publishedAt: page.lastUpdated }
}

export async function getPolicyPages(): Promise<CMSPolicyPage[]> {
  return clone(store.policies)
}

export async function updatePolicyContent(
  policyId: string,
  update: Partial<Pick<CMSPolicyPage, 'title' | 'effectiveDate' | 'version' | 'jurisdiction' | 'body' | 'changeSummary'>>,
): Promise<CMSPolicyPage | null> {
  const policy = store.policies.find((p) => p.id === policyId)
  if (!policy) return null
  const prev = `${policy.version} | ${policy.effectiveDate} | ${policy.changeSummary}`
  if (update.title !== undefined) policy.title = update.title
  if (update.effectiveDate !== undefined) policy.effectiveDate = update.effectiveDate
  if (update.version !== undefined) policy.version = update.version
  if (update.jurisdiction !== undefined) policy.jurisdiction = update.jurisdiction
  if (update.body !== undefined) policy.body = update.body
  if (update.changeSummary !== undefined) policy.changeSummary = update.changeSummary
  policy.status = 'draft'
  policy.lastUpdated = nowIso()
  const next = `${policy.version} | ${policy.effectiveDate} | ${policy.changeSummary}`
  appendActivity('updated', `${policy.route} · ${policy.title}`, prev, next, 'draft')
  return clone(policy)
}

export async function publishPolicyVersion(
  policyId: string,
  options: { changeSummary: string; effectiveDate?: string; version?: string },
): Promise<CMSPolicyPage | null> {
  const policy = store.policies.find((p) => p.id === policyId)
  if (!policy) return null
  if (options.effectiveDate) policy.effectiveDate = options.effectiveDate
  if (options.version) policy.version = options.version
  policy.changeSummary = options.changeSummary
  policy.status = 'published'
  policy.lastUpdated = nowIso()
  policy.history.unshift({
    version: policy.version,
    effectiveDate: policy.effectiveDate,
    changeSummary: options.changeSummary,
    publishedAt: policy.lastUpdated,
    publishedBy: 'current.admin@vybebet.com',
  })
  appendActivity('published', `${policy.route} · ${policy.title}`, 'Draft policy version', options.changeSummary, 'published')
  return clone(policy)
}

export async function getContentDuplicates(): Promise<CMSDuplicateWarning[]> {
  return clone(store.duplicates)
}

export async function getCMSActivityLog(): Promise<CMSActivityLogItem[]> {
  return clone(store.activity)
}

export async function getBannerPromos(): Promise<CMSBanner[]> {
  return clone(store.banners)
}

export async function updateBannerPromo(bannerId: string, update: Partial<CMSBanner>): Promise<CMSBanner | null> {
  const banner = store.banners.find((b) => b.id === bannerId)
  if (!banner) return null
  const prev = `${banner.text} | ${banner.ctaLabel} | ${banner.status}`
  Object.assign(banner, update)
  const next = `${banner.text} | ${banner.ctaLabel} | ${banner.status}`
  appendActivity('updated', `${banner.placement} · ${banner.label}`, prev, next, banner.status === 'active' ? 'published' : 'draft')
  return clone(banner)
}

export async function getFaqItems(): Promise<CMSFaq[]> {
  return clone(store.faqs).sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function updateFaqItem(faqId: string, update: Partial<CMSFaq>): Promise<CMSFaq | null> {
  const faq = store.faqs.find((f) => f.id === faqId)
  if (!faq) return null
  const prev = `${faq.question} | active=${faq.active}`
  Object.assign(faq, update)
  const next = `${faq.question} | active=${faq.active}`
  appendActivity('updated', `FAQ · ${faq.category}`, prev, next, 'draft')
  return clone(faq)
}

export async function getFooterAndNavLinks(): Promise<CMSNavLink[]> {
  return clone(store.links)
}

export async function updateFooterOrNavLink(linkId: string, update: Partial<CMSNavLink>): Promise<CMSNavLink | null> {
  const link = store.links.find((l) => l.id === linkId)
  if (!link) return null
  const prev = `${link.label} -> ${link.href}`
  Object.assign(link, update)
  const next = `${link.label} -> ${link.href}`
  appendActivity('updated', `Link · ${link.group}`, prev, next, 'draft')
  return clone(link)
}

export async function getHomepageContentModel(): Promise<HomepageContentModel> {
  return clone(store.homepage)
}

export async function updateHomepageRaffleTile(update: Partial<HomeRaffleTile>): Promise<HomeRaffleTile> {
  const prev = `${store.homepage.raffleTile.title} | ${store.homepage.raffleTile.image}`
  Object.assign(store.homepage.raffleTile, update)
  const next = `${store.homepage.raffleTile.title} | ${store.homepage.raffleTile.image}`
  appendActivity('updated', 'Homepage · Raffle tile', prev, next, 'draft')
  return clone(store.homepage.raffleTile)
}

export async function updateHomepagePromoTile(tileId: string, update: Partial<HomeHeroTile>): Promise<HomeHeroTile | null> {
  const tile = store.homepage.promoTiles.find((item) => item.id === tileId)
  if (!tile) return null
  const prev = `${tile.title} | ${tile.image} | active=${tile.active}`
  Object.assign(tile, update)
  const next = `${tile.title} | ${tile.image} | active=${tile.active}`
  appendActivity('updated', `Homepage · Hero tile ${tile.title}`, prev, next, 'draft')
  return clone(tile)
}

export async function addHomepagePromoTile(): Promise<HomeHeroTile> {
  const nextIndex = store.homepage.promoTiles.length + 1
  const newTile: HomeHeroTile = {
    id: `promo-custom-${Date.now()}`,
    badge: 'NEW',
    title: `New Promo Tile ${nextIndex}`,
    subtitle: 'Update this subtitle from CMS.',
    ctaLabel: 'Learn more',
    ctaLink: '/casino/games',
    image: '/assets/hero/custom-banner.png',
    active: true,
  }
  store.homepage.promoTiles.push(newTile)
  appendActivity('updated', 'Homepage · Hero tiles', 'Tile count unchanged', `Added tile ${newTile.title}`, 'draft')
  return clone(newTile)
}

export async function updateHomepageStudio(studioId: string, update: Partial<HomeStudioItem>): Promise<HomeStudioItem | null> {
  const studio = store.homepage.studios.find((item) => item.id === studioId)
  if (!studio) return null
  const prev = `${studio.name} | ${studio.logo} | active=${studio.active}`
  Object.assign(studio, update)
  const next = `${studio.name} | ${studio.logo} | active=${studio.active}`
  appendActivity('updated', `Homepage · Studio ${studio.name}`, prev, next, 'draft')
  return clone(studio)
}

export async function addHomepageStudio(): Promise<HomeStudioItem> {
  const maxOrder = store.homepage.studios.reduce((max, item) => Math.max(max, item.sortOrder), 0)
  const studio: HomeStudioItem = {
    id: `studio-custom-${Date.now()}`,
    name: 'New Studio',
    logo: '/assets/studios/new-studio.png',
    sortOrder: maxOrder + 1,
    active: true,
  }
  store.homepage.studios.push(studio)
  appendActivity('updated', 'Homepage · Studios strip', 'Studio count unchanged', `Added studio ${studio.name}`, 'draft')
  return clone(studio)
}
