/** Normalize JSON string arrays (API may encode mixed types). */
export function bonusDetailStringIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x === 'string' && x.trim() !== '') out.push(x.trim())
  }
  return out
}
