import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { adminAppHref } from '@repo/cross-app'
import { useState, type FC } from 'react'

const linkMuted = 'text-[11px] font-medium text-casino-muted transition hover:text-casino-primary'

const currencies = [
  { code: 'SOL', name: 'Solana' },
  { code: 'BTC', name: 'Bitcoin' },
  { code: 'USDT', name: 'Tether' },
  { code: 'USDC', name: 'USDC' },
  { code: 'ETH', name: 'Ethereum' },
  { code: 'DOGE', name: 'Dogecoin' },
  { code: 'XRP', name: 'Ripple' },
  { code: 'LTC', name: 'Litecoin' },
]

const SiteFooter: FC = () => {
  const staff = adminAppHref(import.meta.env, '/login')
  const [seoOpen, setSeoOpen] = useState(false)

  return (
    <footer id="help" className="mt-auto border-t border-casino-border bg-casino-bg px-5 pb-8 pt-10 md:px-6">
      <div className="relative mx-auto max-w-[1200px] rounded-casino-md bg-casino-surface p-6">
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
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-[76px_1fr_1fr_1fr_1fr_1fr] lg:items-start lg:gap-8">
          <div className="col-span-2 flex justify-center sm:col-span-1 lg:col-span-1 lg:justify-start">
            <Link
              to="/casino/games"
              className="flex shrink-0 items-center rounded-casino-md outline-none ring-casino-primary/0 transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-casino-primary"
            >
              <img
                src="/vybebet-logo.svg"
                alt="vybebet"
                width={200}
                height={46}
                className="h-10 w-auto max-w-[min(100%,160px)] object-contain sm:h-11 sm:max-w-[180px]"
                decoding="async"
              />
            </Link>
          </div>
          <div>
            <div className="mb-3.5 text-[11px] font-extrabold uppercase text-casino-foreground">Games</div>
            <ul className="flex flex-col gap-2.5">
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
                <RequireAuthLink className={linkMuted} to="/casino/featured">
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
          <div>
            <div className="mb-3.5 text-[11px] font-extrabold uppercase text-casino-foreground">Originals</div>
            <ul className="flex flex-col gap-2.5">
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
          <div>
            <div className="mb-3.5 text-[11px] font-extrabold uppercase text-casino-foreground">About Us</div>
            <ul className="flex flex-col gap-2.5">
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
          <div>
            <div className="mb-3.5 text-[11px] font-extrabold uppercase text-casino-foreground">Communities</div>
            <ul className="flex flex-col gap-2.5">
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
          <div>
            <div className="mb-3.5 text-[11px] font-extrabold uppercase text-casino-foreground">Currencies</div>
            <ul className="flex flex-col gap-2.5">
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
        </div>

        <div>
          <div className="mb-3 text-[11px] font-extrabold text-casino-foreground">Accepted Currencies</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-8">
            {currencies.map((c) => (
              <div
                key={c.code}
                className="flex flex-col items-center gap-2 rounded-[4px] bg-casino-surface px-2.5 py-3.5 text-center"
              >
                <div
                  className="flex size-[22px] items-center justify-center rounded-full bg-casino-primary text-xs font-semibold text-white"
                  aria-hidden
                >
                  {c.code.slice(0, 1)}
                </div>
                <div className="text-[11px] font-bold text-casino-foreground">{c.code}</div>
                <div className="text-[10px] text-casino-muted">{c.name}</div>
              </div>
            ))}
          </div>
        </div>

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
