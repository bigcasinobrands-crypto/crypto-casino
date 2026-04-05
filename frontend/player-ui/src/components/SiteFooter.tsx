import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import AcceptedCurrenciesStrip from './AcceptedCurrenciesStrip'
import { adminAppHref } from '@repo/cross-app'
import { useState, type FC } from 'react'

const linkMuted = 'text-[10px] font-medium leading-snug text-casino-muted transition hover:text-casino-primary'
const colTitle = 'mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-casino-foreground'

const SiteFooter: FC = () => {
  const staff = adminAppHref(import.meta.env, '/login')
  const [seoOpen, setSeoOpen] = useState(false)

  return (
    <footer id="help" className="mt-auto border-t border-casino-border bg-casino-bg px-5 pb-8 pt-10 md:px-6">
      <div
        id="blog"
        className="relative mx-auto max-w-[1200px] scroll-mt-24 rounded-casino-md bg-casino-surface p-6"
      >
        <h2 className="mb-4 text-sm font-extrabold text-casino-foreground">
          Play Online Casino Games for Real Money at vybebet
        </h2>
        <div
          className={`grid gap-8 text-[11px] leading-relaxed text-casino-muted md:grid-cols-2 ${seoOpen ? '' : 'max-h-[220px] overflow-hidden'}`}
        >
          <div>
            <h3 className="mb-2.5 text-xs font-bold text-casino-foreground">
              The best online casino you will come across in 2026
            </h3>
            <p className="mb-3">
              vybebet is a fast-growing crypto casino built for players who want to play online casino games for real money
              using cryptocurrency. With thousands of games available, the platform delivers a complete real money crypto
              casino experience focused on performance, variety, and transparent gameplay.
            </p>
            <p>We support a wide range of immersive crypto casino games, including slots, table games, live dealers, and more.</p>
          </div>
          <div>
            <p className="mb-3">
              Shows include Crazy Time, Monopoly Live, Sweet Bonanza, and many more, offering dynamic gameplay for players
              looking for a unique crypto casino games experience.
            </p>
            <h3 className="mb-2.5 text-xs font-bold text-casino-foreground">Saga Games</h3>
            <p>
              vybebet features an exciting collection of games from top providers in the industry. These titles are designed
              to offer engaging mechanics and high-quality gameplay.
            </p>
          </div>
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
              <ul className="flex flex-col gap-1">
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/slots">
                  Slots
                </RequireAuthLink>
              </li>
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/bonus-buys">
                  Bonus Buys
                </RequireAuthLink>
              </li>
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/challenges">
                  Challenges
                </RequireAuthLink>
              </li>
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/favourites">
                  Favourites
                </RequireAuthLink>
              </li>
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/games#providers">
                  Providers
                </RequireAuthLink>
              </li>
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/live">
                  Live Casino
                </RequireAuthLink>
              </li>
            </ul>
          </div>
          <div className="flex flex-col lg:shrink-0">
            <div className={colTitle}>Originals</div>
            <ul className="flex flex-col gap-1">
              <li>
                <span className={linkMuted}>Blackjack</span>
              </li>
              <li>
                <span className={linkMuted}>Mines</span>
              </li>
              <li>
                <span className={linkMuted}>Dice</span>
              </li>
              <li>
                <span className={linkMuted}>Limbo</span>
              </li>
              <li>
                <span className={linkMuted}>Keno</span>
              </li>
            </ul>
          </div>
          <div className="flex flex-col lg:shrink-0">
            <div className={colTitle}>About Us</div>
            <ul className="flex flex-col gap-1">
              <li>
                <RequireAuthLink className={linkMuted} to="/profile">
                  VIP Program
                </RequireAuthLink>
              </li>
              <li>
                <span className={linkMuted}>Affiliate</span>
              </li>
              <li>
                <RequireAuthLink className={linkMuted} to="/casino/featured">
                  Rewards
                </RequireAuthLink>
              </li>
              <li>
                <span className={linkMuted}>Terms of Service</span>
              </li>
              <li>
                <span className={linkMuted}>Blog</span>
              </li>
              <li>
                <span className={linkMuted}>Fairness</span>
              </li>
            </ul>
          </div>
          <div className="flex flex-col lg:shrink-0">
            <div className={colTitle}>Communities</div>
            <ul className="flex flex-col gap-1">
              <li>
                <span className={linkMuted}>Discord</span>
              </li>
              <li>
                <span className={linkMuted}>Twitter / X</span>
              </li>
              <li>
                <span className={linkMuted}>Instagram</span>
              </li>
            </ul>
          </div>
          <div className="flex flex-col lg:shrink-0">
            <div className={colTitle}>Currencies</div>
            <ul className="flex flex-col gap-1">
              <li>
                <span className={linkMuted}>Solana</span>
              </li>
              <li>
                <span className={linkMuted}>Bitcoin</span>
              </li>
              <li>
                <span className={linkMuted}>Ethereum</span>
              </li>
              <li>
                <span className={linkMuted}>Litecoin</span>
              </li>
              <li>
                <span className={linkMuted}>Tether</span>
              </li>
              <li>
                <span className={linkMuted}>USDC</span>
              </li>
              <li>
                <span className={linkMuted}>Dogecoin</span>
              </li>
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
          <p>
            vybebet, crypto&apos;s best casino for real money slots, is a demonstration brand for Crypto Casino. Demo wallet
            uses USDT minor units.
          </p>
          <p className="mt-3">
            <a href={staff} target="_blank" rel="noreferrer" className="text-casino-primary underline">
              Staff console
            </a>
          </p>
          <p className="mt-3">18+ · Play responsibly.</p>
        </div>
      </div>
    </footer>
  )
}

export default SiteFooter
