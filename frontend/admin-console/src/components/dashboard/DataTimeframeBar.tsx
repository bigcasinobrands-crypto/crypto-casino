import { type FC } from 'react'

type Option = {
  value: string
  label: string
}

type Props = {
  value: string
  onChange: (next: string) => void
  options: Option[]
  startDate?: string
  endDate?: string
  onStartDateChange?: (value: string) => void
  onEndDateChange?: (value: string) => void
  className?: string
}

const DataTimeframeBar: FC<Props> = ({
  value,
  onChange,
  options,
  startDate = '',
  endDate = '',
  onStartDateChange,
  onEndDateChange,
  className = '',
}) => {
  const custom = value === 'custom'
  return (
    <div className={`card shadow-sm mb-4 ${className}`.trim()}>
      <div className="card-body d-flex flex-wrap align-items-end gap-3">
        <div>
          <label className="form-label small text-secondary mb-1">Timeframe</label>
          <select className="form-select form-select-sm" value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {custom ? (
          <>
            <div>
              <label className="form-label small text-secondary mb-1">Start</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={startDate}
                onChange={(e) => onStartDateChange?.(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label small text-secondary mb-1">End</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={endDate}
                onChange={(e) => onEndDateChange?.(e.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

export default DataTimeframeBar

