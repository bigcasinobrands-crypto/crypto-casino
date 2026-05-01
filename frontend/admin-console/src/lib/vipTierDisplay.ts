/** Character image URL from VIP tier perks (VIP Program editor → display). */
export function vipTierCharacterImageUrl(perks: Record<string, unknown> | undefined): string {
  if (!perks || typeof perks !== 'object') return ''
  const display = perks.display
  if (!display || typeof display !== 'object' || Array.isArray(display)) return ''
  const url = (display as Record<string, unknown>).character_image_url
  return typeof url === 'string' ? url.trim() : ''
}
