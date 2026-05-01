import { useMemo, useState } from 'react'
import { COUNTRY_OPTIONS, countriesByRegion, flagEmoji } from '../../lib/countryIsoList'
import { adminInputCls } from './inputStyles'

export function CountryPicker({
  selected,
  onToggle,
  disabled,
  mode,
}: {
  selected: string[]
  onToggle: (code: string) => void
  disabled?: boolean
  /** highlight allow vs deny styling */
  mode: 'allow' | 'deny'
}) {
  const [q, setQ] = useState('')
  const byRegion = useMemo(() => countriesByRegion(), [])
  const sel = useMemo(() => new Set(selected.map((x) => x.toUpperCase())), [selected])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return COUNTRY_OPTIONS
    return COUNTRY_OPTIONS.filter(
      (c) => c.code.toLowerCase().includes(qq) || c.name.toLowerCase().includes(qq) || c.region.toLowerCase().includes(qq),
    )
  }, [q])

  const ring =
    mode === 'allow'
      ? 'ring-green-500/40 border-green-200 dark:border-green-900'
      : 'ring-red-500/40 border-red-200 dark:border-red-900'

  return (
    <div className="space-y-3">
      <input
        className={adminInputCls}
        placeholder="Search region or country…"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
        {q.trim() ? (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((c) => {
              const on = sel.has(c.code)
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggle(c.code)}
                    className={[
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      on ? `bg-brand-50 dark:bg-brand-950/30 ${ring} ring-1` : 'hover:bg-gray-50 dark:hover:bg-white/5',
                      disabled ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <span className="text-lg leading-none" aria-hidden>
                      {flagEmoji(c.code)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        {c.region} · {c.code}
                      </span>
                    </span>
                    {on ? <span className="text-xs font-semibold text-brand-600">On</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="space-y-1 p-2">
            {Array.from(byRegion.entries()).map(([region, list]) =>
              list.length ? (
                <details key={region} className="rounded-lg border border-gray-100 dark:border-gray-800" open>
                  <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {region}
                  </summary>
                  <ul className="pb-2">
                    {list.map((c) => {
                      const on = sel.has(c.code)
                      return (
                        <li key={c.code}>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onToggle(c.code)}
                            className={[
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm',
                              on ? `rounded-md bg-brand-50 dark:bg-brand-950/30 ${ring} ring-1` : 'rounded-md hover:bg-gray-50 dark:hover:bg-white/5',
                              disabled ? 'opacity-50' : '',
                            ].join(' ')}
                          >
                            <span className="text-base leading-none">{flagEmoji(c.code)}</span>
                            <span className="text-gray-800 dark:text-gray-200">{c.name}</span>
                            <span className="text-xs text-gray-400">{c.code}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  )
}
