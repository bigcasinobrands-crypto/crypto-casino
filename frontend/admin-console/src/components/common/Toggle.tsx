export function Toggle({
  checked,
  disabled,
  onChange,
  /** Visible label for assistive tech / hover context */
  ariaLabel,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={[
        'relative isolate inline-flex h-[1.375rem] w-[2.625rem] shrink-0 cursor-pointer rounded-full border transition-colors',
        'border-black/[0.08] dark:border-white/[0.12]',
        checked
          ? 'bg-emerald-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]'
          : 'bg-[#c5cad3] shadow-[inset_0_1px_2px_rgba(0,0,0,0.14)] dark:bg-[#4b5563]',
        disabled ? 'cursor-not-allowed opacity-50' : '',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900',
      ].join(' ')}
      onClick={() => onChange(!checked)}
    >
      <span
        aria-hidden
        className={[
          'pointer-events-none absolute top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06] transition-[left] duration-200 ease-out dark:ring-white/[0.08]',
          checked ? 'left-[calc(100%-1.125rem-3px)]' : 'left-[3px]',
        ].join(' ')}
      />
    </button>
  )
}
