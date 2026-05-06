import { useState, useMemo, useEffect, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp } from './icons'
import { useSiteContent } from '../hooks/useSiteContent'
import { contentImageUrl } from '../lib/contentImageUrl'

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

type HeroSlideSettings = {
  autoplay_enabled?: boolean
  autoplay_ms?: number
}

const RAFFLE_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/ff84ae00-578c-4baa-91ea-961d23910749.jpg'
const ROULETTE_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/78459c2d-ac54-495b-8a00-86951fafafe0.jpg'
const VIP_IMG =
  'https://storage.googleapis.com/banani-generated-images/generated-images/2dca9e52-ef12-4d8c-9660-031082ff2696.jpg'

const tagClass =
  'inline-flex rounded-[4px] bg-casino-accent px-[7px] py-0.5 text-[9px] font-extrabold uppercase leading-tight text-white'

const promoTileClass =
  'casino-promo-card relative z-0 flex items-center justify-between overflow-hidden rounded-casino-md bg-casino-surface px-3 py-3 transition-[transform,box-shadow] duration-300 ease-out hover:z-10 hover:scale-[1.01] hover:shadow-[0_8px_22px_rgba(0,0,0,0.22)] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:hover:shadow-none sm:px-4 sm:py-3.5'

const RaffleTicketWidget: FC = () => {
  const { t } = useTranslation()
  const [tickets, setTickets] = useState(0)
  return (
    <div className="text-[11px] leading-snug text-casino-muted">
      <span className="text-casino-foreground">{t('lobby.hero.yourTickets')}</span>
      <div className="mt-1.5 inline-flex items-stretch overflow-hidden rounded-[4px] bg-casino-elevated">
        <span className="flex min-w-[34px] items-center justify-center px-2 py-1 text-xs font-semibold text-casino-foreground">{tickets}</span>
        <div className="flex w-[18px] flex-col border-l border-casino-border">
          <button
            type="button"
            className="flex h-[11px] w-full items-center justify-center bg-casino-primary-dim text-casino-muted transition-colors hover:text-casino-foreground"
            aria-label={t('lobby.hero.increaseTickets')}
            onClick={() => setTickets((n) => Math.min(99, n + 1))}
          >
            <IconChevronUp size={10} aria-hidden />
          </button>
          <button
            type="button"
            className="flex h-[11px] w-full items-center justify-center border-t border-casino-border bg-casino-primary-dim text-casino-muted transition-colors hover:text-casino-foreground"
            aria-label={t('lobby.hero.decreaseTickets')}
            onClick={() => setTickets((n) => Math.max(0, n - 1))}
          >
            <IconChevronDown size={10} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}

const SlideCard: FC<{ slide: HeroSlide; fallbackImage: string }> = ({ slide, fallbackImage }) => {
  const primarySrc = contentImageUrl(slide.image_url)
  const [resolvedSrc, setResolvedSrc] = useState(fallbackImage)
  const hasTextContent =
    Boolean(slide.tag?.trim()) ||
    Boolean(slide.title?.trim()) ||
    Boolean(slide.subtitle?.trim()) ||
    slide.interactive === 'raffle_tickets' ||
    (Boolean(slide.cta_label?.trim()) && Boolean(slide.cta_link?.trim()))

  useEffect(() => {
    if (!primarySrc) {
      setResolvedSrc(fallbackImage)
      return
    }
    let cancelled = false
    const preloader = new Image()
    preloader.onload = () => {
      if (!cancelled) setResolvedSrc(primarySrc)
    }
    preloader.onerror = () => {
      if (!cancelled) setResolvedSrc(fallbackImage)
    }
    preloader.src = primarySrc
    return () => {
      cancelled = true
    }
  }, [primarySrc, fallbackImage])

  return (
    <article className={promoTileClass}>
      <img
        src={resolvedSrc}
        alt=""
        className="absolute inset-0 z-[1] h-full w-full object-cover"
      />
      {hasTextContent ? (
        <>
          <div className="absolute inset-0 z-[2] bg-gradient-to-r from-black/80 via-black/62 to-black/40" />
          <div className="relative z-[3] flex max-w-[62%] flex-col items-start gap-1.5 sm:max-w-[58%] sm:gap-2">
            {slide.tag && <span className={tagClass}>{slide.tag}</span>}
            {slide.title ? (
              <h2 className="text-sm font-extrabold leading-tight text-casino-foreground">
                {slide.title}
              </h2>
            ) : null}
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
        </>
      ) : null}
    </article>
  )
}

const PromoHero: FC = () => {
  const { t } = useTranslation()
  const { getContent } = useSiteContent()
  const [promoStart, setPromoStart] = useState(0)
  const fallbackSlides = useMemo(
    (): HeroSlide[] => [
      {
        enabled: true,
        tag: t('lobby.hero.sampleCountdown'),
        title: t('lobby.hero.raffleTitle'),
        cta_label: t('lobby.hero.learnMore'),
        cta_link: '/casino/games#raffle',
        image_url: RAFFLE_IMG,
        interactive: 'raffle_tickets',
      },
      {
        enabled: true,
        tag: t('lobby.hero.newReleaseTag'),
        title: t('lobby.hero.rouletteTitle'),
        subtitle: t('lobby.hero.rouletteSubtitle'),
        cta_label: t('lobby.hero.playNow'),
        cta_link: '/casino/live',
        image_url: ROULETTE_IMG,
      },
      {
        enabled: true,
        tag: t('lobby.hero.rewardsTag'),
        title: t('lobby.hero.vipTitle'),
        subtitle: t('lobby.hero.vipSubtitle'),
        cta_label: t('lobby.hero.exploreVip'),
        cta_link: '/vip',
        image_url: VIP_IMG,
      },
    ],
    [t],
  )

  const cmsSlides = getContent<HeroSlide[] | undefined>('hero_slides', undefined)
  const hasCmsSlides = Array.isArray(cmsSlides) && cmsSlides.length > 0

  const slides = useMemo(() => {
    const raw = hasCmsSlides ? (cmsSlides as HeroSlide[]) : fallbackSlides
    return raw.filter((s) => s.enabled !== false)
  }, [hasCmsSlides, cmsSlides, fallbackSlides])

  if (slides.length === 0) return null

  const heroSettings = getContent<HeroSlideSettings | undefined>('hero_slides_settings')
  const autoplayEnabled = heroSettings?.autoplay_enabled !== false
  const autoplayMsRaw = Number(heroSettings?.autoplay_ms ?? 5000)
  const autoplayMs = Number.isFinite(autoplayMsRaw)
    ? Math.max(1500, Math.min(30000, Math.round(autoplayMsRaw)))
    : 5000

  const raffleIndex = slides.findIndex((slide) => slide.interactive === 'raffle_tickets')
  const fixedIndex = raffleIndex >= 0 ? raffleIndex : 0
  const fixedSlide = slides[fixedIndex]
  const promoSlides = slides.filter((_, index) => index !== fixedIndex)
  const canRotate = promoSlides.length > 2
  const visiblePromoCount = Math.min(2, promoSlides.length)
  const visiblePromos =
    visiblePromoCount === 0
      ? []
      : Array.from({ length: visiblePromoCount }, (_, slot) => {
          const idx = (promoStart + slot) % promoSlides.length
          return promoSlides[idx]
        })

  const stepPromo = (direction: 1 | -1) => {
    if (!canRotate) return
    setPromoStart((prev) => {
      const next = prev + direction
      const mod = ((next % promoSlides.length) + promoSlides.length) % promoSlides.length
      return mod
    })
  }

  useEffect(() => {
    if (!canRotate || !autoplayEnabled) return
    const id = window.setInterval(() => {
      setPromoStart((prev) => (prev + 1) % promoSlides.length)
    }, autoplayMs)
    return () => window.clearInterval(id)
  }, [canRotate, autoplayEnabled, autoplayMs, promoSlides.length])

  return (
    <div className="casino-promo-banners relative mb-3 md:grid-cols-3">
      <SlideCard
        key={`fixed-${fixedIndex}`}
        slide={fixedSlide}
        fallbackImage={fixedIndex === 0 ? RAFFLE_IMG : fixedIndex === 1 ? ROULETTE_IMG : VIP_IMG}
      />

      <div
        className={`group relative md:col-span-2 ${visiblePromoCount <= 1 ? 'grid grid-cols-1' : 'grid grid-cols-1 gap-3 md:grid-cols-2'}`}
      >
        {visiblePromos.map((slide, i) => (
          <SlideCard
            key={`${slide.title ?? 'promo'}-${promoStart}-${i}`}
            slide={slide}
            fallbackImage={VIP_IMG}
          />
        ))}

        {canRotate && visiblePromoCount > 1 ? (
          <div className="pointer-events-none absolute inset-x-3 top-1/2 z-[20] hidden -translate-y-1/2 justify-between opacity-0 transition-all duration-300 md:flex md:group-hover:opacity-100">
            <button
              type="button"
              onClick={() => stepPromo(-1)}
              aria-label="Show previous promo tile"
              className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/90 backdrop-blur transition hover:bg-black/50"
            >
              <IconChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => stepPromo(1)}
              aria-label="Show next promo tile"
              className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/90 backdrop-blur transition hover:bg-black/50"
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PromoHero
