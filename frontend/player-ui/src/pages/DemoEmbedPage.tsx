import type { FC } from 'react'
import { useParams } from 'react-router-dom'

/**
 * In-iframe placeholder for seeded demo-* games when Blue Ocean XAPI is not used.
 * Launch API points the play iframe here (same origin as the player app).
 */
const DemoEmbedPage: FC = () => {
  const { demoId } = useParams<{ demoId: string }>()
  const label = demoId ? decodeURIComponent(demoId) : 'demo'

  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 bg-casino-bg p-6 text-center text-sm text-casino-muted">
      <p className="text-base font-medium text-casino-foreground">Demo game</p>
      <p className="max-w-md">
        <span className="font-mono text-casino-primary">{label}</span> is a local catalog placeholder. Sync the Blue
        Ocean catalog in the staff console and open a real title to use provider iframe launch.
      </p>
    </div>
  )
}

export default DemoEmbedPage
