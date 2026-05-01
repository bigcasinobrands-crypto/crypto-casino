import type { FC } from 'react'

/** Lightweight full-width placeholder while lazy route chunks load. */
const RouteFallback: FC = () => (
  <div className="d-flex min-vh-25 align-items-center justify-content-center py-5">
    <div className="text-secondary small" role="status">
      Loading…
    </div>
  </div>
)

export default RouteFallback
