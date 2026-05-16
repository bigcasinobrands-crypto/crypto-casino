import { useEffect, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { playerApiUrl } from '../lib/playerApiUrl'

export const ACCEPTED_CURRENCIES_STATIC = [
  { code: 'SOL', name: 'Solana' },
  { code: 'BTC', name: 'Bitcoin' },
  { code: 'USDT', name: 'Tether' },
  { code: 'USDC', name: 'USDC' },
  { code: 'ETH', name: 'Ethereum' },
  { code: 'DOGE', name: 'Dogecoin' },
  { code: 'XRP', name: 'Ripple' },
  { code: 'LTC', name: 'Litecoin' },
] as const

type CryptoTickerDTO = {
  symbol: string
  name: string
  price_usd: number
  change_24h_pct: number
  logo_url?: string
}

type Row = {
  code: string
  name: string
  priceUsd?: number
  change24h?: number
  logoUrl?: string | null
}

const priceFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 6,
  minimumFractionDigits: 2,
})

function formatUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(n)
  }
  if (abs >= 0.0001) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 6,
      minimumFractionDigits: 2,
    }).format(n)
  }
  return priceFmt.format(n)
}

function formatPct(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

const CoinAvatar: FC<{ code: string; logoUrl?: string | null }> = ({ code, logoUrl }) => {
  const [bad, setBad] = useState(false)
  if (logoUrl && !bad) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={28}
        height={28}
        className="size-7 rounded-full bg-casino-bg object-contain p-0.5"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBad(true)}
      />
    )
  }
  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-casino-primary text-[10px] font-semibold text-white"
      aria-hidden
    >
      {code.slice(0, 1)}
    </div>
  )
}

const PriceCard: FC<{ c: Row }> = ({ c }) => (
  <div className="flex w-[100px] shrink-0 flex-col items-center gap-1 rounded-[4px] bg-casino-surface px-1.5 py-2.5 text-center sm:w-[108px]">
    <CoinAvatar code={c.code} logoUrl={c.logoUrl} />
    <div className="text-[11px] font-bold leading-tight text-casino-foreground">{c.code}</div>
    <div className="line-clamp-2 min-h-[2rem] text-[9px] leading-tight text-casino-muted">{c.name}</div>
    {c.priceUsd != null ? (
      <div className="text-[10px] font-semibold tabular-nums text-casino-foreground">{formatUsd(c.priceUsd)}</div>
    ) : (
      <div className="text-[10px] tabular-nums text-casino-muted">—</div>
    )}
    {c.change24h != null ? (
      <div
        className={`text-[9px] font-medium tabular-nums ${
          c.change24h > 0 ? 'text-emerald-400' : c.change24h < 0 ? 'text-red-400' : 'text-casino-muted'
        }`}
      >
        {formatPct(c.change24h)}
      </div>
    ) : (
      <div className="h-[14px]" aria-hidden />
    )}
  </div>
)

/** Marquee animation uses translateX(-50%); content must be two identical halves. Four full passes = wider seamless strip on large desktops. */
function duplicateRowsForMarquee(rows: Row[], fullPasses: number): Row[] {
  const out: Row[] = []
  for (let p = 0; p < fullPasses; p++) {
    out.push(...rows)
  }
  return out
}

const AcceptedCurrenciesStrip: FC = () => {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const [rows, setRows] = useState<Row[]>(() =>
    ACCEPTED_CURRENCIES_STATIC.map((c) => ({ code: c.code, name: c.name })),
  )
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const loopRows = reduceMotion ? rows : duplicateRowsForMarquee(rows, 4)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(playerApiUrl('/v1/market/crypto-tickers'))
        const data = (await res.json()) as {
          currencies?: CryptoTickerDTO[] | null
          error?: string
        }
        if (cancelled) return

        if (!res.ok) {
          setStatusNote(
            data.error
              ? t('crypto.pricesUnavailableWithError', { error: data.error })
              : t('crypto.pricesUnavailable'),
          )
          return
        }

        if (data.error === 'not_configured') {
          setStatusNote(t('crypto.pricesNeedApiKey'))
          return
        }

        if (!Array.isArray(data.currencies) || data.currencies.length === 0) {
          if (data.error) setStatusNote(t('crypto.pricesUnavailableWithError', { error: data.error }))
          return
        }

        setStatusNote(null)
        const bySym = new Map(
          data.currencies.map((x) => [x.symbol.trim().toUpperCase(), x] as const),
        )
        setRows(
          ACCEPTED_CURRENCIES_STATIC.map((c) => {
            const live = bySym.get(c.code)
            if (!live) return { code: c.code, name: c.name }
            return {
              code: live.symbol || c.code,
              name: (live.name || c.name).trim() || c.name,
              priceUsd: live.price_usd,
              change24h: live.change_24h_pct,
              logoUrl: live.logo_url?.trim() || null,
            }
          }),
        )
      } catch {
        setStatusNote(t('crypto.couldNotLoad'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <div>
      <div className="mb-3 text-[11px] font-extrabold text-casino-foreground">{t('crypto.stripTitle')}</div>
      {statusNote ? (
        <p className="mb-3 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[9px] leading-snug text-amber-200/90">
          {statusNote}
        </p>
      ) : null}
      <div
        className="relative -mx-1 w-full overflow-hidden py-0.5 mask-marquee-fade-x"
        role="region"
        aria-label={t('crypto.regionAriaLabel')}
      >
        <div
          className={
            reduceMotion
              ? 'grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8'
              : 'infinite-marquee-track gap-2.5 md:gap-3'
          }
        >
          {loopRows.map((c, i) =>
            reduceMotion ? (
              <div key={`${c.code}-${i}`} className="flex min-w-0 justify-center">
                <PriceCard c={c} />
              </div>
            ) : (
              <PriceCard key={`${c.code}-${i}`} c={c} />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

export default AcceptedCurrenciesStrip
