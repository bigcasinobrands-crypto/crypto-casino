import { Link, type LinkProps } from 'react-router-dom'
import { useAuthModal } from '../authModalContext'
import { saveCatalogReturnBeforeGameOpen } from '../lib/catalogReturn'
import { authNavigateTarget, isGameLobbyNavTarget } from '../lib/linkTargets'
import { usePlayerAuth } from '../playerAuth'

type Props = LinkProps

/**
 * If the player is signed out, opens the auth modal and continues to `to` after success.
 * If signed in, behaves like a normal {@link Link}.
 */
export function RequireAuthLink({ to, onClick, ...rest }: Props) {
  const { accessToken } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const target = authNavigateTarget(to)

  return (
    <Link
      to={to}
      {...rest}
      onClick={(e) => {
        if (isGameLobbyNavTarget(to)) {
          saveCatalogReturnBeforeGameOpen()
        }
        if (!accessToken) {
          e.preventDefault()
          openAuth('login', { navigateTo: target })
        }
        onClick?.(e)
      }}
    />
  )
}
