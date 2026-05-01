/** site_content key — flat bundle key (no dots) for useSiteContent. */
export const VIP_LOYALTY_HERO_SITE_KEY = 'vip_loyalty_hero'

export type VipLoyaltyHeroSlide = {
  image_url: string
  headline: string
  description: string
}

export type VipLoyaltyHeroPayload = {
  slide_interval_sec: number
  slides: VipLoyaltyHeroSlide[]
}

export const VIP_LOYALTY_HERO_FALLBACK: VipLoyaltyHeroPayload = {
  slide_interval_sec: 8,
  slides: [
    {
      image_url: '',
      headline: 'New Loyalty Program',
      description: '10 statuses & new perks to reach',
    },
  ],
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x)
}

/** Normalizes CMS JSON for the VIP / Rewards loyalty hero carousel. */
export function normalizeVipLoyaltyHero(raw: unknown): VipLoyaltyHeroPayload {
  const base = VIP_LOYALTY_HERO_FALLBACK
  if (!isRecord(raw)) return { ...base, slides: base.slides.map((s) => ({ ...s })) }

  const interval = clamp(
    typeof raw.slide_interval_sec === 'number' ? raw.slide_interval_sec : Number(raw.slide_interval_sec),
    3,
    120,
  )

  const slidesIn = raw.slides
  const outSlides: VipLoyaltyHeroSlide[] = []
  if (Array.isArray(slidesIn)) {
    for (const item of slidesIn) {
      if (!isRecord(item)) continue
      outSlides.push({
        image_url: typeof item.image_url === 'string' ? item.image_url.trim() : '',
        headline: typeof item.headline === 'string' ? item.headline : '',
        description: typeof item.description === 'string' ? item.description : '',
      })
    }
  }

  if (outSlides.length === 0) {
    return { slide_interval_sec: interval, slides: base.slides.map((s) => ({ ...s })) }
  }
  if (outSlides.length > 12) outSlides.length = 12

  return { slide_interval_sec: interval, slides: outSlides }
}
