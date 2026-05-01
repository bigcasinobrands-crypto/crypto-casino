import { PIGMO_BRAND_ICONS } from '../lib/pigmoIconAssets'
import { PigmoAssetIcon } from './PigmoAssetIcon'

type SizeProps = { size?: number; className?: string }

/** Pigmo login-strip Metamask glyph (full color). */
export function PigmoMetamaskBrandIcon({ size = 20, className }: SizeProps) {
  return (
    <PigmoAssetIcon src={PIGMO_BRAND_ICONS.metamask} size={size} className={className} monochrome={false} alt="" />
  )
}

export function PigmoGoogleBrandIcon({ size = 20, className }: SizeProps) {
  return <PigmoAssetIcon src={PIGMO_BRAND_ICONS.google} size={size} className={className} monochrome={false} alt="" />
}

export function PigmoSolanaBrandIcon({ size = 20, className }: SizeProps) {
  return <PigmoAssetIcon src={PIGMO_BRAND_ICONS.solana} size={size} className={className} monochrome={false} alt="" />
}
