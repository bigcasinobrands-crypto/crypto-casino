import type { ReactNode } from 'react'
import { PigmoAssetIcon } from './PigmoAssetIcon'
import { getPigmoShellIconUrl, type PigmoShellIconSlot } from '../../lib/pigmoShellIconMap'

type Props = {
  slot: PigmoShellIconSlot
  size?: number
  className?: string
  monochrome?: boolean
  fallback: ReactNode
}

/** Renders Pigmo CDN asset when `VITE_PIGMO_SHELL_ICONS` / `VITE_PIGMO_SHELL_ICON_BASE` supply a URL. */
export function PigmoShellGlyph({ slot, size = 18, className, monochrome = true, fallback }: Props) {
  const url = getPigmoShellIconUrl(slot)
  if (!url) return fallback
  return <PigmoAssetIcon src={url} size={size} className={className} monochrome={monochrome} alt="" />
}
