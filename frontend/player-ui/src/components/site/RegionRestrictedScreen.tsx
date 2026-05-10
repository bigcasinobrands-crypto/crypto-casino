import type { FC } from 'react'
import { IconHexagon } from '../icons'

type Props = {
  countryCode: string
  supportEmail: string
}

export const RegionRestrictedScreen: FC<Props> = ({ countryCode, supportEmail }) => {
  const iso = countryCode.trim().toUpperCase()
  const regionLabel =
    iso.length === 2
      ? new Intl.DisplayNames(['en'], { type: 'region' }).of(iso) ?? iso.toLowerCase()
      : 'your region'

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#111115] px-4 py-10 text-white antialiased">
      <div className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-[20px] bg-[#09080a] shadow-[0_24px_64px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.03)]">
        <header className="relative z-10 flex items-center justify-between px-8 pb-0 pt-6">
          <div className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white">
            <IconHexagon size={28} className="text-rose-500" aria-hidden />
            <span>VybeBet</span>
          </div>
        </header>

        <div className="relative z-10 px-8 pb-0 pt-8">
          <h1 className="mb-5 text-4xl font-bold leading-[1.15] tracking-tight">
            Feel free to check us out again when you travel!
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-zinc-400">
            We currently do not support connections from{' '}
            <span className="font-medium text-white">{regionLabel}</span>. Contact us via live chat in the bottom
            right corner or{' '}
            <a className="font-medium text-white underline underline-offset-[3px]" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
            .
          </p>
        </div>

        <div className="relative z-10 mt-4 flex h-[280px] flex-col items-center justify-end overflow-hidden">
          <div
            className="pointer-events-none absolute bottom-[60px] left-1/2 z-[1] h-[200px] w-[150%] -translate-x-1/2 opacity-90"
            style={{
              background:
                'radial-gradient(ellipse at bottom, rgba(244,63,94,0.8) 0%, rgba(244,63,94,0.4) 40%, transparent 75%)',
            }}
            aria-hidden
          />
          <div className="absolute bottom-[-120px] z-[2] h-[600px] w-[600px] overflow-hidden rounded-full border-t border-rose-500/30 bg-[#070608] shadow-[inset_0_60px_100px_-20px_rgba(0,0,0,0.9)]">
            <div
              className="h-full w-full opacity-[0.14]"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), transparent 55%), radial-gradient(circle at 70% 60%, rgba(244,63,94,0.2), transparent 50%)',
                mixBlendMode: 'screen',
                filter: 'grayscale(100%) contrast(150%)',
              }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-transparent via-black/80 to-black"
              aria-hidden
            />
          </div>

          <div className="relative z-10 w-full pb-10 text-center">
            <h2 className="mb-5 text-lg font-bold tracking-tight text-white">Let&apos;s be in touch</h2>
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
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-rose-500 shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400/70"
    >
      <span className="sr-only">{label}</span>
      <span className="text-xs font-bold" aria-hidden>
        {label[0]}
      </span>
    </a>
  )
}
