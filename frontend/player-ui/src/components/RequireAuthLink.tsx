import { Link, type LinkProps } from 'react-router-dom'
import { useAuthModal } from '../authModalContext'
import { saveCatalogReturnBeforeGameOpen } from '../lib/catalogReturn'
import { usePlayerAuth } from '../playerAuth'

/** String path for post-login navigation (includes hash when relevant). */
export function authNavigateTarget(to: LinkProps['to']): string {
  if (typeof to === 'string') return to
  const p = to.pathname ?? ''
  const s = to.search ?? ''
  const h = to.hash ?? ''
  return `${p}${s}${h}` || '/'
}

export function isGameLobbyNavTarget(to: LinkProps['to']): boolean {
  return authNavigateTarget(to).startsWith('/casino/game-lobby/')
}

type Props = LinkProps & { to: LinkProps['to'] }

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
