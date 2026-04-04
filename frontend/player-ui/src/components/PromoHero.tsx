import { useState, type FC } from 'react'
import { RequireAuthLink } from './RequireAuthLink'
import { IconChevronDown, IconChevronUp } from './icons'

const RAFFLE_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/ff84ae00-578c-4baa-91ea-961d23910749.jpg'
const ROULETTE_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/78459c2d-ac54-495b-8a00-86951fafafe0.jpg'
const VIP_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/2dca9e52-ef12-4d8c-9660-031082ff2696.jpg'

const tagClass =
  'inline-flex rounded-[4px] bg-casino-accent px-[7px] py-0.5 text-[9px] font-extrabold uppercase leading-tight text-white'

const promoTileClass =
  'relative z-0 flex min-h-[126px] items-center justify-between overflow-hidden rounded-casino-md bg-casino-surface px-4 py-3.5 transition-[transform,box-shadow] duration-300 ease-out hover:z-10 hover:scale-[1.025] hover:shadow-[0_12px_40px_rgba(0,0,0,0.35)] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:hover:shadow-none'

const PromoHero: FC = () => {
  const [tickets, setTickets] = useState(0)

  return (
    <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <article className={promoTileClass}>
        <div className="relative z-[2] flex max-w-[58%] flex-col items-start gap-2">
          <span className={tagClass}>1d 9h 35m</span>
          <h2 className="text-sm font-extrabold leading-tight text-casino-foreground">$25K Raffle</h2>
          <div className="text-[11px] leading-snug text-casino-muted">
            <span className="text-casino-foreground">Your tickets:</span>
            <div className="mt-1.5 flex items-center overflow-hidden rounded-[4px] bg-casino-elevated">
              <span className="px-2.5 py-1 text-xs font-semibold text-casino-foreground">{tickets}</span>
              <div className="flex flex-col border-l border-casino-border">
                <button
                  type="button"
                  className="flex h-2.5 w-[18px] items-center justify-center bg-casino-primary-dim text-casino-muted hover:text-casino-foreground"
                  aria-label="Increase tickets"
                  onClick={() => setTickets((n) => Math.min(99, n + 1))}
                >
                  <IconChevronUp size={10} aria-hidden />
                </button>
                <button
                  type="button"
                  className="flex h-2.5 w-[18px] items-center justify-center border-t border-casino-border bg-casino-primary-dim text-casino-muted hover:text-casino-foreground"
                  aria-label="Decrease tickets"
                  onClick={() => setTickets((n) => Math.max(0, n - 1))}
                >
                  <IconChevronDown size={10} aria-hidden />
                </button>
              </div>
            </div>
          </div>
          <RequireAuthLink
            to="/casino/games"
            className="mt-0.5 rounded-[4px] bg-casino-primary px-3.5 py-1.5 text-[11px] font-bold text-white hover:brightness-110"
          >
            Learn more
          </RequireAuthLink>
        </div>
        <img
          src={RAFFLE_IMG}
          alt=""
          className="absolute bottom-0 right-0 z-[1] h-full w-[118px] object-cover [mask-image:linear-gradient(to_right,transparent,black_34%)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_34%)]"
        />
      </article>

      <article className={promoTileClass}>
        <div className="relative z-[2] flex max-w-[58%] flex-col items-start gap-2">
          <span className={tagClass}>New Release</span>
          <h2 className="text-sm font-extrabold leading-tight text-casino-foreground">vybebet Roulette</h2>
          <p className="text-[11px] leading-snug text-casino-muted">
            Half the house edge of normal roulette!
          </p>
          <RequireAuthLink
            to="/casino/live"
            className="mt-0.5 rounded-[4px] bg-casino-primary px-3.5 py-1.5 text-[11px] font-bold text-white hover:brightness-110"
          >
            Play Now!
          </RequireAuthLink>
        </div>
        <img
          src={ROULETTE_IMG}
          alt=""
          className="absolute bottom-0 right-0 z-[1] h-full w-[118px] object-cover [mask-image:linear-gradient(to_right,transparent,black_34%)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_34%)]"
        />
      </article>

      <article className={promoTileClass}>
        <div className="relative z-[2] flex max-w-[58%] flex-col items-start gap-2">
          <span className={tagClass}>Rewards</span>
          <h2 className="text-sm font-extrabold leading-tight text-casino-foreground">Become a vybebet VIP</h2>
          <p className="text-[11px] leading-snug text-casino-muted">
            The worlds most lucrative VIP programme
          </p>
          <RequireAuthLink
            to="/profile"
            className="mt-0.5 rounded-[4px] bg-casino-primary px-3.5 py-1.5 text-[11px] font-bold text-white hover:brightness-110"
          >
            Claim
          </RequireAuthLink>
        </div>
        <img
          src={VIP_IMG}
          alt=""
          className="absolute bottom-0 right-0 z-[1] h-full w-[118px] object-cover [mask-image:linear-gradient(to_right,transparent,black_34%)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_34%)]"
        />
      </article>
    </div>
  )
}

export default PromoHero
