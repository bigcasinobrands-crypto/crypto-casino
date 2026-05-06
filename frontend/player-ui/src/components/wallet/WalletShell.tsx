import type { ReactNode } from 'react'
import {
  IconBitcoin,
  IconBanknote,
  IconChevronDown,
  IconCircleDollarSign,
  IconCopy,
  IconInfo,
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
      className="absolute right-6 top-6 flex size-6 shrink-0 items-center justify-center rounded-full border border-casino-border text-casino-muted transition hover:border-white/25 hover:text-white"
    >
      <IconX size={14} aria-hidden />
    </button>
  )
}

export type WalletMainTabId = 'deposit' | 'withdraw'

export function WalletMainTabs({
  active,
  onChange,
  depositLabel,
  withdrawLabel,
}: {
  active: WalletMainTabId
  onChange: (t: WalletMainTabId) => void
  depositLabel: string
  withdrawLabel: string
}) {
  return (
    <div
      className="mb-6 flex rounded-[10px] bg-casino-segment-track p-1 pr-10 ring-1 ring-white/[0.06]"
      role="tablist"
      aria-label="Wallet"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'deposit'}
        onClick={() => onChange('deposit')}
        className={`flex-1 rounded-lg py-2.5 text-center text-sm font-semibold transition ${
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
        onClick={() => onChange('withdraw')}
        className={`flex-1 rounded-lg py-2.5 text-center text-sm font-semibold transition ${
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

/**
 * Styled row + invisible native `<select>` for mobile accessibility and keyboard support.
 */
export function WalletNativeSelectRow({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  icon?: ReactNode
}) {
  const id = `wallet-select-${label.replace(/\s+/g, '-')}`
  return (
    <div className="mb-5 last:mb-0">
      <label htmlFor={id} className="mb-2 block text-xs text-casino-muted">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 z-10 h-12 w-full cursor-pointer opacity-0"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none flex h-12 items-center justify-between rounded-lg border border-casino-border bg-wallet-field px-4 text-sm font-medium text-white">
          <span className="flex min-w-0 items-center gap-2">
            {icon}
            {options.find((o) => o.value === value)?.label ?? value}
          </span>
          <IconChevronDown size={16} className="shrink-0 text-casino-muted" aria-hidden />
        </div>
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
        <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-casino-elevated px-3 py-2 text-[13px] font-semibold text-white">
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
