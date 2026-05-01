import type { FC, ReactNode } from 'react'

const ChartEmpty: FC<{ message: string; height?: number; children?: ReactNode }> = ({
  message,
  height = 280,
  children,
}) => (
  <div
    className="d-flex flex-column align-items-center justify-content-center text-center text-secondary border rounded bg-body-secondary bg-opacity-25 px-3 py-4"
    style={{ minHeight: height }}
  >
    <i className="bi bi-bar-chart-line fs-2 opacity-50 mb-2" aria-hidden />
    <p className="mb-0 small">{message}</p>
    {children}
  </div>
)

export default ChartEmpty
