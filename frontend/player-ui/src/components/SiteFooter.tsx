import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import AcceptedCurrenciesStrip from './AcceptedCurrenciesStrip'
import type { TFunction } from 'i18next'
import { useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSiteContent } from '../hooks/useSiteContent'
import { PLAYER_CHROME_OPEN_AFFILIATE_MODAL_EVENT } from '../lib/playerChromeEvents'

const linkMuted = 'text-[10px] font-medium leading-snug text-casino-muted transition hover:text-casino-primary'
const colTitle = 'mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-casino-foreground'

type FooterLink = {
  label: string
  to?: string
  href?: string
  requireAuth?: boolean
  /** Same behavior as sidebar Affiliate — opens Refer & Earn. */
  openAffiliateModal?: boolean
}
type SocialLink = { label: string; url?: string }

type SeoBlock = {
  heading?: string | null
  paragraphs: string[]
  sub?: { heading: string; paragraphs: string[] }
}

function buildLocalizedSeoFallback(t: TFunction): { title: string; blocks: SeoBlock[] } {
  return {
    title: t('footer.seoFallbackTitle'),
    blocks: [
      {
        heading: t('footer.seo.block1Heading'),
        paragraphs: [t('footer.seo.block1p1'), t('footer.seo.block1p2')],
      },
      {
        heading: null,
        paragraphs: [t('footer.seo.block2p1')],
        sub: {
          heading: t('footer.seo.block2subHeading'),
          paragraphs: [t('footer.seo.block2subp1')],
        },
      },
    ],
  }
}

/** Paths match `LobbyPage` `/casino/:section` sections + catalog anchors. */
const FALLBACK_GAMES_LINKS: FooterLink[] = [
  { label: 'Slots', to: '/casino/slots', requireAuth: true },
  { label: 'Bonus Buys', to: '/casino/bonus-buys', requireAuth: true },
  { label: 'Challenges', to: '/casino/challenges', requireAuth: true },
  { label: 'Favourites', to: '/casino/favourites', requireAuth: true },
  { label: 'Studios', to: '/casino/studios', requireAuth: true },
  { label: 'Live Casino', to: '/casino/live', requireAuth: true },
]

const FALLBACK_ABOUT_LINKS: FooterLink[] = [
  { label: 'VIP Program', to: '/vip', requireAuth: true },
  { label: 'Affiliate', openAffiliateModal: true },
  { label: 'My Bonuses', to: '/bonuses', requireAuth: true },
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Responsible Gaming', to: '/responsible-gambling' },
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'AML Policy', to: '/aml' },
]

const FALLBACK_SOCIAL: SocialLink[] = [
  { label: 'Discord' },
  { label: 'Twitter / X' },
  { label: 'Instagram' },
]

function translateFooterLinkLabel(t: TFunction, lk: FooterLink): string {
  const d = lk.label
  if (lk.to === '/casino/slots') return t('footer.slots', { defaultValue: d })
  if (lk.to === '/casino/bonus-buys') return t('footer.bonusBuys', { defaultValue: d })
  if (lk.to === '/casino/challenges') return t('footer.challenges', { defaultValue: d })
  if (lk.to === '/casino/favourites') return t('footer.favourites', { defaultValue: d })
  if (lk.to === '/casino/studios') return t('footer.studios', { defaultValue: d })
  if (lk.to === '/casino/live') return t('footer.liveCasino', { defaultValue: d })
  if (lk.to === '/vip') return t('footer.vipProgram', { defaultValue: d })
  if (lk.to === '/bonuses') return t('footer.myBonuses', { defaultValue: d })
  if (lk.to === '/terms') return t('footer.terms', { defaultValue: d })
  if (lk.to === '/responsible-gambling') return t('footer.responsibleGaming', { defaultValue: d })
  if (lk.to === '/privacy') return t('footer.privacy', { defaultValue: d })
  if (lk.to === '/aml') return t('footer.aml', { defaultValue: d })
  if (!lk.to && d.toLowerCase().includes('affiliate')) return t('footer.affiliate', { defaultValue: d })
  return d
}

function footerLinkOpensAffiliateModal(lk: FooterLink): boolean {
  if (lk.openAffiliateModal) return true
  if (lk.to || lk.href) return false
  return /affiliate|affiliation/i.test(lk.label)
}

function openAffiliateModalFromFooter() {
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_OPEN_AFFILIATE_MODAL_EVENT))
}

function renderLinkList(links: FooterLink[], t: TFunction) {
  return (
    <ul className="flex flex-col gap-1">
      {links.map((lk, idx) => {
        const label = translateFooterLinkLabel(t, lk)
        return (
          <li key={`${lk.label}-${idx}`}>
            {lk.href ? (
              <a href={lk.href} target="_blank" rel="noreferrer" className={linkMuted}>
                {label}
              </a>
            ) : lk.to && lk.requireAuth ? (
              <RequireAuthLink className={linkMuted} to={lk.to}>
                {label}
              </RequireAuthLink>
            ) : lk.to ? (
              <Link className={linkMuted} to={lk.to}>
                {label}
              </Link>
            ) : footerLinkOpensAffiliateModal(lk) ? (
              <button
                type="button"
                className={`${linkMuted} cursor-pointer border-0 bg-transparent p-0 text-left font-inherit`}
                onClick={openAffiliateModalFromFooter}
              >
                {label}
              </button>
            ) : (
              <span className={linkMuted}>{label}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const SiteFooter: FC = () => {
  const [seoOpen, setSeoOpen] = useState(false)
  const { t } = useTranslation()
  const { getContent } = useSiteContent()
  const siteLabel = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'

  const localizedSeo = buildLocalizedSeoFallback(t)
  const seoTitle = getContent<string>('footer.seo_title', localizedSeo.title)
  const seoBlocks = getContent('footer.seo_blocks', localizedSeo.blocks)
  const copyrightBrand =
    (getContent<string>('branding.copyright_brand', '') ?? '').trim() ||
    (siteLabel.toLowerCase() === 'vybebet' ? 'Vybe Bet' : siteLabel || 'Vybe Bet')
  const defaultCopyright = t('footer.copyrightTemplate', {
    year: new Date().getFullYear(),
    brand: copyrightBrand,
  })
  const copyright = getContent<string>('footer.copyright', defaultCopyright)

  const gamesLinks = getContent<FooterLink[]>('links.games', FALLBACK_GAMES_LINKS)
  const aboutLinks = getContent<FooterLink[]>('links.about', FALLBACK_ABOUT_LINKS)

  const socials = getContent<SocialLink[]>('social.links', FALLBACK_SOCIAL)

  return (
    <footer
      id="help"
      className="relative isolate casino-shell-page-pad border-t border-casino-border bg-casino-bg pb-10 pt-8 max-md:pb-16 md:pt-10"
    >
      <div
        id="blog"
        className="relative mx-auto max-w-[min(100%,90rem)] scroll-mt-24 rounded-casino-md bg-casino-surface p-5 md:p-6 min-[1280px]:p-8"
      >
        <h2 className="mb-4 text-sm font-extrabold text-casino-foreground">{seoTitle}</h2>
        <div
          id="footer-seo-panel"
          className={`grid gap-8 text-[11px] leading-relaxed text-casino-muted motion-safe:transition-[max-height] motion-safe:duration-300 motion-safe:ease-out md:grid-cols-2 ${
            seoOpen ? 'max-h-[9999px]' : 'max-h-[220px] overflow-hidden md:max-h-[260px]'
          }`}
        >
          {(seoBlocks as SeoBlock[]).map((block, idx) => (
            <div key={idx}>
              {block.heading && (
                <h3 className="mb-2.5 text-xs font-bold text-casino-foreground">{block.heading}</h3>
              )}
              {(block.paragraphs as string[])?.map((p: string, pi: number) => (
                <p key={pi} className={pi > 0 ? 'mt-3' : 'mb-3'}>{p}</p>
              ))}
              {block.sub && (
                <>
                  <h3 className="mb-2.5 text-xs font-bold text-casino-foreground">{block.sub.heading}</h3>
                  {(block.sub.paragraphs as string[])?.map((p: string, pi: number) => (
                    <p key={pi}>{p}</p>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
        {!seoOpen ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[88px] items-end justify-center rounded-b-casino-md bg-gradient-to-t from-casino-surface from-65% via-casino-surface/85 to-transparent pb-4 pt-10">
            <button
              type="button"
              className="pointer-events-auto rounded-[4px] bg-casino-primary px-5 py-2 text-[11px] font-bold leading-tight text-white shadow-[0_4px_14px_rgba(123,97,255,0.35)] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
              aria-expanded={false}
              aria-controls="footer-seo-panel"
              onClick={() => setSeoOpen(true)}
            >
              {t('footer.showMore')}
            </button>
          </div>
        ) : (
          <div className="mt-4 flex justify-center border-t border-white/[0.06] pt-4">
            <button
              type="button"
              className="rounded-[4px] bg-casino-chip px-5 py-2 text-[11px] font-bold leading-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-white/[0.08] hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50"
              aria-expanded={true}
              aria-controls="footer-seo-panel"
              onClick={() => setSeoOpen(false)}
            >
              {t('footer.showLess')}
            </button>
          </div>
        )}
      </div>

      <div className="mx-auto mt-8 flex max-w-[min(100%,90rem)] flex-col gap-6 md:mt-10 md:gap-7 min-[1280px]:gap-8">
        <div className="flex flex-col gap-6 md:gap-5 min-[1280px]:flex-row min-[1280px]:items-start min-[1280px]:justify-between min-[1280px]:gap-8">
          <Link
            to="/casino/games"
            className="mb-4 flex shrink-0 items-center self-start rounded-casino-md text-[15px] font-black tracking-tight text-casino-foreground outline-none ring-casino-primary/0 transition hover:text-white focus-visible:ring-2 focus-visible:ring-casino-primary min-[1280px]:mb-0 min-[1280px]:pt-0.5 min-[1280px]:text-lg"
          >
            {siteLabel}
          </Link>
          <nav
            className="grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 md:grid-cols-3 md:gap-x-5 min-[1280px]:flex min-[1280px]:min-w-0 min-[1280px]:flex-1 min-[1280px]:flex-row min-[1280px]:flex-wrap min-[1280px]:items-start min-[1280px]:justify-end min-[1280px]:gap-x-5 min-[1280px]:gap-y-4 min-[1536px]:gap-x-6"
            aria-label={t('footer.navAriaLabel')}
          >
            <div className="flex flex-col min-[1280px]:shrink-0">
              <div className={colTitle}>{t('footer.colGames')}</div>
              {renderLinkList(gamesLinks, t)}
            </div>
            <div className="flex flex-col min-[1280px]:shrink-0">
              <div className={colTitle}>{t('footer.colAbout')}</div>
              {renderLinkList(aboutLinks, t)}
            </div>
            <div className="flex flex-col min-[1280px]:shrink-0">
              <div className={colTitle}>{t('footer.colCommunities')}</div>
              <ul className="flex flex-col gap-1">
                {socials.map((s) => (
                  <li key={s.label}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className={linkMuted}>
                        {s.label}
                      </a>
                    ) : (
                      <span className={linkMuted}>{s.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <AcceptedCurrenciesStrip />

        <div className="flex flex-col items-center border-t border-white/[0.06] px-2 pt-6">
          <div
            className="inline-flex min-h-[3.25rem] min-w-[3.25rem] shrink-0 items-center justify-center rounded-[4px] bg-casino-surface px-4 py-3"
            role="img"
            aria-label={t('footer.ageRatingAria')}
          >
            <span className="text-[11px] font-bold tabular-nums tracking-tight text-casino-foreground">18+</span>
          </div>
          <p className="mt-4 max-w-md text-center text-[10px] leading-relaxed text-casino-muted">{copyright}</p>
        </div>
      </div>
    </footer>
  )
}

export default SiteFooter
