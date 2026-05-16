import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApiError, formatApiError } from '../../api/errors'
import { adminHintCls, adminInputCls } from '../admin-ui'

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

type GameRow = {
  id: string
  title: string
  provider: string
  bog_game_id?: number
}

const inputCls = adminInputCls

function minorToMajor(minor: number): string {
  return (minor / 100).toFixed(2)
}

function majorToMinor(raw: string): number {
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function MoneyMinorField({
  label,
  hint,
  valueMinor,
  onChangeMinor,
}: {
  label: string
  hint?: string
  valueMinor: number
  onChangeMinor: (minor: number) => void
}) {
  const major = valueMinor / 100
  const preview = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(major)
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        className={inputCls}
        value={minorToMajor(valueMinor)}
        onChange={(e) => onChangeMinor(majorToMinor(e.target.value))}
      />
      <p className={`${adminHintCls} mt-1 mb-0`}>{hint ?? 'Converted to minor units on save.'}</p>
      <p className={`${adminHintCls} mt-0`}>Preview: {preview}</p>
    </div>
  )
}

export type FreeSpinsVariant = 'reward' | 'free_spins_block'

type Props = {
  apiFetch: ApiFetch
  variant: FreeSpinsVariant
  rounds: number
  gameId: string
  betPerRoundMinor: number
  onChange: (patch: { rounds?: number; game_id?: string; bet_per_round_minor?: number }) => void
}

/** Blue Ocean free-round package editor — rounds, catalog game (must have bog_game_id), bet per round. */
export default function FreeSpinsRewardSection({
  apiFetch,
  variant,
  rounds,
  gameId,
  betPerRoundMinor,
  onChange,
}: Props) {
  const [games, setGames] = useState<GameRow[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [boStatus, setBoStatus] = useState<{
    outbound_enabled?: boolean
    api_enabled?: boolean
  } | null>(null)

  const loadGames = useCallback(async () => {
    setLoadErr(null)
    try {
      const res = await apiFetch('/v1/admin/games?limit=500')
      if (!res.ok) {
        const e = await readApiError(res)
        setLoadErr(formatApiError(e, `Games load failed (${res.status})`))
        setGames([])
        return
      }
      const j = (await res.json()) as { games?: GameRow[] }
      setGames(Array.isArray(j.games) ? j.games : [])
    } catch {
      setLoadErr('Network error loading games')
      setGames([])
    }
  }, [apiFetch])

  useEffect(() => {
    void loadGames()
  }, [loadGames])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/v1/admin/integrations/blueocean/status')
        if (!res.ok || cancelled) return
        const j = (await res.json()) as Record<string, unknown>
        const cfg = j.free_spins_v1 as { outbound_enabled?: boolean; api_enabled?: boolean } | undefined
        if (!cancelled) {
          setBoStatus({
            outbound_enabled: cfg?.outbound_enabled,
            api_enabled: cfg?.api_enabled,
          })
        }
      } catch {
        if (!cancelled) setBoStatus(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  const gamesWithBog = useMemo(() => games.filter((g) => (g.bog_game_id ?? 0) > 0), [games])

  const heading =
    variant === 'reward'
      ? 'Free spins package (Blue Ocean)'
      : 'Free spins add-on (Blue Ocean)'

  const outboundOff = boStatus != null && boStatus.outbound_enabled === false

  return (
    <div className="space-y-4 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-4 dark:border-sky-500/25 dark:bg-sky-950/30">
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-900 dark:text-sky-100">{heading}</h4>
        <p className={`${adminHintCls} max-w-2xl`}>
          Free rounds are issued via{' '}
          <code className="rounded bg-white/80 px-1 text-[11px] dark:bg-white/10">addFreeRounds</code> after the worker
          picks up <code className="rounded bg-white/80 px-1 text-[11px] dark:bg-white/10">free_spin_grants</code>. The game
          must have a synced Blue Ocean catalog id (<code className="rounded bg-white/80 px-1 text-[11px] dark:bg-white/10">
            bog_game_id
          </code>
          ).
        </p>
      </div>

      {outboundOff ? (
        <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-100">
          Free-spin <strong>outbound</strong> is disabled in bonus config. Grants may queue but will not call Blue Ocean until
          enabled. Sync catalog under Provider Ops if needed.
        </p>
      ) : null}

      {loadErr ? <p className="text-sm text-red-600 dark:text-red-400">{loadErr}</p> : null}

      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Number of free spins</span>
          <input
            type="number"
            min={1}
            className={inputCls}
            value={rounds >= 1 ? rounds : 1}
            onChange={(e) => onChange({ rounds: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          />
        </div>
        <MoneyMinorField
          label="Bet per spin (minor units)"
          hint="Stake per free round in settlement currency minor units."
          valueMinor={betPerRoundMinor >= 1 ? betPerRoundMinor : 1}
          onChangeMinor={(n) => onChange({ bet_per_round_minor: n <= 0 ? 1 : n })}
        />
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Game (catalog id — BO-linked only)
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
              onClick={() => void loadGames()}
            >
              Refresh catalog
            </button>
            <Link
              to="/provider-ops"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
            >
              Provider Ops
            </Link>
          </div>
          <select
            className={`${inputCls} mt-2 max-w-full`}
            value={gameId}
            onChange={(e) => onChange({ game_id: e.target.value })}
          >
            <option value="">— Select game —</option>
            {gamesWithBog.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title} ({g.provider}) · BO #{g.bog_game_id}
              </option>
            ))}
          </select>
          {games.length > 0 && gamesWithBog.length === 0 ? (
            <p className={`${adminHintCls} mt-2 text-amber-800 dark:text-amber-200`}>
              No games have <code className="rounded bg-white/60 px-1 dark:bg-white/10">bog_game_id</code> yet. Run Blue
              Ocean catalog sync first.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function validateWizardFreeSpinRules(selectedTypeId: string, rules: unknown): string | null {
  if (selectedTypeId !== 'free_spins_only' && selectedTypeId !== 'composite_match_and_fs') return null
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? (rules as Record<string, unknown>) : null
  if (!r) return 'Configure free spins (rounds and game) before creating.'
  if (selectedTypeId === 'free_spins_only') {
    const rew = r.reward && typeof r.reward === 'object' ? (r.reward as Record<string, unknown>) : {}
    const rounds = typeof rew.rounds === 'number' ? rew.rounds : 0
    const gid = typeof rew.game_id === 'string' ? rew.game_id.trim() : ''
    if (rounds < 1) return 'Free spins: enter at least 1 round.'
    if (!gid) return 'Free spins: select a Blue Ocean–linked game.'
    return null
  }
  const fs = r.free_spins && typeof r.free_spins === 'object' ? (r.free_spins as Record<string, unknown>) : {}
  const rounds = typeof fs.rounds === 'number' ? fs.rounds : 0
  const gid = typeof fs.game_id === 'string' ? fs.game_id.trim() : ''
  if (rounds < 1) return 'Composite free spins: enter at least 1 round.'
  if (!gid) return 'Composite free spins: select a Blue Ocean–linked game.'
  return null
}
