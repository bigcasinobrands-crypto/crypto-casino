import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { playerApiUrl } from '../../lib/playerApiUrl'
import { IconBell, IconHexagon, IconMessageSquare, IconSend, IconSettings } from '../icons'

type Props = {
  maintenanceUntil: string | null | undefined
  supportEmail: string
}

function parseUntil(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export const MaintenanceScreen: FC<Props> = ({ maintenanceUntil, supportEmail }) => {
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
      toast.success("You're on the list — we'll email you when we're live.")
      setEmail('')
    } catch {
      toast.error('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }, [email])

  const year = new Date().getFullYear()

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#0a0910] px-5 py-16 text-white antialiased">
      {/* Decorative washes — no backdrop-filter blur */}
      <div
        className="pointer-events-none absolute left-[-300px] top-[-300px] z-0 h-[800px] w-[800px] rounded-full bg-[#9b4dff] opacity-[0.12]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-[-200px] right-[-100px] z-0 h-[600px] w-[600px] rounded-full bg-[#7b2cff] opacity-[0.10]"
        aria-hidden
      />

      <div className="pointer-events-none absolute left-10 top-10 z-10 flex items-center gap-3 text-[28px] font-extrabold tracking-wide max-[520px]:left-5 max-[520px]:top-6">
        <IconHexagon size={32} className="text-[#9b4dff]" aria-hidden />
        <span>VybeBet</span>
      </div>

      <main className="relative z-10 mx-auto w-full max-w-[640px] rounded-2xl border border-white/[0.06] bg-[#1c1924] px-10 py-14 text-center shadow-[0_32px_64px_rgba(0,0,0,0.6)] max-sm:px-6 max-sm:py-10">
        <div className="mx-auto mb-6 flex h-[88px] w-[88px] items-center justify-center rounded-full border border-[#9b4dff]/20 bg-[#9b4dff]/10 text-[#9b4dff]">
          <IconSettings size={40} aria-hidden />
        </div>
        <h1 className="mb-4 text-3xl font-bold text-white">Scheduled Maintenance</h1>
        <p className="mx-auto mb-10 max-w-[480px] text-base leading-relaxed text-[#8e86a8]">
          We are currently upgrading our platform to provide you with an even better gaming experience. All funds and
          accounts are safe. We&apos;ll be back online shortly.
        </p>

        <div className="mb-10 flex flex-wrap items-center justify-center gap-4">
          <TimeBox value={h} label="Hours" />
          <span className="mb-[-16px] text-3xl font-bold text-[#8e86a8]" aria-hidden>
            :
          </span>
          <TimeBox value={m} label="Minutes" />
          <span className="mb-[-16px] text-3xl font-bold text-[#8e86a8]" aria-hidden>
            :
          </span>
          <TimeBox value={s} label="Seconds" />
        </div>
        {!target ? (
          <p className="mb-6 text-sm text-[#8e86a8]">End time not scheduled — we&apos;ll enable access from here soon.</p>
        ) : null}

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
          className="mb-4 w-full max-w-sm rounded-lg border border-white/[0.06] bg-[#231f2d] px-4 py-3 text-center text-sm text-white outline-none ring-violet-500/40 placeholder:text-[#8e86a8]/70 focus:border-violet-500/35 focus:ring-2"
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => void onNotify()}
          className="mx-auto flex h-12 items-center justify-center gap-2.5 rounded-lg bg-gradient-to-r from-[#9b4dff] to-[#7b2cff] px-8 text-base font-semibold text-white shadow-[0_4px_16px_rgba(155,77,255,0.25)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
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

      <p className="pointer-events-none absolute bottom-10 z-10 text-sm text-[#8e86a8] max-sm:bottom-6">
        © {year} VybeBet. All rights reserved.
      </p>
    </div>
  )
}

function TimeBox({ value, label }: { value: number; label: string }) {
  const text = String(value).padStart(2, '0')
  return (
    <div className="flex h-[110px] w-[110px] flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-[#19171e] shadow-[0_8px_24px_rgba(0,0,0,0.2)] max-[420px]:h-[92px] max-[420px]:w-[92px]">
      <span
        className="bg-gradient-to-r from-[#9b4dff] to-[#7b2cff] bg-clip-text text-[40px] font-bold leading-none text-transparent max-[420px]:text-[32px]"
        aria-live="polite"
      >
        {text}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wider text-[#8e86a8]">{label}</span>
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
      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] bg-[#19171e] text-[#8e86a8] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400/70"
    >
      {icon}
    </a>
  )
}
