import { useEffect, useState } from 'react'
import { PLAYER_FAVOURITES_CHANGED_EVENT } from '../lib/gameStorage'

/** Bumps when favourite game ids change (localStorage + server merge). */
export function useFavouritesRevision(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN((x) => x + 1)
    window.addEventListener(PLAYER_FAVOURITES_CHANGED_EVENT, bump)
    return () => window.removeEventListener(PLAYER_FAVOURITES_CHANGED_EVENT, bump)
  }, [])
  return n
}
