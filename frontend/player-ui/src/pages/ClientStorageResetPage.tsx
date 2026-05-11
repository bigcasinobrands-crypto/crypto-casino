import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Opens from the admin “clear browser data” action (other origin). Wipes this origin’s
 * local/session storage then returns the player to the lobby.
 */
export default function ClientStorageResetPage() {
  const navigate = useNavigate()

  useEffect(() => {
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
    navigate('/casino/games', { replace: true })
  }, [navigate])

  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="text-sm text-casino-muted" role="status">
        Clearing saved data for this site…
      </p>
    </div>
  )
}
