import { useState, useMemo, type FC } from 'react'
import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { IconChevronDown, IconChevronUp } from './icons'
import { useSiteContent } from '../hooks/useSiteContent'

type HeroSlide = {
  enabled?: boolean
  tag?: string
  title?: string
  subtitle?: string
  cta_label?: string
  cta_link?: string
  image_url?: string
  interactive?: 'raffle_tickets' | null
}

const RAFFLE_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/ff84ae00-578c-4baa-91ea-961d23910749.jpg'
const ROULETTE_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/78459c2d-ac54-495b-8a00-86951fafafe0.jpg'
const VIP_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/2dca9e52-ef12-4d8c-9660-031082ff2696.jpg'

const FALLBACK_SLIDES: HeroSlide[] = [
  {
    enabled: true,
    tag: '1d 9h 35m',
    title: '$25K Raffle',
    cta_label: 'Learn more',
    cta_link: '/casino/games#raffle',
    image_url: RAFFLE_IMG,
    interactive: 'raffle_tickets',
  },
  {
    enabled: true,
    tag: 'New Release',
    title: 'vybebet Roulette',
    subtitle: 'Half the house edge of normal roulette!',
    cta_label: 'Play Now!',
    cta_link: '/casino/live',
    image_url: ROULETTE_IMG,
  },
  {
    enabled: true,
    tag: 'Rewards',
    title: 'Become a vybebet VIP',
    subtitle: 'The worlds most lucrative VIP programme',
    cta_label: 'Explore VIP',
    cta_link: '/vip',
    image_url: VIP_IMG,
  },
]

const tagClass =
  'inline-flex rounded-[4px] bg-casino-accent px-[7px] py-0.5 text-[9px] font-extrabold uppercase leading-tight text-white'

const promoTileClass =
  'casino-promo-card relative z-0 flex items-center justify-between overflow-hidden rounded-casino-md bg-casino-surface px-3 py-3 transition-[transform,box-shadow] duration-300 ease-out hover:z-10 hover:scale-[1.025] hover:shadow-[0_12px_40px_rgba(0,0,0,0.35)] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:hover:shadow-none sm:px-4 sm:py-3.5'

const RaffleTicketWidget: FC = () => {
  const [tickets, setTickets] = useState(0)
  return (
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
  )
}

const SlideCard: FC<{ slide: HeroSlide }> = ({ slide }) => (
  <article className={promoTileClass}>
    <div className="relative z-[2] flex max-w-[62%] flex-col items-start gap-1.5 sm:max-w-[58%] sm:gap-2">
      {slide.tag && <span className={tagClass}>{slide.tag}</span>}
      <h2 className="text-sm font-extrabold leading-tight text-casino-foreground">
        {slide.title}
      </h2>
      {slide.interactive === 'raffle_tickets' ? (
        <RaffleTicketWidget />
      ) : slide.subtitle ? (
        <p className="text-[11px] leading-snug text-casino-muted">{slide.subtitle}</p>
      ) : null}
      {slide.cta_label && slide.cta_link && (
        slide.cta_link === '/vip' ? (
          <Link
            to={slide.cta_link}
            className="mt-0.5 inline-flex rounded-[4px] bg-casino-primary px-3.5 py-1.5 text-[11px] font-bold text-white hover:brightness-110"
          >
            {slide.cta_label}
          </Link>
        ) : (
          <RequireAuthLink
            to={slide.cta_link}
            className="mt-0.5 rounded-[4px] bg-casino-primary px-3.5 py-1.5 text-[11px] font-bold text-white hover:brightness-110"
          >
            {slide.cta_label}
          </RequireAuthLink>
        )
      )}
    </div>
    {slide.image_url && (
      <img
        src={slide.image_url}
        alt=""
        className="absolute bottom-0 right-0 z-[1] h-full w-[88px] object-cover [mask-image:linear-gradient(to_right,transparent,black_34%)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_34%)] sm:w-[118px]"
      />
    )}
  </article>
)

const PromoHero: FC = () => {
  const { getContent } = useSiteContent()
  const slides = useMemo(() => {
    const cms = getContent<HeroSlide[] | undefined>('hero_slides')
    const raw = Array.isArray(cms) && cms.length > 0 ? cms : FALLBACK_SLIDES
    return raw.filter((s) => s.enabled !== false)
  }, [getContent])

  if (slides.length === 0) return null

  return (
    <div className="casino-promo-banners mb-3">
      {slides.map((slide, i) => (
        <SlideCard key={slide.title ?? i} slide={slide} />
      ))}
    </div>
  )
}

export default PromoHero
