import type { FC } from 'react'
import { IconHexagon } from '../icons'

type Props = {
  supportEmail: string
}

/** Full-screen gate when security.ip_whitelist / ip_blacklist denies the client (mirrors server barrier). */
export const IpRestrictedScreen: FC<Props> = ({ supportEmail }) => {
  const year = new Date().getFullYear()

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#111115] px-4 py-10 text-white antialiased">
      <div className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-[20px] bg-[#09080a] px-8 py-10 shadow-[0_24px_64px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.03)]">
        <header className="mb-6 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <IconHexagon size={28} className="text-amber-500" aria-hidden />
          <span>VybeBet</span>
        </header>

        <h1 className="mb-4 text-2xl font-bold leading-snug tracking-tight">Access restricted</h1>
        <p className="mb-6 text-sm leading-relaxed text-zinc-400">
          Connections from this network are not permitted. If you believe this is a mistake, contact{' '}
          <a className="font-medium text-white underline underline-offset-[3px]" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
          .
        </p>
        <p className="text-xs text-zinc-500">
          © {year} VybeBet. Access rules are enforced on the server — refreshing or editing the page locally cannot bypass this
          restriction.
        </p>
      </div>
    </div>
  )
}
