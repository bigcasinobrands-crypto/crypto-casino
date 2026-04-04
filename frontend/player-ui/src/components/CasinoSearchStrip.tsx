import type { FC } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlayerAuth } from '../playerAuth'
import GameSearchField from './GameSearchField'

const CasinoSearchStrip: FC = () => {
  const { pathname } = useLocation()
  const { accessToken } = usePlayerAuth()
  if (!accessToken) return null
  if (!pathname.startsWith('/casino/')) return null
  if (pathname.startsWith('/casino/game-lobby/')) return null

  return (
    <div className="shrink-0 border-b border-casino-border bg-casino-bg px-5 py-4 md:px-6">
      <GameSearchField />
    </div>
  )
}

export default CasinoSearchStrip
