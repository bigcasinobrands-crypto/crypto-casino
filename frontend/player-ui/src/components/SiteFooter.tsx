import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import AcceptedCurrenciesStrip from './AcceptedCurrenciesStrip'
import { useEffect, useState, type FC } from 'react'
import { useSiteContent } from '../hooks/useSiteContent'
import { usePlayerBrandLogoSrc } from '../hooks/usePlayerBrandLogo'
import { DEFAULT_PLAYER_LOGO_PNG, DEFAULT_PLAYER_LOGO_SVG } from '../lib/brandLogoAssets'

const linkMuted = 'text-[10px] font-medium leading-snug text-casino-muted transition hover:text-casino-primary'
const colTitle = 'mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-casino-foreground'

type FooterLink = { label: string; to?: string; href?: string; requireAuth?: boolean }
type SocialLink = { label: string; url?: string }

type SeoBlock = {
  heading?: string | null
  paragraphs: string[]
  sub?: { heading: string; paragraphs: string[] }
}

const FALLBACK_SEO_TITLE = 'Play Online Casino Games for Real Money at vybebet'
const FALLBACK_SEO_BLOCKS = [
  {
    heading: 'The best online casino you will come across in 2026',
    paragraphs: [
      'vybebet is a fast-growing crypto casino built for players who want to play online casino games for real money using cryptocurrency. With thousands of games available, the platform delivers a complete real money crypto casino experience focused on performance, variety, and transparent gameplay.',
      'We support a wide range of immersive crypto casino games, including slots, table games, live dealers, and more.',
    ],
  },
  {
    heading: null,
    paragraphs: [
      'Shows include Crazy Time, Monopoly Live, Sweet Bonanza, and many more, offering dynamic gameplay for players looking for a unique crypto casino games experience.',
    ],
    sub: {
      heading: 'Saga Games',
      paragraphs: [
        'vybebet features an exciting collection of games from top studios in the industry. These titles are designed to offer engaging mechanics and high-quality gameplay.',
      ],
    },
  },
]

/** Paths match `LobbyPage` `/casino/:section` sections + catalog anchors. */
const FALLBACK_GAMES_LINKS: FooterLink[] = [
  { label: 'Slots', to: '/casino/slots', requireAuth: true },
  { label: 'Bonus Buys', to: '/casino/bonus-buys', requireAuth: true },
  { label: 'Challenges', to: '/casino/challenges', requireAuth: true },
  { label: 'Favourites', to: '/casino/favourites', requireAuth: true },
  { label: 'Studios', to: '/casino/games#studios', requireAuth: true },
  { label: 'Live Casino', to: '/casino/live', requireAuth: true },
]

const FALLBACK_ABOUT_LINKS: FooterLink[] = [
  { label: 'VIP Program', to: '/vip', requireAuth: true },
  { label: 'Affiliate' },
  { label: 'My Bonuses', to: '/bonuses', requireAuth: true },
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Fairness', to: '/fairness' },
]

const FALLBACK_SOCIAL: SocialLink[] = [
  { label: 'Discord' },
  { label: 'Twitter / X' },
  { label: 'Instagram' },
]

function renderLinkList(links: FooterLink[]) {
  return (
    <ul className="flex flex-col gap-1">
      {links.map((lk) => (
        <li key={lk.label}>
          {lk.href ? (
            <a href={lk.href} target="_blank" rel="noreferrer" className={linkMuted}>
              {lk.label}
            </a>
          ) : lk.to && lk.requireAuth ? (
            <RequireAuthLink className={linkMuted} to={lk.to}>
              {lk.label}
            </RequireAuthLink>
          ) : lk.to ? (
            <Link className={linkMuted} to={lk.to}>
              {lk.label}
            </Link>
          ) : (
            <span className={linkMuted}>{lk.label}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

const SiteFooter: FC = () => {
  const [seoOpen, setSeoOpen] = useState(false)
  const { getContent } = useSiteContent()
  const footerLogoPrimary = usePlayerBrandLogoSrc()
  const siteLabel = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'
  const [footerLogoSrc, setFooterLogoSrc] = useState(footerLogoPrimary)
  useEffect(() => setFooterLogoSrc(footerLogoPrimary), [footerLogoPrimary])

  const seoTitle = getContent<string>('footer.seo_title', FALLBACK_SEO_TITLE)
  const seoBlocks = getContent('footer.seo_blocks', FALLBACK_SEO_BLOCKS)
  const copyright = getContent<string>('footer.copyright', '18+ · Play responsibly.')

  const gamesLinks = getContent<FooterLink[]>('links.games', FALLBACK_GAMES_LINKS)
  const aboutLinks = getContent<FooterLink[]>('links.about', FALLBACK_ABOUT_LINKS)

  const socials = getContent<SocialLink[]>('social.links', FALLBACK_SOCIAL)

  return (
    <footer id="help" className="relative isolate casino-shell-page-pad border-t border-casino-border bg-casino-bg pb-8 pt-8 md:pt-10">
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
              Show more
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
              Show less
            </button>
          </div>
        )}
      </div>

      <div className="mx-auto mt-8 flex max-w-[min(100%,90rem)] flex-col gap-6 md:mt-10 md:gap-7 min-[1280px]:gap-8">
        <div className="flex flex-col gap-6 md:gap-5 min-[1280px]:flex-row min-[1280px]:items-start min-[1280px]:justify-between min-[1280px]:gap-8">
          <Link
            to="/casino/games"
            className="mx-auto flex shrink-0 items-center rounded-casino-md outline-none ring-casino-primary/0 transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-casino-primary min-[1280px]:mx-0 min-[1280px]:pt-0.5"
          >
            <img
              src={footerLogoSrc}
              alt={siteLabel}
              className="block h-auto max-h-14 w-auto max-w-[min(260px,100%)] shrink-0 object-contain object-left md:max-h-16 min-[1280px]:max-h-[4.5rem]"
              decoding="async"
              onError={() => {
                setFooterLogoSrc((prev) => {
                  if (prev === DEFAULT_PLAYER_LOGO_SVG) return prev
                  if (prev === DEFAULT_PLAYER_LOGO_PNG) return DEFAULT_PLAYER_LOGO_SVG
                  return DEFAULT_PLAYER_LOGO_PNG
                })
              }}
            />
          </Link>
          <nav
            className="grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 md:grid-cols-3 md:gap-x-5 min-[1280px]:flex min-[1280px]:min-w-0 min-[1280px]:flex-1 min-[1280px]:flex-row min-[1280px]:flex-wrap min-[1280px]:items-start min-[1280px]:justify-end min-[1280px]:gap-x-5 min-[1280px]:gap-y-4 min-[1536px]:gap-x-6"
            aria-label="Footer"
          >
            <div className="flex flex-col min-[1280px]:shrink-0">
              <div className={colTitle}>Games</div>
              {renderLinkList(gamesLinks)}
            </div>
            <div className="flex flex-col min-[1280px]:shrink-0">
              <div className={colTitle}>About Us</div>
              {renderLinkList(aboutLinks)}
            </div>
            <div className="flex flex-col min-[1280px]:shrink-0">
              <div className={colTitle}>Communities</div>
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {['Licensed', 'Provably Fair', 'Responsible Gaming'].map((label) => (
            <div
              key={label}
              className="flex items-center justify-center rounded-[4px] bg-casino-surface px-4 py-4 text-center"
            >
              <span className="text-[11px] font-bold text-casino-foreground">{label}</span>
            </div>
          ))}
        </div>

        <div className="text-center text-[10px] leading-relaxed text-casino-muted">
          <p>{copyright}</p>
        </div>
      </div>
    </footer>
  )
}

export default SiteFooter
