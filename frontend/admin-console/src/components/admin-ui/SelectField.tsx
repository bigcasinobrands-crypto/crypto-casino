import { Field } from './Field'
import { adminInputCls } from './inputStyles'

export function SelectField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  options,
}: {
  id?: string
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  options: { value: string; label: string }[]
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        className={adminInputCls}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
