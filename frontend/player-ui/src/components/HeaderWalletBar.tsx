import type { FC } from 'react'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import { IconChevronDown } from './icons'
import type { WalletMainTab } from './WalletFlowModal'

type HeaderWalletBarProps = {
  onOpenWallet: (tab: WalletMainTab) => void
}

/** Display balance as USDT with 2 decimals (minor units ÷ 100, matches demo deposit amounts). */
function formatBalance(minor: number | null): string {
  if (minor == null) return '0.00'
  return (minor / 100).toFixed(2)
}

const HeaderWalletBar: FC<HeaderWalletBarProps> = ({ onOpenWallet }) => {
  const { accessToken, balanceMinor } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  const onDeposit = () => {
    if (!accessToken) {
      openAuth('login', { walletTab: 'deposit' })
      return
    }
    onOpenWallet('deposit')
  }

  return (
    <div className="mx-auto flex w-full max-w-md min-w-0 items-center justify-center">
      <div className="flex min-w-0 max-w-full items-center gap-0 overflow-hidden rounded-lg border border-casino-border bg-casino-surface pl-3 shadow-sm">
        <span className="shrink-0 text-sm font-semibold tabular-nums text-white">
          {formatBalance(accessToken ? balanceMinor : 0)}
        </span>
        <span
          className="ml-2 flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white"
          aria-hidden
        >
          $
        </span>
        <div className="relative ml-1 shrink-0">
          <select
            aria-label="Display currency"
            disabled={!accessToken}
            className="h-8 cursor-pointer appearance-none rounded-md border-0 bg-transparent py-0 pl-2 pr-7 text-xs font-medium text-casino-muted outline-none focus:ring-1 focus:ring-casino-primary disabled:cursor-not-allowed disabled:opacity-50"
            defaultValue="USDT"
          >
            <option value="USDT">USDT</option>
          </select>
          <IconChevronDown
            className="pointer-events-none absolute right-1 top-1/2 size-3.5 -translate-y-1/2 text-casino-muted"
            size={14}
            aria-hidden
          />
        </div>
        <div className="mx-1 hidden h-6 w-px shrink-0 bg-casino-border sm:block" aria-hidden />
        <button
          type="button"
          onClick={onDeposit}
          className="shrink-0 bg-gradient-to-b from-casino-primary to-casino-primary-dim px-4 py-2.5 text-sm font-bold text-white shadow-inner shadow-casino-primary/20 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary"
        >
          Deposit
        </button>
      </div>
    </div>
  )
}

export default HeaderWalletBar
