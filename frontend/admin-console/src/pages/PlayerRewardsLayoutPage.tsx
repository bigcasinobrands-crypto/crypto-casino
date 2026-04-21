import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { formatFlatConfig } from '../lib/adminFormatting'

type RewardProgramRow = {
  id: number
  program_key: string
  kind: string
  promotion_version_id: number
  config: Record<string, unknown>
  enabled: boolean
  priority: number
}

const PLAYER_PREVIEW_PATH = '/rewards/preview'
const PLAYER_LIVE_PATH = '/rewards'

/** Base URL for the player app (no trailing slash). `.env`: VITE_PLAYER_UI_ORIGIN or VITE_PLAYER_APP_ORIGIN */
function playerUiOrigin(): string {
  const env = import.meta.env as { VITE_PLAYER_UI_ORIGIN?: string; VITE_PLAYER_APP_ORIGIN?: string }
  const o = (env.VITE_PLAYER_UI_ORIGIN || env.VITE_PLAYER_APP_ORIGIN || '').trim()
  if (o) return o.replace(/\/$/, '')
  return `${window.location.protocol}//127.0.0.1:5174`
}

export default function PlayerRewardsLayoutPage() {
  const { apiFetch } = useAdminAuth()
  const [programs, setPrograms] = useState<RewardProgramRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/bonushub/reward-programs')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        setPrograms([])
        return
      }
      const j = (await res.json()) as { programs?: RewardProgramRow[] }
      setPrograms(Array.isArray(j.programs) ? j.programs : [])
    } catch {
      setErr('Network error')
      setPrograms([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const origin = playerUiOrigin()
  const previewUrl = `${origin}${PLAYER_PREVIEW_PATH}`
  const liveUrl = `${origin}${PLAYER_LIVE_PATH}`

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Player rewards layout</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Use the <strong>preview</strong> page to review the full grid, calendar strip, and stat cards with{' '}
          <strong>deterministic demo data</strong> (no login). The live <strong>/rewards</strong> page uses{' '}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-white/10">GET /v1/rewards/hub</code> for
          signed-in players. Load sample promos and programs with{' '}
          <code className="font-mono text-xs">npm run seed:rewards-demo</code> (Postgres must match{' '}
          <code className="font-mono text-xs">services/core/.env</code>). Then run{' '}
          <code className="font-mono text-xs">npm run demo:rewards</code> (optional{' '}
          <code className="font-mono text-xs">PLAYER_JWT</code>) to hit the same APIs in the terminal.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-800/80 dark:text-white">
          Where this fits in the admin (navigation layers)
        </h3>
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800/80">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-white">Sidebar area</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-white">What you do there</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
            <tr>
              <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">Bonus Engine</td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                <strong>Promotions</strong> — catalog, versions, publish. <strong>Rewards map</strong> (this page) — API
                field map + <code className="font-mono text-xs">reward_programs</code>. <strong>Calendar</strong> — promo
                schedule view. <strong>Operations / Risk</strong> — delivery + manual review queue.{' '}
                <strong>Create promotion</strong> — wizard. <strong>Smart suggestions</strong> — recommendations.
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">Engagement</td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                <strong>VIP system</strong> — tier thresholds, tier benefits (unlock grants + rebate % adds).{' '}
                <strong>Global chat</strong> — staff chat.
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">Players</td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                <strong>All players / Player lookup</strong> — open a player → bonuses, ledger, VIP facts; global search (
                Ctrl+K) includes VIP tier on the hit line.
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">Finance</td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                <strong>Ledger</strong> — see <code className="font-mono text-xs">promo.grant</code> and cash movements;
                ties to bonus instances.
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">Compliance &amp; Risk</td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                <strong>Audit log</strong> — staff actions (e.g. bonus hub, VIP patches).
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-700"
        >
          Open player preview (new tab)
        </a>
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          Open live rewards (requires player login)
        </a>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/5"
        >
          Refresh programs
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Player origin: <code className="font-mono">{origin}</code> — set{' '}
        <code className="font-mono">VITE_PLAYER_UI_ORIGIN</code> (or <code className="font-mono">VITE_PLAYER_APP_ORIGIN</code>)
        in admin-console env if the player app runs elsewhere.
      </p>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800/80">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-white">UI section</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-white">API / source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Stat cards (3)</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                aggregates.wagering_remaining_minor, lifetime_promo_minor, bonus_locked_minor
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Calendar strip</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                calendar[] — POST /v1/rewards/daily/claim
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Wager milestones (wide card)</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">hunt (daily_hunt program)</td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Offer tiles</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                available_offers[] (title, description, bonus_type, schedule_summary)
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Level progress row</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">vip (same as GET /v1/vip/status)</td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Dedicated VIP marketing page</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                GET /v1/vip/program (public tier ladder + perks); configure in Admin → Engagement → VIP system
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800 dark:text-gray-200">Active bonuses list</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                bonus_instances[] (active / pending)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">reward_programs (engine)</h3>
        {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {!loading && programs.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No rows yet. Seed via Bonus Hub POST <code className="font-mono">/bonushub/reward-programs</code> (superadmin)
            or SQL — see repo <code className="font-mono">docs/reward-programs-seed.md</code>.
          </p>
        ) : null}
        {programs.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/80">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Key</th>
                  <th className="px-3 py-2 text-left font-semibold">Kind</th>
                  <th className="px-3 py-2 text-left font-semibold">PV id</th>
                  <th className="px-3 py-2 text-left font-semibold">Enabled</th>
                  <th className="px-3 py-2 text-left font-semibold">Settings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                {programs.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono text-xs">{p.program_key}</td>
                    <td className="px-3 py-2">{p.kind}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.promotion_version_id}</td>
                    <td className="px-3 py-2">{p.enabled ? 'yes' : 'no'}</td>
                    <td className="max-w-md px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
                      {formatFlatConfig(p.config)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
