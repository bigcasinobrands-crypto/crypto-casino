import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import { useWalletDisplayFiat } from '../hooks/useWalletDisplayFiat'
import type { WalletDisplayFiat } from '../lib/walletDisplayFiat'
import { IconBanknote, IconChevronDown } from './icons'
import type { WalletMainTab } from './WalletFlowModal'
import {
  PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT,
  PLAYER_CHROME_CLOSE_REWARDS_EVENT,
  PLAYER_CHROME_CLOSE_WALLET_EVENT,
} from '../lib/playerChromeEvents'
import { WalletInfoTrigger } from './wallet/WalletShell'

type HeaderWalletBarProps = {
  onOpenWallet: (tab: WalletMainTab) => void
  /** From operational health — hide/disable deposit entry when false */
  depositsEnabled?: boolean
  /** Wallet modal showing Deposit tab — highlights header Deposit (tablet/iPad). */
  depositFlowActive?: boolean
}

/** Space to leave under the dropdown so it does not sit under the mobile bottom nav (hidden → small gap only). */
function walletDropdownBottomReservePx(): number {
  if (typeof document === 'undefined') return 12
  try {
    const nav = document.querySelector('.casino-shell-mobile-nav') as HTMLElement | null
    if (!nav) return 12
    const cs = getComputedStyle(nav)
    if (cs.display === 'none' || cs.visibility === 'hidden') return 12
    const br = nav.getBoundingClientRect()
    if (br.height <= 0) return 12
    return Math.round(br.height + 10)
  } catch {
    return 12
  }
}

const HeaderWalletBar: FC<HeaderWalletBarProps> = ({ onOpenWallet, depositsEnabled = true, depositFlowActive = false }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const { pathname } = useLocation()
  const onDepositRoute = pathname.startsWith('/wallet/deposit')
  const depositNavActive = onDepositRoute || depositFlowActive
  const { isAuthenticated, balanceMinor, balanceBreakdown, playableBalanceCurrency } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  const settlementCcy = (playableBalanceCurrency || 'EUR').trim().toUpperCase() || 'EUR'
  const { displayFiat, setDisplayFiat, displayOptions, formatMinor } = useWalletDisplayFiat(
    isAuthenticated ? settlementCcy : 'EUR',
  )

  const balancePending = isAuthenticated && balanceMinor === null

  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  /** Viewport <1280: centered dropdown. ≥1280 (desktop shell): position under wallet pill. */
  const [panelPos, setPanelPos] = useState<
    | { top: number; mobileCentered: true }
    | { top: number; left: number }
    | null
  >(null)
  const [panelMaxHeightPx, setPanelMaxHeightPx] = useState(() =>
    typeof window !== 'undefined' ? Math.round(Math.min(window.innerHeight * 0.85, 520)) : 520,
  )
  const [barRect, setBarRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  const recalcPos = useCallback(() => {
    if (!barRef.current) return
    const r = barRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const gutter = 12
    /** Match `casino-shell.css`: tablet/mobile headers &lt;1280; desktop sidebar + header ≥1280. */
    const useViewportCenteredPanel = vw < 1280

    setBarRect({ top: r.top, left: r.left, width: r.width, height: r.height })

    const vh = window.innerHeight
    const panelTopGap = useViewportCenteredPanel ? 8 : 6
    const panelTopPx = r.bottom + panelTopGap
    const bottomReserve = walletDropdownBottomReservePx()
    setPanelMaxHeightPx(Math.max(240, Math.min(vh * 0.62, vh - panelTopPx - bottomReserve)))

    if (useViewportCenteredPanel) {
      setPanelPos({ top: panelTopPx, mobileCentered: true })
      return
    }

    /** Desktop shell (≥1280): align under wallet pill — 50% viewport center is wrong with fixed sidebar. */
    const panelW = Math.min(340, vw - 2 * gutter)
    const cx = r.left + r.width / 2
    let left = cx - panelW / 2
    left = Math.max(gutter, Math.min(left, vw - panelW - gutter))
    setPanelPos({ top: panelTopPx, left })
  }, [])

  useEffect(() => {
    if (!open) return
    recalcPos()
    window.addEventListener('resize', recalcPos)
    return () => window.removeEventListener('resize', recalcPos)
  }, [open, recalcPos])

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(PLAYER_CHROME_CLOSE_WALLET_EVENT, close)
    return () => window.removeEventListener(PLAYER_CHROME_CLOSE_WALLET_EVENT, close)
  }, [])

  useEffect(() => {
    if (open) {
      window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_REWARDS_EVENT))
      window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT))
    }
  }, [open])

  const onDeposit = () => {
    if (!isAuthenticated) {
      openAuth('login', { walletTab: 'deposit' })
      return
    }
    if (!depositsEnabled) return
    setOpen(false)
    onOpenWallet('deposit')
  }

  const depositDisabled = isAuthenticated && !depositsEnabled

  /** API `balance_minor` is playable total (cash + bonus) — pill shows this combined total. */
  const pillAmountStr: string | null = !isAuthenticated
    ? formatMinor(0, locale)
    : balancePending
      ? null
      : formatMinor(balanceMinor!, locale)

  const bonusMinor = balanceBreakdown?.bonusLockedMinor ?? 0
  const wagerMinor = balanceBreakdown?.wageringRemainingMinor ?? 0
  const cashMinorLedger =
    typeof balanceBreakdown?.cashMinor === 'number'
      ? balanceBreakdown.cashMinor
      : isAuthenticated && balanceMinor != null
        ? Math.max(0, balanceMinor - bonusMinor)
        : null

  const cashAmountStr =
    cashMinorLedger != null && !balancePending ? formatMinor(cashMinorLedger, locale) : null
  const bonusAmountStr =
    !balancePending && isAuthenticated ? formatMinor(bonusMinor, locale) : null
  const wagerAmountStr =
    !balancePending && isAuthenticated ? formatMinor(wagerMinor, locale) : null
  const showBonusSubtitle = isAuthenticated && !balancePending && bonusMinor > 0
  /** Overall wallet balance zero — show perimeter pulse on every breakpoint. */
  const showZeroBalanceAlert = isAuthenticated && !balancePending && balanceMinor === 0

  /**
   * Balance control sits inside the fused header pill on md+ (no second border — avoids “pill in pill”).
   * Mobile keeps a self-contained rounded control when the deposit CTA stacks separately.
   */
  const chipInnerClosed =
    'relative z-[1] flex min-h-8 min-w-0 w-auto max-w-full flex-1 items-stretch md:min-h-9 md:min-w-0 md:self-stretch max-[767px]:overflow-visible max-[1279px]:md:min-w-0 min-[1280px]:max-w-[min(17rem,calc(100vw-14rem))]'

  const walletBarCore = (
    <button
      type="button"
      disabled={!isAuthenticated}
      onClick={() => setOpen((p) => !p)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t('wallet.headerBalanceDetailAria')}
      aria-busy={balancePending}
      className="group flex min-h-8 min-w-0 w-auto max-w-full flex-1 items-stretch overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.04] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition hover:border-white/[0.14] hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-casino-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-casino-bg disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9 md:rounded-none md:border-0 md:bg-transparent md:shadow-none md:hover:bg-white/[0.06] md:overflow-visible max-[1279px]:md:flex-1 min-[1280px]:md:flex-none min-[1280px]:md:max-w-[min(17rem,calc(100vw-14rem))]"
    >
      <div className="flex min-w-0 min-h-0 flex-1 flex-col justify-center gap-0.5 overflow-visible px-3 py-2 md:gap-1 md:pl-4 md:pr-2 md:py-2.5">
        <div className="flex min-w-0 items-baseline gap-2 md:gap-2.5">
          <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums text-white md:text-xs min-[1280px]:text-[13px]">
            {balancePending ? (
              <span
                className="inline-block h-[1.1em] min-w-[4.25rem] max-w-[6.5rem] animate-pulse rounded bg-white/[0.14]"
                aria-hidden
              />
            ) : (
              pillAmountStr
            )}
          </span>
          <span
            className="shrink-0 whitespace-nowrap pl-0 text-[10px] font-bold tracking-wide text-white/40 md:text-[11px] md:pl-0"
            aria-hidden
          >
            {displayFiat}
          </span>
        </div>
        {showBonusSubtitle ? (
          <span className="max-w-full truncate text-[8px] tabular-nums text-amber-200/80 md:text-[9px] lg:text-[10px]">
            {t('wallet.headerBonusSubtitle', { amount: bonusAmountStr ?? '' })}
          </span>
        ) : null}
      </div>
      <div
        className="flex w-8 shrink-0 flex-col items-center justify-center border-l border-white/[0.12] bg-black/15 px-1 md:w-9 md:border-white/[0.08] md:bg-transparent"
        aria-hidden
      >
        <IconChevronDown
          className={`size-3.5 shrink-0 text-white/45 transition group-hover:text-white/65 md:size-4 ${open ? 'rotate-180' : ''}`}
          size={16}
        />
      </div>
    </button>
  )

  const depositButton = (
    <button
      type="button"
      disabled={depositDisabled}
      onClick={onDeposit}
      title={
        depositDisabled
          ? t('operational.depositsUnavailable')
          : t('header.deposit')
      }
      aria-label={depositDisabled ? t('operational.depositsUnavailable') : t('header.depositAriaLabel')}
      aria-current={depositNavActive ? 'page' : undefined}
      className={`inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-center text-[11px] font-bold leading-tight text-white antialiased transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 md:h-full md:min-h-0 md:w-auto md:min-w-0 md:rounded-none md:rounded-r-full md:border-0 md:border-l md:border-white/10 md:px-3.5 md:py-0 md:text-xs md:font-bold md:leading-tight md:shadow-none max-[1279px]:md:px-3 max-[1000px]:min-[768px]:md:w-8 max-[1000px]:min-[768px]:md:min-w-8 max-[1000px]:min-[768px]:md:max-w-8 max-[1000px]:min-[768px]:md:border-l-0 max-[1000px]:min-[768px]:md:px-0 min-[1280px]:md:w-max min-[1280px]:md:px-4 min-[1280px]:md:py-0 min-[1280px]:md:text-xs bg-casino-primary md:bg-[#9b6cff] max-[1000px]:min-[768px]:md:justify-center ${
        depositDisabled ? 'cursor-not-allowed opacity-40 hover:brightness-100' : ''
      } ${
        depositNavActive
          ? 'ring-2 ring-casino-primary/55 shadow-[0_0_12px_rgba(123,97,255,0.38)] md:ring-0 md:shadow-none md:brightness-[1.05]'
          : ''
      }`}
    >
      <IconBanknote size={15} className="hidden shrink-0 max-[1000px]:min-[768px]:md:inline min-[1001px]:md:hidden" aria-hidden />
      <span className="max-[1000px]:min-[768px]:md:sr-only min-[1001px]:md:inline">{t('header.deposit')}</span>
    </button>
  )

  const walletDepositWrap = (
    <div className="hidden shrink-0 md:flex md:h-auto md:min-h-0 md:w-auto md:items-stretch md:self-stretch md:overflow-hidden md:rounded-r-full">
      {depositButton}
    </div>
  )

  const walletPillInnerSurface =
    'relative z-[1] flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-2 max-[767px]:gap-2 max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(28rem,100%)] md:flex-row md:items-stretch md:justify-start md:gap-0 md:overflow-hidden md:rounded-full md:border md:border-white/[0.1] md:bg-[#141414] md:py-0 md:pl-0 md:pr-0 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] max-[1279px]:md:w-full max-[1279px]:md:min-w-0 min-[1280px]:w-max min-[1280px]:max-w-[min(22rem,calc(100vw-14rem))] min-[1280px]:justify-start'

  /** Nested inside `.wallet-chip-zero-ring`: margin reveals the 2px gutter for the rotating beam. */
  const walletPillInnerSurfaceZeroInset = `${walletPillInnerSurface} m-[2px] max-md:rounded-[calc(0.75rem-2px)]`

  const walletPillOuterFrame =
    'pointer-events-auto relative inline-flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-2 max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(28rem,100%)] md:flex-row md:items-stretch md:justify-start md:gap-0 md:overflow-hidden md:rounded-full md:border md:border-white/[0.1] md:bg-[#141414] md:py-0 md:pl-0 md:pr-0 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] max-[1279px]:md:w-full max-[1279px]:md:min-w-0 min-[1280px]:w-max min-[1280px]:max-w-[min(22rem,calc(100vw-14rem))] min-[1280px]:justify-start'

  return (
    <>
      {showZeroBalanceAlert ? (
        <div
          ref={barRef}
          className="pointer-events-auto relative inline-flex min-w-0 w-full max-w-full flex-col items-center justify-center overflow-hidden rounded-xl wallet-chip-zero-ring max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(28rem,100%)] md:rounded-full max-[1279px]:md:w-full max-[1279px]:md:min-w-0 min-[1280px]:w-max min-[1280px]:max-w-[min(22rem,calc(100vw-14rem))]"
        >
          <span className="wallet-chip-zero-ring__beam pointer-events-none" aria-hidden />
          <div className={walletPillInnerSurfaceZeroInset}>
            <div className={chipInnerClosed}>{walletBarCore}</div>
            {walletDepositWrap}
          </div>
        </div>
      ) : (
        <div ref={barRef} className={walletPillOuterFrame}>
          <div className={chipInnerClosed}>{walletBarCore}</div>
          {walletDepositWrap}
        </div>
      )}

      {open && panelPos && createPortal(
        <>
          <div
            className="fixed z-[199] bg-black/40 backdrop-blur-sm max-[767px]:left-0 max-[767px]:right-0 max-[767px]:top-[calc(64px+env(safe-area-inset-top,0px))] max-[767px]:bottom-[var(--casino-mobile-nav-offset)] min-[768px]:max-[1279px]:left-0 min-[768px]:max-[1279px]:right-0 min-[768px]:max-[1279px]:bottom-0 min-[768px]:max-[1279px]:top-[calc(var(--casino-header-h-tablet)+env(safe-area-inset-top,0px))] min-[1280px]:inset-0"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {barRect && (
            <div
              style={{ position: 'fixed', top: barRect.top, left: barRect.left, width: barRect.width, height: barRect.height, zIndex: 218 }}
              className={
                showZeroBalanceAlert
                  ? 'relative box-border inline-flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl wallet-chip-zero-ring md:rounded-full'
                  : `${walletPillOuterFrame} box-border h-full min-h-0 w-full min-w-0 shrink-0`
              }
            >
              {showZeroBalanceAlert ? (
                <>
                  <span className="wallet-chip-zero-ring__beam pointer-events-none" aria-hidden />
                  <div className={`${walletPillInnerSurfaceZeroInset} min-h-0 flex-1`}>
                    <div className={chipInnerClosed}>{walletBarCore}</div>
                    {walletDepositWrap}
                  </div>
                </>
              ) : (
                <>
                  <div className={chipInnerClosed}>{walletBarCore}</div>
                  {walletDepositWrap}
                </>
              )}
            </div>
          )}

          <div
            role="dialog"
            aria-label={t('wallet.headerBalanceDetailAria')}
            style={{
              ...('mobileCentered' in panelPos
                ? { top: panelPos.top, left: '50%', transform: 'translateX(-50%)' }
                : { top: panelPos.top, left: panelPos.left, transform: 'none', right: 'auto' }),
              maxHeight: panelMaxHeightPx,
            }}
            className={`fixed z-[219] flex flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#0e0e11] shadow-[0_24px_48px_rgba(0,0,0,0.55)] ${
              'mobileCentered' in panelPos
                ? 'w-[min(21rem,calc(100vw-1.5rem))]'
                : 'w-[min(23rem,calc(100vw-2rem))]'
            }`}
          >
            <div className="shrink-0 px-3 pt-3 pb-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
                {t('wallet.displayCurrencyLabel')}
              </p>
              <div className="mt-2 flex border-b border-white/[0.08]" role="group" aria-label={t('wallet.displayCurrencyLabel')}>
                {displayOptions.map((code: WalletDisplayFiat) => {
                  const on = displayFiat === code
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setDisplayFiat(code)}
                      aria-pressed={on}
                      className={`relative flex-1 py-2.5 text-center text-xs font-bold transition ${
                        on ? 'text-white' : 'text-white/45 hover:text-white/75'
                      }`}
                    >
                      {on ? (
                        <span
                          className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-casino-primary shadow-[0_0_12px_rgba(139,92,246,0.6)]"
                          aria-hidden
                        />
                      ) : null}
                      {code}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scrollbar-casino">
              <div className="px-4 pt-4 pb-3">
                <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-transparent px-4 py-4">
                  <p className="text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                    {t('wallet.headerCashBalanceTitle')}
                  </p>
                  <p className="mt-2 text-center text-[1.65rem] font-bold tabular-nums tracking-tight text-white leading-none">
                    {balancePending || cashAmountStr == null ? (
                      <span
                        className="inline-block h-[1.35em] w-[7rem] max-w-[85%] animate-pulse rounded-lg bg-white/[0.12]"
                        aria-hidden
                      />
                    ) : (
                      cashAmountStr
                    )}
                  </p>
                </div>

                <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3.5">
                  <p className="text-center text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200/80">
                    {t('wallet.headerBonusBalanceTitle')}
                  </p>
                  <p className="mt-1.5 text-center text-lg font-bold tabular-nums text-amber-100">
                    {balancePending || bonusAmountStr == null ? (
                      <span
                        className="inline-block h-[1.15em] w-[5rem] max-w-[75%] animate-pulse rounded-lg bg-amber-200/20"
                        aria-hidden
                      />
                    ) : (
                      bonusAmountStr
                    )}
                  </p>
                </div>

                <div className="mt-3 rounded-2xl border border-sky-400/25 bg-sky-500/[0.07] px-4 py-3.5">
                  <p className="flex items-center justify-center gap-1 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-sky-200/85">
                    <span>{t('wallet.headerWagerBalanceTitle')}</span>
                    <WalletInfoTrigger
                      label={t('wallet.headerWagerBalanceTooltip')}
                      title={t('wallet.headerWagerBalanceTooltip')}
                    />
                  </p>
                  <p className="mt-1.5 text-center text-lg font-bold tabular-nums text-sky-100">
                    {balancePending || wagerAmountStr == null ? (
                      <span
                        className="inline-block h-[1.15em] w-[5rem] max-w-[75%] animate-pulse rounded-lg bg-sky-200/20"
                        aria-hidden
                      />
                    ) : (
                      wagerAmountStr
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-white/[0.08] bg-black/25 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5">
              <button
                type="button"
                onClick={onDeposit}
                disabled={depositDisabled}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-casino-primary py-2.5 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconBanknote size={16} aria-hidden />
                {t('header.deposit')}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

export default HeaderWalletBar
