import type { FC } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

const HeaderGameSearch: FC = () => {
  const location = useLocation()
  const [sp, setSp] = useSearchParams()
  const isCasino = location.pathname.startsWith('/casino/')
  const q = sp.get('q') ?? ''

  return (
    <div className="flex flex-1 items-center gap-2">
      <input
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
        className="min-w-0 flex-1 rounded-casino-md border border-casino-border bg-casino-bg px-3 py-2 text-sm outline-none focus:border-casino-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

export default HeaderGameSearch
