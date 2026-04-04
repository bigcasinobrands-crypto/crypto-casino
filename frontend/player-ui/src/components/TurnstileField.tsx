import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void }) => string
    }
  }
}

const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim()

type Props = {
  onToken: (token: string | null) => void
}

/** Cloudflare Turnstile when `VITE_TURNSTILE_SITE_KEY` is set (must match server `TURNSTILE_SECRET`). */
export function TurnstileField({ onToken }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onToken)

  useEffect(() => {
    cb.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!siteKey) {
      cb.current(null)
      return
    }

    const mount = () => {
      if (!host.current || !window.turnstile) return
      window.turnstile.render(host.current, {
        sitekey: siteKey,
        callback: (t) => cb.current(t),
      })
    }

    if (window.turnstile) {
      mount()
      return
    }

    let s = document.getElementById('cf-turnstile-api') as HTMLScriptElement | null
    if (!s) {
      s = document.createElement('script')
      s.id = 'cf-turnstile-api'
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.defer = true
      s.onload = () => mount()
      document.head.appendChild(s)
    } else if (window.turnstile) {
      mount()
    } else {
      s.addEventListener('load', mount, { once: true })
    }
  }, [])

  if (!siteKey) return null

  return <div ref={host} className="min-h-[65px]" />
}
