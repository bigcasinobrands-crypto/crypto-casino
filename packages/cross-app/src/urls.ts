import type { CrossAppViteEnv } from './env'
import { resolveAdminAppOrigin, resolvePlayerAppOrigin } from './env'

function joinBasePath(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/** Absolute URL to the player UI (separate deployable app). */
export function playerAppHref(env: CrossAppViteEnv, path = '/'): string {
  return joinBasePath(resolvePlayerAppOrigin(env), path)
}

/** Absolute URL to the admin console (separate deployable app). */
export function adminAppHref(env: CrossAppViteEnv, path = '/'): string {
  return joinBasePath(resolveAdminAppOrigin(env), path)
}
