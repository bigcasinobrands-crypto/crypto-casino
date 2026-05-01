import { useEffect, useMemo, useState } from 'react'
import { adminApiUrl } from '../../lib/adminApiUrl'
import { builtinChainLogoUrl, builtinTokenLogoUrl } from '../../lib/payoutAssetLogos'
import { Dropdown } from '../ui/dropdown/Dropdown'

export type PayoutAssetOption = {
  key: string
  symbol: string
  network: string
  label: string
}

function LogoThumb({
  src,
  label,
  title,
}: {
  src: string
  label: string
  title: string
}) {
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setBad(false)
  }, [src])
  if (!src || bad) {
    return (
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-circle bg-secondary text-white flex-shrink-0 fw-bold"
        style={{ width: 22, height: 22, fontSize: '0.55rem' }}
        title={title}
      >
        {label.slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      title={title}
      width={22}
      height={22}
      className="rounded-circle flex-shrink-0"
      style={{ objectFit: 'cover' }}
      loading="lazy"
      decoding="async"
      referrerPolicy="strict-origin-when-cross-origin"
      onError={() => setBad(true)}
    />
  )
}

export function PayoutAssetDropdown({
  options,
  value,
  onChange,
  disabled,
}: {
  options: PayoutAssetOption[]
  value: string
  onChange: (key: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [tokenExtra, setTokenExtra] = useState<Record<string, string>>({})

  const symbols = useMemo(() => {
    const s = new Set<string>()
    for (const o of options) {
      const k = o.symbol.trim().toLowerCase()
      if (k) s.add(k)
    }
    return [...s].sort()
  }, [options])

  const symbolsKey = useMemo(() => symbols.join(','), [symbols])

  useEffect(() => {
    if (symbols.length === 0) {
      setTokenExtra({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          adminApiUrl(`/v1/market/crypto-logo-urls?symbols=${encodeURIComponent(symbolsKey)}`),
        )
        const j = (await res.json().catch(() => null)) as { urls?: Record<string, string>; configured?: boolean } | null
        if (cancelled || !j?.urls || typeof j.urls !== 'object') return
        setTokenExtra(j.urls)
      } catch {
        /* keep builtins */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [symbolsKey])

  const selected = options.find((o) => o.key === value) ?? options[0]
  const display = selected?.label ?? '—'

  function tokenSrc(sym: string): string {
    const k = sym.trim().toLowerCase()
    return (k && tokenExtra[k]) || builtinTokenLogoUrl(sym)
  }

  return (
    <div className="dropdown w-100 position-relative">
      <button
        type="button"
        disabled={disabled || options.length === 0}
        className="btn btn-outline-secondary border-secondary d-flex w-100 align-items-center gap-2 text-start form-select-sm py-2"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((p) => !p)}
      >
        {selected ? (
          <>
            <span className="d-inline-flex align-items-center gap-1 flex-shrink-0" aria-hidden>
              <LogoThumb src={tokenSrc(selected.symbol)} label={selected.symbol} title={selected.symbol} />
              <LogoThumb
                src={builtinChainLogoUrl(selected.network)}
                label={selected.network || '?'}
                title={selected.network ? `Chain ${selected.network}` : 'Chain'}
              />
            </span>
            <span className="text-truncate flex-grow-1">{display}</span>
          </>
        ) : (
          <span className="text-secondary">No options</span>
        )}
        <i className={`bi bi-chevron-down small flex-shrink-0 ms-auto ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <Dropdown
        isOpen={open}
        onClose={() => setOpen(false)}
        className="w-100 mt-1 p-1 shadow border border-secondary"
        style={{ maxHeight: 280, overflowY: 'auto' }}
      >
        <div role="listbox" aria-label="Payout asset">
          {options.map((o) => {
            const active = o.key === value
            return (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={active}
                className={[
                  'dropdown-item d-flex align-items-center gap-2 rounded py-2 px-2',
                  active ? 'active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onChange(o.key)
                  setOpen(false)
                }}
              >
                <span className="d-inline-flex align-items-center gap-1 flex-shrink-0" aria-hidden>
                  <LogoThumb src={tokenSrc(o.symbol)} label={o.symbol} title={o.symbol} />
                  <LogoThumb
                    src={builtinChainLogoUrl(o.network)}
                    label={o.network || '?'}
                    title={o.network ? `Chain ${o.network}` : 'Chain'}
                  />
                </span>
                <span className="text-truncate">{o.label}</span>
              </button>
            )
          })}
        </div>
      </Dropdown>
    </div>
  )
}
