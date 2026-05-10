import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSiteContent } from '../../hooks/useSiteContent'

type Props = {
  countryCode: string
  /** Server-supplied display name (e.g. ipdata.co when IPDATA_API_KEY is set on core). */
  countryName?: string
  supportEmail: string
}

const WORDMARK_SRC = `${import.meta.env.BASE_URL}vybebet-logo.svg`

export const RegionRestrictedScreen: FC<Props> = ({ countryCode, countryName = '', supportEmail }) => {
  const { i18n } = useTranslation()
  const { getContent } = useSiteContent()
  const siteLabel = (getContent<string>('branding.site_name', '') ?? '').trim() || 'VybeBet'

  const iso = countryCode.trim().toUpperCase()
  const locale = (i18n.resolvedLanguage || i18n.language || 'en').replace(/_/g, '-')

  const regionLabel = useMemo(() => {
    const fromIpdata = countryName.trim()
    if (fromIpdata) return fromIpdata
    if (iso.length === 2) {
      try {
        return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(iso) ?? iso
      } catch {
        return iso
      }
    }
    return 'your region'
  }, [countryName, iso, locale])

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10 text-white antialiased">
      <div className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/[0.07] bg-black/75 shadow-[0_24px_80px_rgba(0,0,0,0.55),0_0_0_1px_color-mix(in_srgb,var(--color-casino-primary)_22%,transparent)] backdrop-blur-xl supports-[backdrop-filter]:bg-black/60">
        <header className="relative z-10 px-8 pb-0 pt-7">
          <div className="flex items-center gap-3">
            <img src={WORDMARK_SRC} width={148} height={40} className="h-9 w-auto object-contain object-left" alt={siteLabel} />
          </div>
        </header>

        <div className="relative z-10 px-8 pb-0 pt-7">
          <h1 className="mb-5 text-3xl font-bold leading-[1.18] tracking-tight text-white sm:text-4xl">
            Feel free to check us out again when you travel!
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-zinc-300">
            We currently do not support connections from{' '}
            <span className="font-semibold text-white">{regionLabel}</span>. Contact us via live chat in the bottom
            right corner or{' '}
            <a className="font-semibold text-[var(--color-casino-primary)] underline underline-offset-[3px]" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
            .
          </p>
          <p className="mb-2 text-xs leading-relaxed text-zinc-500">
            Regional rules are enforced on the server for every API request — bypassing this screen in the browser does not restore
            access to games or wallet features.
          </p>
        </div>

        <div className="relative z-10 mt-2 flex min-h-[260px] flex-col items-center justify-end overflow-hidden pb-2 pt-6">
          <div
            className="pointer-events-none absolute bottom-[52px] left-1/2 z-[1] h-[220px] w-[160%] -translate-x-1/2 opacity-95"
            style={{
              background:
                'radial-gradient(ellipse at bottom, color-mix(in srgb, var(--color-casino-primary) 65%, transparent) 0%, color-mix(in srgb, var(--color-casino-primary-dim) 35%, transparent) 42%, transparent 72%)',
            }}
            aria-hidden
          />
          <div className="absolute bottom-[-116px] z-[2] h-[560px] w-[560px] overflow-hidden rounded-full border-t border-[color-mix(in_srgb,var(--color-casino-primary)_38%,transparent)] bg-[#060508] shadow-[inset_0_60px_100px_-20px_rgba(0,0,0,0.92)]">
            <div
              className="h-full w-full opacity-[0.12]"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 30% 28%, rgba(255,255,255,0.2), transparent 52%), radial-gradient(circle at 72% 58%, color-mix(in srgb, var(--color-casino-primary) 45%, transparent), transparent 48%)',
                mixBlendMode: 'screen',
                filter: 'grayscale(100%) contrast(155%)',
              }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-transparent via-black/82 to-black"
              aria-hidden
            />
          </div>

          <div className="relative z-10 w-full px-8 pb-9 pt-4 text-center">
            <h2 className="mb-5 text-base font-bold tracking-tight text-white">Let&apos;s be in touch</h2>
            <div className="flex items-center justify-center gap-3">
              <SocialCircle label="Facebook" href={import.meta.env.VITE_BRAND_FACEBOOK_URL as string | undefined} />
              <SocialCircle label="X" href={import.meta.env.VITE_BRAND_X_URL as string | undefined} />
              <SocialCircle label="Instagram" href={import.meta.env.VITE_BRAND_INSTAGRAM_URL as string | undefined} />
              <SocialCircle label="LinkedIn" href={import.meta.env.VITE_BRAND_LINKEDIN_URL as string | undefined} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SocialCircle({ label, href }: { label: string; href?: string }) {
  const url = typeof href === 'string' ? href.trim() : ''
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--color-casino-primary)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-casino-primary)_55%,transparent)]"
    >
      <span className="sr-only">{label}</span>
      <span className="text-xs font-bold" aria-hidden>
        {label[0]}
      </span>
    </a>
  )
}
