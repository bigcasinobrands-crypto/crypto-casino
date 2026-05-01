export function formatCurrency(minor: number, currency = 'USD'): string {
  const major = minor / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major)
}

export function formatMinorToMajor(minor: number): string {
  const major = minor / 100
  if (Math.abs(major) >= 1_000_000) return `${(major / 1_000_000).toFixed(2)}M`
  if (Math.abs(major) >= 1_000) return `${(major / 1_000).toFixed(1)}K`
  return major.toFixed(2)
}

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`
}

export function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export async function downloadCSV(
  apiPath: string,
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  filename: string,
): Promise<void> {
  const res = await apiFetch(apiPath, {
    headers: { Accept: 'text/csv' },
  })
  if (!res.ok) throw new Error(`CSV download failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
