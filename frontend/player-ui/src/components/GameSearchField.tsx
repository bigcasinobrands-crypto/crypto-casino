import type { FC } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { IconSearch } from './icons'

type GameSearchFieldProps = {
  id?: string
  className?: string
}

const GameSearchField: FC<GameSearchFieldProps> = ({ id = 'player-game-search', className = '' }) => {
  const location = useLocation()
  const [sp, setSp] = useSearchParams()
  const isCasino = location.pathname.startsWith('/casino/')
  const q = sp.get('q') ?? ''

  return (
    <div className={`relative w-full ${className}`}>
      <IconSearch
        className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[18px] -translate-y-1/2 text-casino-muted"
        size={18}
        aria-hidden
      />
      <input
        id={id}
        type="search"
        disabled={!isCasino}
        value={isCasino ? q : ''}
        onChange={(e) => {
          if (!isCasino) return
          const next = new URLSearchParams(sp)
          const v = e.target.value
          if (v) next.set('q', v)
          else next.delete('q')
          setSp(next, { replace: true })
        }}
        placeholder={isCasino ? 'Search games' : 'Open Casino to search'}
        aria-label="Search games"
        className="min-w-0 w-full rounded-[4px] border border-casino-border bg-casino-surface py-3 pl-11 pr-4 text-[13px] text-casino-muted outline-none transition placeholder:text-casino-muted focus:border-casino-primary focus:text-casino-foreground focus:ring-1 focus:ring-casino-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

export default GameSearchField
