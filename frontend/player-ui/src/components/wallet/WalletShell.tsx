import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  IconBitcoin,
  IconBanknote,
  IconChevronDown,
  IconCircleDollarSign,
  IconCopy,
  IconInfo,
  IconSearch,
  IconX,
} from '../icons'

/** Wallet modal chrome — theme tokens in index.css (aligned with casino surfaces / purple CTAs). */

export function WalletModalCard({
  children,
  className = '',
  role,
  'aria-labelledby': ariaLabelledBy,
  'aria-modal': ariaModal,
}: {
  children: ReactNode
  className?: string
  role?: string
  'aria-labelledby'?: string
  'aria-modal'?: boolean | 'true' | 'false'
}) {
  return (
    <div
      role={role}
      aria-labelledby={ariaLabelledBy}
      aria-modal={ariaModal}
      className={`relative w-full max-w-[440px] rounded-2xl border border-casino-border bg-wallet-modal p-6 shadow-[0_32px_64px_rgba(0,0,0,0.55)] ${className}`}
    >
      {children}
    </div>
  )
}

export function WalletCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-casino-border text-casino-muted transition hover:border-white/25 hover:text-white"
    >
      <IconX size={16} aria-hidden />
    </button>
  )
}

export type WalletMainTabId = 'deposit' | 'withdraw'

export function WalletMainTabs({
  active,
  onChange,
  depositLabel,
  withdrawLabel,
  depositDisabled,
  withdrawDisabled,
  depositHint,
  withdrawHint,
}: {
  active: WalletMainTabId
  onChange: (t: WalletMainTabId) => void
  depositLabel: string
  withdrawLabel: string
  depositDisabled?: boolean
  withdrawDisabled?: boolean
  depositHint?: string
  withdrawHint?: string
}) {
  return (
    <div
      className="mb-6 flex rounded-[10px] bg-casino-segment-track p-1 ring-1 ring-white/[0.06]"
      role="tablist"
      aria-label="Wallet"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'deposit'}
        disabled={depositDisabled}
        title={depositDisabled ? depositHint : undefined}
        onClick={() => onChange('deposit')}
        className={`flex-1 rounded-lg py-2.5 text-center text-sm font-semibold transition ${
          depositDisabled ? 'cursor-not-allowed opacity-40 text-casino-muted' : ''
        } ${
          active === 'deposit'
            ? 'bg-casino-primary/25 text-white ring-1 ring-casino-primary/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
            : 'text-casino-muted hover:text-white/85'
        }`}
      >
        {depositLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'withdraw'}
        disabled={withdrawDisabled}
        title={withdrawDisabled ? withdrawHint : undefined}
        onClick={() => onChange('withdraw')}
        className={`flex-1 rounded-lg py-2.5 text-center text-sm font-semibold transition ${
          withdrawDisabled ? 'cursor-not-allowed opacity-40 text-casino-muted' : ''
        } ${
          active === 'withdraw'
            ? 'bg-casino-primary/25 text-white ring-1 ring-casino-primary/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
            : 'text-casino-muted hover:text-white/85'
        }`}
      >
        {withdrawLabel}
      </button>
    </div>
  )
}

export type WalletRailId = 'crypto' | 'banking'

export function WalletRailTabs({
  active,
  onChange,
  cryptoLabel,
  bankingLabel,
}: {
  active: WalletRailId
  onChange: (r: WalletRailId) => void
  cryptoLabel: string
  bankingLabel: string
}) {
  return (
    <div className="mb-5 flex gap-6 border-b border-white/[0.05]" role="tablist" aria-label="Payment method">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'crypto'}
        onClick={() => onChange('crypto')}
        className={`relative flex items-center gap-1.5 pb-3 text-sm font-semibold transition ${
          active === 'crypto' ? 'text-white after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-wallet-accent' : 'text-wallet-subtext hover:text-white/85'
        }`}
      >
        <IconBitcoin size={16} className={active === 'crypto' ? 'text-amber-400' : 'text-wallet-subtext'} aria-hidden />
        {cryptoLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'banking'}
        onClick={() => onChange('banking')}
        className={`relative flex items-center gap-1.5 pb-3 text-sm font-semibold transition ${
          active === 'banking' ? 'text-white after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-wallet-accent' : 'text-wallet-subtext hover:text-white/85'
        }`}
      >
        <IconBanknote size={16} aria-hidden />
        {bankingLabel}
      </button>
    </div>
  )
}

export function WalletPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-wallet-panel p-5 ${className}`}>{children}</div>
}

export function WalletFieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-2 block text-xs text-casino-muted">{children}</span>
}

type MenuPos = { left: number; width: number; maxH: number; top?: number; bottom?: number }

/** Fallback until the search row is measured. */
const WALLET_SELECT_MENU_SEARCH_H_FALLBACK = 64

/** Reserve space above the fixed mobile bottom nav so listboxes don't extend under it (see casino-shell.css). */
function walletSelectBottomReservePx(): number {
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

function clampWalletSelectMenuHorizontal(left: number, width: number, edgePad = 12): { left: number; width: number } {
  if (typeof window === 'undefined') return { left, width }
  const vw = window.innerWidth
  let L = left
  let W = width
  if (L < edgePad) {
    W -= edgePad - L
    L = edgePad
  }
  if (L + W > vw - edgePad) {
    L = Math.max(edgePad, vw - edgePad - W)
  }
  return { left: L, width: Math.max(200, W) }
}

export type WalletSelectOption = { value: string; label: string; icon?: ReactNode; summaryLabel?: string }

export type WalletSelectGroup = { groupId: string; heading: string; options: WalletSelectOption[] }

/**
 * Wallet-themed dropdown. Avoids invisible native `<select>` overlays — on Windows/Chrome those
 * open the OS picker (huge white panel, wrong theme, flip-up inside modals).
 */
export function WalletNativeSelectRow({
  label,
  value,
  onChange,
  options = [],
  optionGroups,
  icon,
  menuLiftScopeRef,
  onMenuLiftPxChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** Flat list (used when `optionGroups` is empty or omitted). */
  options?: WalletSelectOption[]
  /** When non-empty, list is grouped by chain with sticky section headings. */
  optionGroups?: WalletSelectGroup[]
  /** Fallback when the selected option has no `icon` */
  icon?: ReactNode
  /**
   * Wallet sheet / dialog ref — when the menu opens on small screens, we translate this node up so
   * a downward listbox gains viewport space (shortfall ≈ preferred height minus space below trigger).
   */
  menuLiftScopeRef?: RefObject<HTMLElement | null>
  /** Receives lift in px to apply as `translateY(-lift)` on `menuLiftScopeRef` (0 when menu closes). */
  onMenuLiftPxChange?: (px: number) => void
}) {
  const { t } = useTranslation()
  const id = `wallet-select-${label.replace(/\s+/g, '-')}`
  const listId = `${id}-listbox`
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [menuPos, setMenuPos] = useState<MenuPos>({ left: 0, width: 0, maxH: 280 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const blockRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchHeaderRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchHeaderPx, setSearchHeaderPx] = useState(WALLET_SELECT_MENU_SEARCH_H_FALLBACK)
  const [inlineMobileMenu, setInlineMobileMenu] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639.98px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)')
    const apply = () => setInlineMobileMenu(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const flatOptions = useMemo(() => {
    if (optionGroups != null && optionGroups.length > 0) return optionGroups.flatMap((g) => g.options)
    return options
  }, [optionGroups, options])
  const useGroups = optionGroups != null && optionGroups.length > 0

  const visibleGroups = useMemo(() => {
    if (!useGroups || !optionGroups) return null
    const q = searchQuery.trim().toLowerCase()
    const match = (o: WalletSelectOption, section: string | null) => {
      if (!q) return true
      const blob = [o.label, o.summaryLabel ?? '', o.value, section ?? ''].join(' ').toLowerCase()
      return blob.includes(q)
    }
    return optionGroups
      .map((g) => ({ ...g, options: g.options.filter((o) => match(o, g.heading)) }))
      .filter((g) => g.options.length > 0)
  }, [useGroups, optionGroups, searchQuery])

  const visibleFlat = useMemo(() => {
    if (useGroups) return []
    const q = searchQuery.trim().toLowerCase()
    const match = (o: WalletSelectOption) => {
      if (!q) return true
      const blob = [o.label, o.summaryLabel ?? '', o.value].join(' ').toLowerCase()
      return blob.includes(q)
    }
    return flatOptions.filter(match)
  }, [useGroups, flatOptions, searchQuery])

  const listEmpty = useGroups ? (visibleGroups?.length ?? 0) === 0 : visibleFlat.length === 0

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return

    const measureAndSet = () => {
      const el = triggerRef.current
      if (!el) return
      const gap = 8
      const margin = 12
      const searchReserve = 52
      const preferredMax = (useGroups ? 340 : 300) + searchReserve
      const bottomObstruction = walletSelectBottomReservePx()
      const minMenuTotal = useGroups ? 200 : 140

      const mobileInline = window.matchMedia('(max-width: 639.98px)').matches
      if (mobileInline) {
        if (onMenuLiftPxChange) onMenuLiftPxChange(0)
        const vvH = window.visualViewport?.height ?? window.innerHeight
        const maxH = Math.min(preferredMax, Math.max(minMenuTotal, Math.round(vvH * 0.72 - bottomObstruction)))
        setMenuPos({ left: 0, width: 0, maxH })
        return
      }

      const r = el.getBoundingClientRect()
      const below0 = window.innerHeight - r.bottom - gap - margin - bottomObstruction
      const allowLift = menuLiftScopeRef?.current != null
      let liftPx = 0
      if (allowLift && menuLiftScopeRef?.current) {
        const scopeTop = menuLiftScopeRef.current.getBoundingClientRect().top
        const maxLift = Math.max(0, scopeTop - margin)
        liftPx = Math.min(maxLift, Math.max(0, preferredMax - below0))
        onMenuLiftPxChange?.(liftPx)
      } else if (onMenuLiftPxChange) {
        onMenuLiftPxChange(0)
      }
      const maxH = Math.min(preferredMax, Math.max(minMenuTotal, below0 + liftPx))
      const { left, width } = clampWalletSelectMenuHorizontal(r.left, r.width)
      setMenuPos({ left, width, maxH, top: r.bottom + gap - liftPx })
    }

    measureAndSet()
    const vv = window.visualViewport
    vv?.addEventListener('resize', measureAndSet)
    vv?.addEventListener('scroll', measureAndSet)
    return () => {
      vv?.removeEventListener('resize', measureAndSet)
      vv?.removeEventListener('scroll', measureAndSet)
    }
  }, [open, useGroups, menuLiftScopeRef, onMenuLiftPxChange])

  useLayoutEffect(() => {
    if (!open) return
    const node = searchHeaderRef.current
    if (!node) return
    const apply = () => {
      const h = node.getBoundingClientRect().height
      if (h > 0) setSearchHeaderPx(Math.ceil(h))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(node)
    return () => ro.disconnect()
  }, [open, flatOptions.length, inlineMobileMenu])

  useEffect(() => {
    if (!open || !inlineMobileMenu) return
    let cancelled = false
    const run = () => {
      if (cancelled) return
      const motionOk =
        typeof window !== 'undefined' &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      blockRef.current?.scrollIntoView({
        behavior: motionOk ? 'smooth' : 'auto',
        block: 'center',
        inline: 'nearest',
      })
    }
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [open, inlineMobileMenu])

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      onMenuLiftPxChange?.(0)
      setSearchHeaderPx(WALLET_SELECT_MENU_SEARCH_H_FALLBACK)
    }
  }, [open, onMenuLiftPxChange])

  useEffect(() => {
    return () => {
      onMenuLiftPxChange?.(0)
    }
  }, [onMenuLiftPxChange])

  useEffect(() => {
    if (!open) return
    const idFocus = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(idFocus)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node
      if (triggerRef.current?.contains(n) || menuRef.current?.contains(n)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (window.matchMedia('(max-width: 639.98px)').matches) return
      const t = e.target as Node | null
      if (t && menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onReposition = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onReposition)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open])

  const selectedOpt = flatOptions.find((o) => o.value === value)
  const selectedLabel = selectedOpt
    ? (selectedOpt.summaryLabel?.trim() ? selectedOpt.summaryLabel.trim() : selectedOpt.label)
    : value
  const selectedIcon = selectedOpt?.icon ?? icon

  const renderOptionButton = (o: WalletSelectOption, sectionHeading: string | null) => {
    const selected = o.value === value
    return (
      <button
        key={o.value}
        type="button"
        role="option"
        aria-selected={selected}
        aria-label={sectionHeading ? `${sectionHeading}: ${o.label}` : o.label}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition ${
          selected
            ? 'border-casino-primary bg-casino-surface text-white shadow-[0_0_0_1px_rgba(139,92,246,0.22)] ring-1 ring-casino-primary/25'
            : 'border-casino-border bg-casino-surface text-white/90 hover:border-white/20 hover:bg-casino-chip-hover'
        }`}
        onClick={() => {
          onChange(o.value)
          setOpen(false)
        }}
      >
        <span className="flex size-6 shrink-0 items-center justify-center [&>img]:size-6 [&>img]:rounded-full [&>img]:object-cover">
          {o.icon ?? null}
        </span>
        <span className="min-w-0 flex-1 truncate leading-snug">{o.label}</span>
      </button>
    )
  }

  const headerAllowance = Math.max(48, searchHeaderPx)
  const listScrollMaxH = Math.max(80, menuPos.maxH - headerAllowance)

  const menuPanelInner = (
    <>
      <div ref={searchHeaderRef} className="shrink-0 border-b border-white/[0.06] bg-casino-bg px-2 pb-2 pt-2">
        <div className="relative">
          <IconSearch
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-casino-muted"
            size={14}
            aria-hidden
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('wallet.currencySelectSearchPlaceholder')}
            aria-label={t('wallet.currencySelectSearchAria')}
            autoComplete="off"
            className="w-full rounded-lg border border-casino-border bg-casino-surface py-2 pl-9 pr-3 text-xs text-casino-foreground outline-none placeholder:text-casino-muted focus:border-casino-primary"
          />
        </div>
      </div>
      <div
        id={listId}
        role="listbox"
        aria-labelledby={id}
        onWheel={(e) => e.stopPropagation()}
        className="min-h-0 overflow-y-auto overscroll-y-contain p-2 scrollbar-casino touch-pan-y"
        style={{ maxHeight: listScrollMaxH }}
      >
        {listEmpty ? (
          <p className="px-2 py-6 text-center text-xs text-casino-muted">{t('wallet.assetNoMatch')}</p>
        ) : useGroups ? (
          <div className="flex flex-col gap-2">
            {visibleGroups!.map((g) => (
              <div
                key={g.groupId}
                className="min-w-0 rounded-xl border border-casino-border bg-casino-surface p-2"
              >
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-casino-muted">
                  {g.heading}
                </p>
                <div className="flex flex-col gap-1.5">
                  {g.options.map((o) => renderOptionButton(o, g.heading))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="min-w-0 rounded-xl border border-casino-border bg-casino-surface p-2">
            <div className="flex flex-col gap-1.5">
              {visibleFlat.map((o) => renderOptionButton(o, null))}
            </div>
          </div>
        )}
      </div>
    </>
  )

  const menu =
    open && flatOptions.length > 0
      ? inlineMobileMenu
        ? (
            <div
              ref={menuRef}
              className="relative z-10 mt-2 flex w-full flex-col overflow-hidden rounded-xl border border-casino-border bg-casino-bg shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.05]"
              style={{ maxHeight: menuPos.maxH }}
            >
              {menuPanelInner}
            </div>
          )
        : createPortal(
            <div
              ref={menuRef}
              className="fixed z-[340] flex h-fit flex-col overflow-hidden rounded-xl border border-casino-border bg-casino-bg shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
              style={{
                left: menuPos.left,
                width: menuPos.width,
                maxHeight: menuPos.maxH,
                ...(menuPos.top != null ? { top: menuPos.top } : {}),
                ...(menuPos.bottom != null ? { bottom: menuPos.bottom } : {}),
              }}
            >
              {menuPanelInner}
            </div>,
            document.body,
          )
      : null

  return (
    <div ref={blockRef} className="mb-5 last:mb-0">
      <span id={id} className="mb-2 block text-xs text-casino-muted">
        {label}
      </span>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={`${id}-trigger`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-full cursor-pointer items-center justify-between rounded-xl border border-white/[0.10] bg-wallet-field px-4 text-left text-sm font-semibold text-white outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/20 focus-visible:ring-2 focus-visible:ring-casino-primary/45"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedIcon ? (
              <span className="flex size-6 shrink-0 items-center justify-center [&>img]:size-6 [&>img]:rounded-full [&>img]:object-cover">
                {selectedIcon}
              </span>
            ) : null}
            <span className="truncate">{selectedLabel}</span>
          </span>
          <IconChevronDown
            size={16}
            className={`shrink-0 text-casino-muted transition ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {menu}
      </div>
    </div>
  )
}

export function WalletTextField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'off',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
}) {
  const id = `wallet-txt-${label.replace(/\s+/g, '-')}`
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-2 block text-xs text-casino-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-lg border border-casino-border bg-wallet-field px-4 text-sm text-white outline-none placeholder:text-casino-muted focus-visible:ring-2 focus-visible:ring-casino-primary/45"
      />
    </div>
  )
}

export function WalletReadOnlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <span className="mb-2 block text-xs text-wallet-subtext">{label}</span>
      <div className="flex h-12 items-center rounded-lg border border-casino-border bg-wallet-field px-4 text-sm text-casino-muted">{children}</div>
    </div>
  )
}

/** Looks like the Banani dropdown row but display-only (address step). */
export function WalletDisplayRow({ label, icon, value }: { label: string; icon?: ReactNode; value: string }) {
  return (
    <div className="mb-5 last:mb-0">
      <WalletFieldLabel>{label}</WalletFieldLabel>
      <div className="flex h-12 items-center justify-between rounded-lg border border-casino-border bg-wallet-field px-4 text-sm font-medium text-white">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{value}</span>
        </span>
        <IconChevronDown size={16} className="shrink-0 text-casino-muted" aria-hidden />
      </div>
    </div>
  )
}

export function WalletBackButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 w-full rounded-lg border border-white/[0.08] bg-wallet-field/80 py-2.5 text-xs font-medium text-white transition hover:bg-wallet-field"
    >
      {children}
    </button>
  )
}

export function WalletPrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-casino-primary px-4 text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function WalletCopyAddressButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-casino-primary px-4 text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 disabled:opacity-50"
    >
      <IconCopy size={18} aria-hidden />
      {label}
    </button>
  )
}

export function WalletAmountCurrencyRow({
  amount,
  onAmountChange,
  currencyLabel,
  currencyIcon,
  hint,
}: {
  amount: string
  onAmountChange: (v: string) => void
  currencyLabel: string
  currencyIcon?: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-5">
      <WalletFieldLabel>Amount</WalletFieldLabel>
      <div className="flex h-12 items-center gap-2 rounded-lg border border-casino-border bg-wallet-field pl-4 pr-1">
        <input
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label="Withdrawal amount"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-casino-muted"
        />
        <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-casino-border bg-casino-segment-track px-3 py-2 text-[13px] font-semibold text-white">
          {currencyIcon ?? <IconCircleDollarSign size={14} className="text-casino-primary" aria-hidden />}
          {currencyLabel}
          <IconChevronDown size={14} className="text-casino-muted" aria-hidden />
        </div>
      </div>
      {hint ? <p className="mt-1.5 text-[11px] text-casino-muted">{hint}</p> : null}
    </div>
  )
}

export function WalletFeeSummary({
  lines,
  totalLabel,
  totalValue,
}: {
  lines: { label: string; value: string }[]
  totalLabel: string
  totalValue: string
}) {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      {lines.map((l) => (
        <div key={l.label} className="flex items-center justify-between gap-3 text-xs text-casino-muted">
          <span>{l.label}</span>
          <span className="tabular-nums">{l.value}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-white">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{totalValue}</span>
      </div>
    </div>
  )
}

export function WalletInfoTrigger({
  label,
  title,
}: {
  /** Accessible description — keep concise */
  label: string
  title?: string
}) {
  return (
    <span className="inline-flex text-casino-muted" title={title} aria-label={label}>
      <IconInfo size={14} aria-hidden />
    </span>
  )
}

export function WalletBankingPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <WalletPanel>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-xs leading-relaxed text-casino-muted">{body}</p>
    </WalletPanel>
  )
}
