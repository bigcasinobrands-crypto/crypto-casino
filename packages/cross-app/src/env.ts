/** Minimal Vite `import.meta.env` shape both SPAs pass in. */
export type CrossAppViteEnv = {
  readonly VITE_PLAYER_APP_ORIGIN?: string
  readonly VITE_ADMIN_APP_ORIGIN?: string
}

export const DEFAULT_PLAYER_DEV_ORIGIN = 'http://localhost:5174'
export const DEFAULT_ADMIN_DEV_ORIGIN = 'http://localhost:5173'

export function resolvePlayerAppOrigin(env: CrossAppViteEnv): string {
  const v = env.VITE_PLAYER_APP_ORIGIN?.trim()
  if (v) return v.replace(/\/$/, '')
  return DEFAULT_PLAYER_DEV_ORIGIN
}

export function resolveAdminAppOrigin(env: CrossAppViteEnv): string {
  const v = env.VITE_ADMIN_APP_ORIGIN?.trim()
  if (v) return v.replace(/\/$/, '')
  return DEFAULT_ADMIN_DEV_ORIGIN
}
