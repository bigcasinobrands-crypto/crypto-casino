import { useMemo } from 'react'
import { useSiteContent } from './useSiteContent'
import { DEFAULT_PLAYER_LOGO_PNG } from '../lib/brandLogoAssets'

/** CMS `branding.logo_url` when set; otherwise bundled default wordmark. */
export function usePlayerBrandLogoSrc(): string {
  const { content, getContent } = useSiteContent()
  return useMemo(() => {
    const u = (getContent<string>('branding.logo_url', '') ?? '').trim()
    return u || DEFAULT_PLAYER_LOGO_PNG
  }, [content, getContent])
}
