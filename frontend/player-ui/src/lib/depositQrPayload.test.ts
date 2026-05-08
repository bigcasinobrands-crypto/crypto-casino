import { describe, expect, it } from 'vitest'
import { buildDepositQrPayload, isLikelyWebHttpUrl } from './depositQrPayload'

describe('isLikelyWebHttpUrl', () => {
  it('detects http(s) URLs', () => {
    expect(isLikelyWebHttpUrl('https://www.rivalry.com/esports')).toBe(true)
    expect(isLikelyWebHttpUrl('http://evil.test')).toBe(true)
    expect(isLikelyWebHttpUrl('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')).toBe(false)
  })
})

describe('buildDepositQrPayload', () => {
  it('returns null for web URLs', () => {
    expect(buildDepositQrPayload('https://www.rivalry.com/esports', 'ETH', 'ERC20', '')).toBeNull()
  })

  it('uses ethereum: URI for EVM hex addresses', () => {
    const addr = '0x742d35Cc6634C0532925a3b844Bc9e7595f213bD'
    expect(buildDepositQrPayload(addr, 'USDT', 'ERC20', '')).toBe(`ethereum:${addr}`)
  })

  it('uses bitcoin: for BTC', () => {
    expect(buildDepositQrPayload('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'BTC', 'BTC', '')).toBe(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    )
  })

  it('includes destination tag for XRP', () => {
    expect(buildDepositQrPayload('rNXPj7Jxq1iE3c123', 'XRP', 'XRP', '12345')).toBe(
      'ripple:rNXPj7Jxq1iE3c123?dt=12345',
    )
  })
})
