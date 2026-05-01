/** Align two daily series on a shared sorted date axis (fills missing days with 0). */
export function alignTwoDailyTotals(
  a: { date: string; total_minor: number }[],
  b: { date: string; total_minor: number }[],
): { categories: string[]; valuesA: number[]; valuesB: number[] } {
  const dates = new Set<string>()
  for (const x of a) {
    if (x.date) dates.add(x.date)
  }
  for (const x of b) {
    if (x.date) dates.add(x.date)
  }
  const categories = [...dates].sort()
  const mapA = new Map(a.map((d) => [d.date, d.total_minor]))
  const mapB = new Map(b.map((d) => [d.date, d.total_minor]))
  return {
    categories,
    valuesA: categories.map((d) => mapA.get(d) ?? 0),
    valuesB: categories.map((d) => mapB.get(d) ?? 0),
  }
}

/** Daily counts (e.g. registrations) — same alignment pattern. */
export function alignDailyCounts(points: { date: string; count: number }[]): {
  categories: string[]
  values: number[]
} {
  const sorted = [...points].filter((p) => p.date).sort((x, y) => x.date.localeCompare(y.date))
  return {
    categories: sorted.map((p) => p.date),
    values: sorted.map((p) => p.count),
  }
}
