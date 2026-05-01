import { useEffect, useMemo, useRef, useState } from 'react'
import { bonusHeroImageSrc } from '../rewards/offerDisplayUtils'
import {
  normalizeVipLoyaltyHero,
  VIP_LOYALTY_HERO_FALLBACK,
  VIP_LOYALTY_HERO_SITE_KEY,
  type VipLoyaltyHeroSlide,
  type VipLoyaltyHeroPayload,
} from '../../lib/vipLoyaltyHero'
import { useSiteContent } from '../../hooks/useSiteContent'

function slideImageSrc(s: VipLoyaltyHeroSlide): string | undefined {
  if (s.image_url.trim() === '') return undefined
  return bonusHeroImageSrc(s.image_url) ?? s.image_url
}

export function VipLoyaltyHeroBanner() {
  const { getContent, refreshSiteContent } = useSiteContent()
  const heroRefreshThrottle = useRef(0)

  /** Fresh bundle when opening VIP so admin saves show up without waiting on the SPA cache TTL. */
  useEffect(() => {
    void refreshSiteContent()

    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const n = Date.now()
      if (n - heroRefreshThrottle.current < 9000) return
      heroRefreshThrottle.current = n
      void refreshSiteContent()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refreshSiteContent])

  const config: VipLoyaltyHeroPayload = useMemo(() => {
    const raw = getContent<unknown>(VIP_LOYALTY_HERO_SITE_KEY, null)
    if (raw == null) return VIP_LOYALTY_HERO_FALLBACK
    return normalizeVipLoyaltyHero(raw)
  }, [getContent])

  const slides = config.slides.length > 0 ? config.slides : VIP_LOYALTY_HERO_FALLBACK.slides
  const [idx, setIdx] = useState(0)
  const intervalMs = Math.max(3000, Math.min(120_000, Math.round(config.slide_interval_sec * 1000)))

  useEffect(() => {
    setIdx(0)
  }, [slides.length, intervalMs])

  useEffect(() => {
    if (slides.length <= 1) return
    const t = window.setInterval(() => {
      setIdx((i) => (i + 1) % slides.length)
    }, intervalMs)
    return () => window.clearInterval(t)
  }, [slides.length, intervalMs])

  const slide = slides[idx] ?? slides[0]

  /** Match height of neighbouring VIP tier progress card on large screens (`lg:min-h-[232px]` + stretched row). */
  return (
    <div className="flex min-h-[232px] flex-col gap-3 lg:h-full lg:min-h-0">
      <article className="relative isolate flex min-h-[180px] flex-1 overflow-hidden rounded-2xl border border-white/10 bg-casino-surface">
        {/* Cross-fade backgrounds (each slide is its own layer so opacity can animate). */}
        <div aria-hidden className="absolute inset-0">
          {slides.map((s, i) => {
            const img = slideImageSrc(s)
            const active = i === idx
            return (
              <div
                key={i}
                className={`absolute inset-0 transition-opacity duration-[600ms] ease-out ${
                  active ? 'z-[1] opacity-100' : 'pointer-events-none z-0 opacity-0'
                }`}
              >
                {img ? (
                  <img
                    src={img}
                    alt=""
                    className="pointer-events-none h-full w-full object-cover object-center"
                    decoding={i <= 2 ? 'async' : 'auto'}
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-r from-amber-400/35 via-fuchsia-500/15 to-purple-950/40" />
                )}
              </div>
            )
          })}
        </div>

        {(slide.headline || slide.description) && (
          <div
            key={idx}
            className="relative z-[2] flex h-full flex-col justify-center px-6 py-6 transition-opacity duration-500 ease-out"
          >
            {slide.headline ? (
              <h2 className="m-0 text-3xl font-black uppercase leading-none tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,.55)] sm:text-4xl">
                {slide.headline}
              </h2>
            ) : null}
            {slide.description ? (
              <p className="mt-3 max-w-[52ch] text-sm font-semibold text-white drop-shadow-[0_1px_10px_rgba(0,0,0,.5)]">
                {slide.description}
              </p>
            ) : null}
          </div>
        )}
      </article>

      {slides.length > 1 ? (
        <div
          className="flex shrink-0 flex-wrap gap-2 px-0.5 pb-1"
          role="tablist"
          aria-label="Loyalty hero slides"
        >
          {slides.map((_, i) => {
            const selected = i === idx
            return (
              <button
                key={`dot-${i}`}
                type="button"
                role="tab"
                aria-selected={selected}
                title={`Slide ${i + 1}`}
                className={`h-2 rounded-full transition-[width,background-color,transform] duration-500 ease-out ${
                  selected ? 'w-7 scale-y-105 bg-white' : 'w-2 scale-100 bg-white/40 hover:bg-white/65'
                }`}
                onClick={() => setIdx(i)}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
