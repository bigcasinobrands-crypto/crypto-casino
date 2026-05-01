import type { FC, ReactNode } from 'react'

interface MetricRowProps {
  label: string
  value: string
  subValue?: ReactNode
  trailing?: ReactNode
}

const MetricRow: FC<MetricRowProps> = ({ label, value, subValue, trailing }) => (
  <div className="d-flex align-items-center justify-content-between py-2 border-bottom border-opacity-25">
    <div className="me-2">
      <div className="small text-secondary">{label}</div>
      {subValue != null && subValue !== '' ? <div className="small mt-1">{subValue}</div> : null}
    </div>
    <div className="d-flex align-items-center gap-2 text-nowrap">
      {trailing}
      <span className="fw-semibold">{value}</span>
    </div>
  </div>
)

export default MetricRow
