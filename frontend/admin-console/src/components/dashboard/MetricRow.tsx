import type { FC, ReactNode } from 'react'

interface MetricRowProps {
  label: string
  value: string
  subValue?: ReactNode
  trailing?: ReactNode
}

const MetricRow: FC<MetricRowProps> = ({ label, value, subValue, trailing }) => (
  <div className="flex items-center justify-between py-2.5">
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      {subValue != null && subValue !== '' ? (
        <div className="text-xs text-gray-400 dark:text-gray-500">{subValue}</div>
      ) : null}
    </div>
    <div className="flex items-center gap-3">
      {trailing}
      <span className="text-sm font-semibold text-gray-800 dark:text-white">{value}</span>
    </div>
  </div>
)

export default MetricRow
