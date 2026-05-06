import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { STUDIO_MARQUEE_LOGOS } from '../lib/studioMarqueeLogos'
import { useSiteContent } from '../hooks/useSiteContent'
import { contentImageUrl } from '../lib/contentImageUrl'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { IconBuilding2, IconChevronRight } from './icons'

const outlinedViewAllClass =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-white/[0.10] bg-casino-surface px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/92 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.18] hover:bg-casino-chip-hover hover:text-white active:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50'

function StudioMarqueeCard({
  src,
  label,
  providerQuery,
  forceWhiteFilter,
}: {
  src: string
  label: string
  providerQuery: string
  forceWhiteFilter: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    setImgFailed(false)
  }, [src])

  return (
    <Link
      to={`/casino/games?provider=${encodeURIComponent(providerQuery)}`}
      title={`${label} · filter catalog`}
      className="flex h-[52px] w-[148px] shrink-0 flex-col items-center justify-center rounded-[10px] border border-white/[0.09] bg-casino-surface px-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-casino-primary/40 sm:h-[58px] sm:w-[164px]"
    >
      {imgFailed ? (
        <span className="max-w-full truncate px-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-white/80">
          {label}
        </span>
      ) : (
        <img
          src={src}
          alt={label}
          draggable={false}
          className={`max-h-[26px] w-auto max-w-[140px] object-contain opacity-[0.94] sm:max-h-[28px] ${forceWhiteFilter ? 'brightness-0 invert' : ''}`}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      )}
    </Link>
  )
}

/**
 * Horizontal infinite marquee of partner studio marks — mirrors the crypto prices strip motion.
 */
export default function StudioMarqueeSection() {
  const reduceMotion = usePrefersReducedMotion()
  const { getContent } = useSiteContent()
  const cmsStudios = getContent<Array<{
    id: string
    label: string
    providerQuery: string
    src: string
    active?: boolean
    sortOrder?: number
  }> | null>('home_studios', null)
  const sourceLogos =
    Array.isArray(cmsStudios) && cmsStudios.length > 0
      ? cmsStudios
          .filter((item) => item.active !== false)
          .slice()
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((item) => ({
            id: item.id,
            label: item.label,
            providerQuery: item.providerQuery || item.label.toLowerCase().replace(/\s+/g, ''),
            src: contentImageUrl(item.src) ?? item.src,
            forceWhiteFilter: true,
          }))
      : [...STUDIO_MARQUEE_LOGOS]
  const loop = reduceMotion ? sourceLogos : [...sourceLogos, ...sourceLogos]

  return (
    <section className="mb-5" id="studios">
      <div className="mb-2 flex flex-nowrap items-center justify-between gap-2 sm:gap-2.5">
        <Link
          to="/casino/studios"
          className="group/prov flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-bold leading-tight tracking-tight text-white transition-colors duration-150 hover:text-white/95 sm:text-sm sm:font-extrabold"
        >
          <IconBuilding2 size={17} className="shrink-0 text-white/50 transition-colors group-hover/prov:text-casino-primary" aria-hidden />
          <span className="min-w-0">Studios</span>
          <IconChevronRight
            size={17}
            className="shrink-0 text-white/40 transition-colors group-hover/prov:text-casino-primary"
            aria-hidden
          />
        </Link>
        <Link to="/casino/studios" className={`${outlinedViewAllClass} shrink-0`}>
          VIEW ALL
        </Link>
      </div>

      <div
        className="relative -mx-0.5 overflow-hidden py-1"
        role="region"
        aria-label="Partner studios, scrolling"
      >
        <div
          className={
            reduceMotion
              ? 'flex flex-wrap justify-center gap-2'
              : 'infinite-marquee-track gap-2'
          }
        >
          {loop.map((logo, i) => (
            <StudioMarqueeCard
              key={`${logo.id}-${i}`}
              src={logo.src}
              label={logo.label}
              providerQuery={logo.providerQuery}
              forceWhiteFilter={logo.forceWhiteFilter}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
