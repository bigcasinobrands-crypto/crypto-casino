import { useEffect, useMemo, useState } from 'react'
import type { HubBonusDetails } from '../../hooks/useRewardsHub'
import { bonusDetailStringIds } from '../../lib/bonusDetailsHelpers'
import { GameThumbGrid, type GameThumbRow } from './GameThumbGrid'

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

function formatMinorUsd(minor: number) {
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatBonusDateTime(iso: string | undefined): string | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function BonusInstanceDetailsPanel({
  details,
  infoOpen,
  apiFetch,
  embedded,
}: {
  details?: HubBonusDetails
  infoOpen: boolean
  apiFetch: ApiFetch
  /** When true, omit top rule (e.g. nested in Profile list). */
  embedded?: boolean
}) {
  const [gamesById, setGamesById] = useState<Map<string, GameThumbRow>>(new Map())

  const allowed = useMemo(() => bonusDetailStringIds(details?.allowed_game_ids), [details?.allowed_game_ids])
  const excluded = useMemo(() => bonusDetailStringIds(details?.excluded_game_ids), [details?.excluded_game_ids])

  useEffect(() => {
    if (!infoOpen) return
    const ids = [...new Set([...allowed, ...excluded])].slice(0, 48)
    if (ids.length === 0) {
      setGamesById(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/v1/games?ids=${encodeURIComponent(ids.join(','))}&bonus_refs=1`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { games?: GameThumbRow[] }
        const list = Array.isArray(j.games) ? j.games : []
        const m = new Map<string, GameThumbRow>()
        for (const g of list) {
          if (g?.id) m.set(g.id, g)
        }
        if (!cancelled) setGamesById(m)
      } catch {
        if (!cancelled) setGamesById(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [infoOpen, apiFetch, allowed, excluded])

  if (!infoOpen) return null

  const wrapCls = embedded ? 'space-y-3' : 'space-y-3 border-t border-white/[0.06] pt-3'

  const wm = details?.wagering_multiplier
  const mb = details?.max_bet_minor
  const gwp = details?.game_weight_pct
  const wp = details?.withdraw_policy?.trim()
  const dep = details?.deposit_minor
  const grant = details?.grant_minor
  const publishedLabel = formatBonusDateTime(details?.promotion_published_at)
  const validFromLabel = formatBonusDateTime(details?.promotion_valid_from)
  const validToLabel = formatBonusDateTime(details?.promotion_valid_to)

  return (
    <div className={wrapCls}>
      <div className="rounded-casino-md border border-white/[0.06] bg-casino-elevated/40 px-2.5 py-2">
        <h4 className="m-0 text-[10px] font-extrabold uppercase tracking-wide text-casino-muted">Offer schedule</h4>
        <div className="mt-1.5 space-y-1 text-[11px] text-casino-muted">
          {publishedLabel ? (
            <p className="m-0">
              <span className="font-bold text-casino-foreground">Published:</span> {publishedLabel}
            </p>
          ) : (
            <p className="m-0 text-casino-muted/80">Published: not available for this record.</p>
          )}
          {validFromLabel ? (
            <p className="m-0">
              <span className="font-bold text-casino-foreground">Valid from:</span> {validFromLabel}
            </p>
          ) : null}
          {validToLabel ? (
            <p className="m-0">
              <span className="font-bold text-casino-foreground">Ends:</span> {validToLabel}
            </p>
          ) : (
            <p className="m-0">
              <span className="font-bold text-casino-foreground">Ends:</span> No fixed end time — offer window is open-ended unless staff set a date.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1 text-[11px] leading-relaxed text-casino-muted">
        {typeof wm === 'number' && wm > 0 ? (
          <p className="m-0">
            <span className="font-bold text-casino-foreground">Wagering multiplier:</span> {wm}× (on eligible stake toward this bonus)
          </p>
        ) : null}
        {typeof mb === 'number' && mb > 0 ? (
          <p className="m-0">
            <span className="font-bold text-casino-foreground">Max bet (locked bonus):</span> {formatMinorUsd(mb)} per bet while this bonus is active
          </p>
        ) : null}
        {typeof gwp === 'number' && gwp > 0 && gwp !== 100 ? (
          <p className="m-0">
            <span className="font-bold text-casino-foreground">Promo weight:</span> {gwp}% of eligible stake counts before category rules
          </p>
        ) : null}
        {wp ? (
          <p className="m-0">
            <span className="font-bold text-casino-foreground">Withdrawals:</span>{' '}
            {wp === 'block' ? 'Withdrawals may be blocked until wagering is completed.' : wp}
          </p>
        ) : null}
        {typeof dep === 'number' && dep > 0 ? (
          <p className="m-0">
            <span className="font-bold text-casino-foreground">Trigger deposit (snapshot):</span> {formatMinorUsd(dep)}
          </p>
        ) : null}
        {typeof grant === 'number' && grant > 0 ? (
          <p className="m-0">
            <span className="font-bold text-casino-foreground">Granted (snapshot):</span> {formatMinorUsd(grant)}
          </p>
        ) : null}
      </div>

      {allowed.length > 0 ? (
        <p className="m-0 text-[11px] leading-relaxed text-casino-primary">
          <strong className="text-casino-foreground">Game-specific wagering:</strong> only the titles below advance your wagering bar. Play on other
          games does not move this bonus toward completion (subject to site rules).
        </p>
      ) : excluded.length > 0 ? (
        <p className="m-0 text-[11px] leading-relaxed text-amber-200/90">
          <strong className="text-casino-foreground">Excluded games:</strong> these titles do not count toward wagering; some may also block bets while
          this bonus is active.
        </p>
      ) : (
        <p className="m-0 text-[11px] text-casino-muted">
          All eligible catalog games can count toward wagering, using this promo&apos;s weight and the site&apos;s category contribution table—except
          any excluded titles below.
        </p>
      )}

      <GameThumbGrid
        title="Counts toward this bonus"
        ids={allowed}
        gamesById={gamesById}
        variant="allowed"
      />
      <GameThumbGrid title="Excluded from wagering" ids={excluded} gamesById={gamesById} variant="excluded" />
    </div>
  )
}
