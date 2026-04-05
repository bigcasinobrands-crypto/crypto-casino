import type { LinkProps } from 'react-router-dom'

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
