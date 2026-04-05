/** Public block explorer links for deposit/withdraw UX (no API keys). */

export function transactionExplorerUrl(network: string, txHash: string): string | null {
  const h = txHash.trim()
  if (!h) return null
  const n = network.trim().toUpperCase()
  if (n === 'TRC20' || n === 'TRON' || n === 'TRX') {
    return `https://tronscan.org/#/transaction/${encodeURIComponent(h)}`
  }
  if (n === 'BEP20' || n === 'BSC' || n === 'BNB') {
    return `https://bscscan.com/tx/${encodeURIComponent(h)}`
  }
  if (n === 'ERC20' || n === 'ETH' || n === 'ETHEREUM' || n === 'EVM') {
    return `https://etherscan.io/tx/${encodeURIComponent(h)}`
  }
  return `https://etherscan.io/tx/${encodeURIComponent(h)}`
}

export function networkHelpUrl(network: string): string {
  const n = network.trim().toUpperCase()
  if (n === 'TRC20' || n === 'TRON' || n === 'TRX') {
    return 'https://tronscan.org/'
  }
  if (n === 'BEP20' || n === 'BSC' || n === 'BNB') {
    return 'https://bscscan.com/'
  }
  return 'https://etherscan.io/'
}
