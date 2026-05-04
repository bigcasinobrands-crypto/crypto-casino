/** Vite `public/` URLs — honor `base` when the app is not hosted at domain root. */
export function publicAsset(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = import.meta.env.BASE_URL || '/'
  if (base === '/') return p
  return `${base.replace(/\/$/, '')}${p}`
}
