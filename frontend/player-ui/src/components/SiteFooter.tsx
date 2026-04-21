import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import AcceptedCurrenciesStrip from './AcceptedCurrenciesStrip'
import { adminAppHref } from '@repo/cross-app'
import { useState, type FC } from 'react'
import { useSiteContent } from '../hooks/useSiteContent'

const linkMuted = 'text-[10px] font-medium leading-snug text-casino-muted transition hover:text-casino-primary'
const colTitle = 'mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-casino-foreground'

type FooterLink = { label: string; to?: string; href?: string; requireAuth?: boolean }
type SocialLink = { label: string; url?: string }

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
        'vybebet features an exciting collection of games from top providers in the industry. These titles are designed to offer engaging mechanics and high-quality gameplay.',
      ],
    },
  },
]

const FALLBACK_GAMES_LINKS: FooterLink[] = [
  { label: 'Slots', to: '/casino/slots', requireAuth: true },
  { label: 'Bonus Buys', to: '/casino/bonus-buys', requireAuth: true },
  { label: 'Challenges', to: '/casino/challenges', requireAuth: true },
  { label: 'Favourites', to: '/casino/favourites', requireAuth: true },
  { label: 'Providers', to: '/casino/games#providers', requireAuth: true },
  { label: 'Live Casino', to: '/casino/live', requireAuth: true },
]

const FALLBACK_ORIGINALS_LINKS: FooterLink[] = [
  { label: 'Blackjack' },
  { label: 'Mines' },
  { label: 'Dice' },
  { label: 'Limbo' },
  { label: 'Keno' },
]

const FALLBACK_ABOUT_LINKS: FooterLink[] = [
  { label: 'VIP Program', to: '/vip', requireAuth: false },
  { label: 'Affiliate' },
  { label: 'Rewards', to: '/rewards', requireAuth: true },
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Fairness', to: '/fairness' },
]

const FALLBACK_SOCIAL: SocialLink[] = [
  { label: 'Discord' },
  { label: 'Twitter / X' },
  { label: 'Instagram' },
]

const FALLBACK_DISCLAIMER =
  "vybebet, crypto's best casino for real money slots, is a demonstration brand for Crypto Casino. Demo wallet uses USDT minor units."

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
  const staff = adminAppHref(import.meta.env, '/login')
  const [seoOpen, setSeoOpen] = useState(false)
  const { getContent } = useSiteContent()

  const seoTitle = getContent<string>('footer.seo_title', FALLBACK_SEO_TITLE)
  const seoBlocks = getContent('footer.seo_blocks', FALLBACK_SEO_BLOCKS)
  const copyright = getContent<string>('footer.copyright', '18+ · Play responsibly.')
  const disclaimer = getContent<string>('footer.disclaimer', FALLBACK_DISCLAIMER)

  const gamesLinks = getContent<FooterLink[]>('links.games', FALLBACK_GAMES_LINKS)
  const originalsLinks = getContent<FooterLink[]>('links.originals', FALLBACK_ORIGINALS_LINKS)
  const aboutLinks = getContent<FooterLink[]>('links.about', FALLBACK_ABOUT_LINKS)

  const socials = getContent<SocialLink[]>('social.links', FALLBACK_SOCIAL)

  const currencyLabels = getContent<string[]>('footer.currencies', [
    'Solana', 'Bitcoin', 'Ethereum', 'Litecoin', 'Tether', 'USDC', 'Dogecoin',
  ])

  return (
    <footer id="help" className="mt-auto border-t border-casino-border bg-casino-bg px-5 pb-8 pt-10 md:px-6">
      <div
        id="blog"
        className="relative mx-auto max-w-[1200px] scroll-mt-24 rounded-casino-md bg-casino-surface p-6"
      >
        <h2 className="mb-4 text-sm font-extrabold text-casino-foreground">{seoTitle}</h2>
        <div
          className={`grid gap-8 text-[11px] leading-relaxed text-casino-muted md:grid-cols-2 ${seoOpen ? '' : 'max-h-[220px] overflow-hidden'}`}
        >
          {(seoBlocks as any[]).map((block: any, idx: number) => (
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
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[90px] items-end justify-center rounded-b-casino-md bg-gradient-to-t from-casino-surface from-70% to-transparent pb-4">
            <button
              type="button"
              className="pointer-events-auto rounded-[4px] bg-casino-primary px-5 py-2 text-[11px] font-bold leading-tight text-white hover:brightness-110"
              onClick={() => setSeoOpen(true)}
            >
              See more
            </button>
          </div>
        ) : null}
      </div>

      <div className="mx-auto mt-10 flex max-w-[1200px] flex-col gap-7">
        <div className="flex flex-col gap-6 sm:gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <Link
            to="/casino/games"
            className="mx-auto flex shrink-0 items-center rounded-casino-md outline-none ring-casino-primary/0 transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-casino-primary lg:mx-0 lg:pt-0.5"
          >
            <img
              src="/vybebet-logo.svg"
              alt="vybebet"
              width={200}
              height={46}
              className="h-[46px] w-[200px] max-w-full shrink-0 object-contain object-left"
              decoding="async"
            />
          </Link>
          <nav
            className="grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-5 lg:flex lg:min-w-0 lg:flex-1 lg:flex-row lg:flex-wrap lg:items-start lg:justify-end lg:gap-x-5 lg:gap-y-4 xl:gap-x-6"
            aria-label="Footer"
          >
            <div className="flex flex-col lg:shrink-0">
              <div className={colTitle}>Games</div>
              {renderLinkList(gamesLinks)}
            </div>
            <div className="flex flex-col lg:shrink-0">
              <div className={colTitle}>Originals</div>
              {renderLinkList(originalsLinks)}
            </div>
            <div className="flex flex-col lg:shrink-0">
              <div className={colTitle}>About Us</div>
              {renderLinkList(aboutLinks)}
            </div>
            <div className="flex flex-col lg:shrink-0">
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
            <div className="flex flex-col lg:shrink-0">
              <div className={colTitle}>Currencies</div>
              <ul className="flex flex-col gap-1">
                {currencyLabels.map((c) => (
                  <li key={c}>
                    <span className={linkMuted}>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <AcceptedCurrenciesStrip />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <p>{disclaimer}</p>
          <p className="mt-3">
            <a href={staff} target="_blank" rel="noreferrer" className="text-casino-primary underline">
              Staff console
            </a>
          </p>
          <p className="mt-3">{copyright}</p>
        </div>
      </div>
    </footer>
  )
}

export default SiteFooter
