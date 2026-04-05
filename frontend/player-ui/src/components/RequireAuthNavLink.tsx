import { NavLink, type NavLinkProps } from 'react-router-dom'
import { useAuthModal } from '../authModalContext'
import { saveCatalogReturnBeforeGameOpen } from '../lib/catalogReturn'
import { usePlayerAuth } from '../playerAuth'
import { authNavigateTarget, isGameLobbyNavTarget } from '../lib/linkTargets'

type Props = NavLinkProps

/**
 * Same as {@link RequireAuthLink} for active-state sidebar / tab links.
 */
export function RequireAuthNavLink({ to, onClick, ...rest }: Props) {
  const { accessToken } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const target = authNavigateTarget(to)

  return (
    <NavLink
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
