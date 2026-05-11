import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { playerApiUrl } from '../../lib/playerApiUrl'
import { useSiteContent } from '../../hooks/useSiteContent'
import { IconBell, IconMessageSquare, IconSend, IconSettings } from '../icons'
import { PlayerHeaderWordmark } from '../PlayerHeaderLogo'

type Props = {
  maintenanceUntil: string | null | undefined
  supportEmail: string
  /** When true, MAINTENANCE_MODE env on the API overrides the admin DB toggle until unset + restart. */
  envMaintenanceLock?: boolean
}

function parseUntil(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export const MaintenanceScreen: FC<Props> = ({ maintenanceUntil, supportEmail, envMaintenanceLock }) => {
  const { getContent } = useSiteContent()
  const brandFooter = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'
  const target = useMemo(() => parseUntil(maintenanceUntil ?? null), [maintenanceUntil])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const { h, m, s } = useMemo(() => {
    if (!target) {
      return { h: 0, m: 0, s: 0 }
    }
    const ms = Math.max(0, target.getTime() - now)
    const totalSec = Math.floor(ms / 1000)
    const hh = Math.floor(totalSec / 3600)
    const mm = Math.floor((totalSec % 3600) / 60)
    const ss = totalSec % 60
    return { h: hh, m: mm, s: ss }
  }, [now, target])

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const onNotify = useCallback(async () => {
    const trimmed = email.trim()
    if (!trimmed || !trimmed.includes('@')) {
      toast.error('Enter your email so we can notify you.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(playerApiUrl('/v1/site/maintenance-notify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!res.ok) {
        toast.error(j?.error?.message ?? 'Could not subscribe. Try again later.')
        return
      }
      toast.success("You're on the list. We'll email you when we're live.")
      setEmail('')
    } catch {
      toast.error('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }, [email])

  const year = new Date().getFullYear()

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#07090f] px-4 py-8 text-casino-foreground antialiased sm:px-5 sm:py-12 lg:py-16">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0b0f1a] via-[#07090f] to-[#05060a]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.14),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_120%,rgba(15,23,42,0.88),transparent_65%)]"
        aria-hidden
      />

      <div className="pointer-events-none absolute left-5 top-6 z-10 sm:left-10 sm:top-10">
        <PlayerHeaderWordmark size="header" />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-[520px] rounded-2xl border border-casino-border bg-casino-surface px-5 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_rgba(0,0,0,0.45)] sm:max-w-[580px] sm:px-8 sm:py-10 lg:max-w-[640px] lg:px-10 lg:py-12">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-casino-chip shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-2 ring-casino-primary/35 sm:mb-6 sm:h-[72px] sm:w-[72px] lg:h-[84px] lg:w-[84px]">
          <IconSettings size={36} className="text-casino-primary" aria-hidden />
        </div>
        <h1 className="mb-3 text-xl font-bold text-casino-foreground sm:mb-4 sm:text-2xl lg:text-3xl">Scheduled Maintenance</h1>
        {envMaintenanceLock ? (
          <p className="mx-auto mb-4 max-w-[440px] rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-left text-xs leading-relaxed text-amber-100/95">
            This downtime is also enforced by the <strong className="font-semibold">MAINTENANCE_MODE</strong> server environment
            variable. Clearing the admin toggle alone may not reopen the site until that env flag is removed on the API host and
            the process is restarted.
          </p>
        ) : null}
        <p className="mx-auto mb-8 max-w-[440px] text-sm leading-relaxed text-casino-muted sm:mb-9 sm:text-base lg:max-w-[480px]">
          We are currently upgrading our platform to provide you with an even better gaming experience. All funds and
          accounts are safe. We&apos;ll be back online shortly.
        </p>

        {target ? (
          <>
            <div className="mb-8 flex flex-wrap items-center justify-center gap-2 sm:mb-9 sm:gap-3 lg:mb-10 lg:gap-4">
              <TimeBox value={h} label="Hours" />
              <span
                className="mb-[-12px] text-xl font-bold text-casino-muted sm:mb-[-14px] sm:text-2xl lg:mb-[-16px] lg:text-3xl"
                aria-hidden
              >
                :
              </span>
              <TimeBox value={m} label="Minutes" />
              <span
                className="mb-[-12px] text-xl font-bold text-casino-muted sm:mb-[-14px] sm:text-2xl lg:mb-[-16px] lg:text-3xl"
                aria-hidden
              >
                :
              </span>
              <TimeBox value={s} label="Seconds" />
            </div>
            {h === 0 && m === 0 && s === 0 ? (
              <p className="mb-6 text-sm text-casino-muted">
                The scheduled window has ended. Access should return shortly — try refreshing this page.
              </p>
            ) : null}
          </>
        ) : (
          <div className="mb-8 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-center sm:mb-9 lg:mb-10">
            <p className="text-sm leading-relaxed text-casino-muted">
              No maintenance end time is configured yet, so there is no countdown — only this notice updates live.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-casino-muted/90">
              Ask your operator to set <strong className="text-casino-foreground/90">Maintenance schedule</strong> in admin so players see a real ETA.
            </p>
          </div>
        )}

        <label htmlFor="maint-notify-email" className="sr-only">
          Email for notification when live
        </label>
        <input
          id="maint-notify-email"
          type="email"
          autoComplete="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full max-w-sm rounded-lg border border-casino-border bg-casino-chip px-4 py-3 text-center text-sm text-casino-foreground outline-none ring-casino-primary/40 placeholder:text-casino-muted focus:border-casino-primary/35 focus:ring-2"
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => void onNotify()}
          className="mx-auto flex h-11 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-casino-primary to-casino-primary-dim px-6 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_16px_rgba(123,97,255,0.22)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:gap-2.5 sm:px-8 sm:text-base"
        >
          <IconBell size={18} aria-hidden />
          Notify Me When Live
        </button>

        <div className="mt-8 flex justify-center gap-4">
          <RoundSocial icon={<IconSend size={18} />} label="Telegram" href={import.meta.env.VITE_BRAND_TELEGRAM_URL as string | undefined} />
          <RoundSocial
            icon={<IconMessageSquare size={18} />}
            label="Support chat"
            href={import.meta.env.VITE_SUPPORT_URL as string | undefined}
          />
          <RoundSocial
            icon={<span className="text-xs font-bold">✉</span>}
            label="Email support"
            href={`mailto:${supportEmail}`}
          />
        </div>
      </main>

      <p className="pointer-events-none absolute bottom-6 z-10 text-xs text-casino-muted sm:bottom-8 sm:text-sm lg:bottom-10">
        © {year} {brandFooter}. All rights reserved.
      </p>
    </div>
  )
}

function TimeBox({ value, label }: { value: number; label: string }) {
  const text = String(value).padStart(2, '0')
  return (
    <div className="flex h-[76px] w-[76px] flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:h-[92px] sm:w-[92px] sm:gap-2 lg:h-[110px] lg:w-[110px]">
      <span
        className="bg-gradient-to-r from-casino-primary to-casino-accent bg-clip-text text-[28px] font-bold leading-none text-transparent sm:text-[34px] lg:text-[40px]"
        aria-live="polite"
      >
        {text}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-casino-muted sm:text-xs">{label}</span>
    </div>
  )
}

function RoundSocial({
  icon,
  label,
  href,
}: {
  icon: ReactNode
  label: string
  href?: string
}) {
  const url = typeof href === 'string' ? href.trim() : ''
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] bg-casino-chip text-casino-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:text-casino-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50"
    >
      {icon}
    </a>
  )
}
