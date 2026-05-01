import { Field } from './Field'
import { adminInputCls } from './inputStyles'

export function SliderField({
  id,
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
  formatDisplay,
}: {
  id?: string
  label: string
  hint?: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  /** e.g. (n) => `${n}%` */
  formatDisplay?: (n: number) => string
}) {
  const display = formatDisplay ? formatDisplay(value) : String(value)
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="form-range min-w-[140px] flex-1 cursor-pointer accent-brand-600 disabled:opacity-50"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (!Number.isFinite(n)) return
            onChange(Math.min(max, Math.max(min, n)))
          }}
          className={`${adminInputCls} w-24 shrink-0`}
        />
        {formatDisplay ? (
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{display}</span>
        ) : null}
      </div>
    </Field>
  )
}
