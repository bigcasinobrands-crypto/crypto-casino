import { useState, type CSSProperties } from 'react'
import type { DepositNetworkId } from '../DepositFlowShared'
import { NETWORK_CHAIN_LOGO } from '../DepositFlowShared'
import { useCryptoLogoUrlMap } from '../../lib/cryptoLogoUrls'

const GLYPH: Record<DepositNetworkId, { accent: string; ch: string }> = {
  ERC20: { accent: 'bg-[#627EEA]', ch: 'Ξ' },
  BEP20: { accent: 'bg-[#F0B90B]', ch: 'B' },
  TRC20: { accent: 'bg-[#EB0029]', ch: 'T' },
}

/** Parses SYMBOL_NETWORK-style keys like USDC_ERC20 → ERC20 (suffix after last _). */
export function depositNetworkFromPayoutAssetKey(key?: string | null): DepositNetworkId | null {
  const k = key?.trim()
  if (!k) return null
  const i = k.lastIndexOf('_')
  if (i <= 0 || i >= k.length - 1) return null
  const tail = k.slice(i + 1).toUpperCase()
  if (tail === 'ERC20' || tail === 'TRC20' || tail === 'BEP20') return tail
  return null
}

type RailProps = {
  assetKey?: string | null
  /** When payout asset key is unset, show token icon from prize currency (e.g. USDC). */
  prizeCurrency?: string | null
  sizePx?: number
  className?: string
}

function tokenSlugFromCurrency(c?: string | null): string | null {
  const u = c?.trim().toUpperCase()
  if (!u) return null
  const map: Record<string, string> = {
    USDT: 'usdt',
    USDC: 'usdc',
    ETH: 'eth',
    TRX: 'trx',
    BNB: 'bnb',
    BTC: 'btc',
  }
  return map[u] ?? null
}

const TOKEN_GLYPH: Record<string, { accent: string; ch: string }> = {
  usdt: { accent: 'bg-[#26A17B]', ch: '₮' },
  usdc: { accent: 'bg-[#2775CA]', ch: '$' },
  eth: { accent: 'bg-[#627EEA]', ch: 'Ξ' },
  trx: { accent: 'bg-[#EB0029]', ch: 'T' },
  bnb: { accent: 'bg-[#F0B90B]', ch: 'B' },
  btc: { accent: 'bg-[#F7931A]', ch: '₿' },
}

function TokenLogoMark({
  prizeCurrency,
  sizePx,
  className,
}: {
  prizeCurrency?: string | null
  sizePx: number
  className: string
}) {
  const slug = tokenSlugFromCurrency(prizeCurrency)
  const logos = useCryptoLogoUrlMap()
  const [badImg, setBadImg] = useState(false)
  const dim: CSSProperties = { width: sizePx, height: sizePx }

  if (!slug) return null
  const url = logos[slug] || ''
  const label = prizeCurrency?.trim().toUpperCase() ?? slug.toUpperCase()

  if (url && !badImg) {
    return (
      <img
        src={url}
        alt=""
        title={label}
        className={`shrink-0 rounded-full bg-white/5 object-cover ring-1 ring-white/15 ${className}`.trim()}
        style={dim}
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setBadImg(true)}
      />
    )
  }

  const g = TOKEN_GLYPH[slug]
  if (!g) return null
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[7px] font-black text-white ${g.accent} ${className}`.trim()}
      style={dim}
      title={label}
      aria-hidden
    >
      {g.ch}
    </span>
  )
}

/**
 * Chain logo when `prize_payout_asset_key` includes ERC20/TRC20/BEP20; otherwise token logo from `prize_currency`.
 */
export function PrizeRailLogoMark({ assetKey, prizeCurrency, sizePx = 12, className = '' }: RailProps) {
  if (depositNetworkFromPayoutAssetKey(assetKey)) {
    return <PayoutChainLogoMark assetKey={assetKey} sizePx={sizePx} className={className} />
  }
  return <TokenLogoMark prizeCurrency={prizeCurrency} sizePx={sizePx} className={className} />
}

type Props = {
  assetKey?: string | null
  /** Pixel width/height of the mark (default 12, matches list row icons). */
  sizePx?: number
  className?: string
}

/**
 * Chain logo for prize payout rail (admin “Payout asset” / prize_payout_asset_key).
 */
export function PayoutChainLogoMark({ assetKey, sizePx = 12, className = '' }: Props) {
  const net = depositNetworkFromPayoutAssetKey(assetKey)
  const logoUrls = useCryptoLogoUrlMap()
  const [badImg, setBadImg] = useState(false)

  if (!net) return null

  const slug = NETWORK_CHAIN_LOGO[net]
  const url = (slug && logoUrls[slug]) || ''

  const dim: CSSProperties = { width: sizePx, height: sizePx }

  if (url && !badImg) {
    return (
      <img
        src={url}
        alt=""
        title={`Paid on ${net === 'ERC20' ? 'Ethereum' : net === 'BEP20' ? 'BNB Chain' : 'Tron'}`}
        className={`shrink-0 rounded-full bg-white/5 object-cover ring-1 ring-white/15 ${className}`.trim()}
        style={dim}
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setBadImg(true)}
      />
    )
  }

  const g = GLYPH[net]
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[7px] font-black text-white ${g.accent} ${className}`.trim()}
      style={dim}
      title={`Paid on ${net === 'ERC20' ? 'Ethereum' : net === 'BEP20' ? 'BNB Chain' : 'Tron'}`}
      aria-hidden
    >
      {g.ch}
    </span>
  )
}
