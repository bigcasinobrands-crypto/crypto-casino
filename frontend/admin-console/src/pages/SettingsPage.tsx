import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { useOperationalFlags, type OperationalFlags } from '../hooks/useOperationalFlags'
import { StatusBadge } from '../components/dashboard'
import { formatRelativeTime } from '../lib/format'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { Toggle } from '../components/common/Toggle'
import { CountryPicker } from '../components/admin-ui/CountryPicker'
import type { CountryRegion } from '../lib/countryIsoList'
import { COUNTRY_OPTIONS, flagEmoji } from '../lib/countryIsoList'
import { PLAYER_BRANDING_DEFAULT_LOGO_PREVIEW } from '../lib/playerBrandLogo'
import { clearBrowserSiteData } from '../lib/clearBrowserSiteData'

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const primaryBtn = 'btn btn-primary btn-sm'

const outlineBtn = 'btn btn-outline-secondary btn-sm'

/** Settings panels: outline primary save + outline secondary discard (matches Bonuses / Audit patterns). */
const settingsSaveBtn = 'btn btn-outline-primary btn-sm'
const settingsDiscardBtn = 'btn btn-outline-secondary btn-sm'

const dangerBtn = 'btn btn-danger btn-sm'

const inputCls = 'form-control form-control-sm'

const textareaCls = 'form-control form-control-sm'

const labelCls = 'form-label small mb-1'

const skeletonLine = 'placeholder col-12'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingEntry = { value: unknown; updated_at?: string; updated_by?: string }
type SettingsMap = Record<string, Record<string, SettingEntry>>

type ContentEntry = { content: unknown; updated_at?: string; updated_by?: string }
type ContentMap = Record<string, Record<string, ContentEntry>>

/** GET /v1/admin/settings and /content return grouped maps at the JSON root; older clients expected `{ groups }`. */
function normalizeAdminGroupedResponse<T extends Record<string, unknown>>(raw: unknown): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {} as T
  const o = raw as Record<string, unknown>
  const g = o.groups
  if (g && typeof g === 'object' && !Array.isArray(g)) return g as T
  return o as T
}

type HeroSlide = {
  image_url: string
  tag: string
  tag_color: string
  title: string
  subtitle: string
  cta_text: string
  cta_link: string
  enabled: boolean
  sort_order: number
}

type NavItem = {
  label: string
  enabled: boolean
  coming_soon: boolean
  sort_order: number
}

type Tab = 'system' | 'content'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSettingVal<T>(groups: SettingsMap, cat: string, key: string, fallback: T): T {
  const fullKey = `${cat}.${key}`
  const entry = groups?.[cat]?.[fullKey] ?? groups?.[cat]?.[key]
  if (!entry || entry.value === undefined || entry.value === null) return fallback
  return entry.value as T
}

/** Normalizes site_settings booleans when JSON comes through as string/number. */
function coerceBoolSetting(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes'
  }
  return false
}

function getSettingMeta(groups: SettingsMap, cat: string, key: string) {
  const fullKey = `${cat}.${key}`
  return groups?.[cat]?.[fullKey] ?? groups?.[cat]?.[key] ?? null
}

function getContentVal<T>(groups: ContentMap, cat: string, key: string, fallback: T): T {
  const fullKey = `${cat}.${key}`
  const entry = groups?.[cat]?.[fullKey] ?? groups?.[cat]?.[key]
  if (!entry || entry.content === undefined || entry.content === null) return fallback
  return entry.content as T
}

function getContentMeta(groups: ContentMap, cat: string, key: string) {
  const fullKey = `${cat}.${key}`
  return groups?.[cat]?.[fullKey] ?? groups?.[cat]?.[key] ?? null
}

function centsToStr(cents: number): string {
  return (cents / 100).toFixed(2)
}

function strToCents(str: string): number {
  return Math.round(parseFloat(str) * 100)
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title,
  desc,
  defaultOpen = false,
  children,
  id,
}: {
  title: string
  desc?: string
  defaultOpen?: boolean
  children: React.ReactNode
  /** For in-page outline / deep links. */
  id?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card mb-3 shadow-sm" id={id} style={{ scrollMarginTop: '80px' }}>
      <div className="card-header p-0">
        <button
          type="button"
          className="btn btn-link text-decoration-none text-body w-100 py-3 px-3 d-flex align-items-start justify-content-between gap-2 text-start"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <div className="min-w-0">
            <h3 className="h6 mb-0">{title}</h3>
            {desc ? <p className="text-secondary small mb-0 mt-1">{desc}</p> : null}
          </div>
          <i className={`bi bi-chevron-${open ? 'up' : 'down'} text-secondary shrink-0 mt-1`} aria-hidden />
        </button>
      </div>
      {open ? <div className="card-body border-top">{children}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton placeholders
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="card mb-3 placeholder-glow">
      <div className="card-body">
        <span className={`${skeletonLine} col-4`} />
        <span className={`${skeletonLine} col-12`} />
        <span className={`${skeletonLine} col-8`} />
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function SettingsAttentionStrip({
  settings,
  operationalFlags,
}: {
  settings: SettingsMap
  operationalFlags: OperationalFlags | null
}) {
  const maintenance =
    operationalFlags != null && typeof operationalFlags.maintenance_mode === 'boolean'
      ? operationalFlags.maintenance_mode
      : coerceBoolSetting(getSettingVal(settings, 'system', 'maintenance_mode', false))
  const deposits = coerceBoolSetting(getSettingVal(settings, 'payments', 'deposits_enabled', true))
  const withdrawals = coerceBoolSetting(getSettingVal(settings, 'payments', 'withdrawals_enabled', true))
  const realPlay = coerceBoolSetting(getSettingVal(settings, 'games', 'real_play_enabled', true))
  const risky = maintenance || !deposits || !withdrawals || !realPlay
  if (!risky) return null
  return (
    <div className="alert alert-warning small py-2 mb-3 d-flex flex-wrap align-items-center gap-2">
      <strong>Platform flags:</strong>
      {maintenance ? <span className="badge text-bg-danger">Maintenance on</span> : null}
      {maintenance && operationalFlags?.maintenance_mode_env ? (
        <span className="badge text-bg-secondary" title="Unset MAINTENANCE_MODE on the API process to allow the DB toggle to control the player gate.">
          Env override
        </span>
      ) : null}
      {!deposits ? <span className="badge text-bg-warning">Deposits off</span> : null}
      {!withdrawals ? <span className="badge text-bg-warning">Withdrawals off</span> : null}
      {!realPlay ? <span className="badge text-bg-warning">Real play off</span> : null}
    </div>
  )
}

function SettingsSystemOutline() {
  const links = [
    { href: '#settings-kill-switches', label: 'Kill switches' },
    { href: '#settings-maintenance-schedule', label: 'Maintenance schedule' },
    { href: '#settings-security', label: 'Security & access' },
    { href: '#settings-withdrawals', label: 'Withdrawal limits' },
    { href: '#settings-social-proof', label: 'Menu social proof' },
    { href: '#settings-bonus-worker', label: 'Bonus worker' },
    { href: '#settings-integrations', label: 'Integration status' },
    { href: '#settings-payments', label: 'Payment flags' },
    { href: '#settings-clear-admin-panel-data', label: 'Clear admin panel data' },
  ]
  return (
    <nav aria-label="System settings sections" className="mb-3">
      <div className="list-group small shadow-sm sticky-top" style={{ top: '72px' }}>
        {links.map((l) => (
          <a key={l.href} href={l.href} className="list-group-item list-group-item-action py-2">
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

function SettingsContentOutline() {
  const links = [
    { href: '#settings-content-branding', label: 'Branding' },
    { href: '#settings-content-social', label: 'Social links' },
    { href: '#settings-content-hero', label: 'Hero promotions' },
    { href: '#settings-content-footer', label: 'Footer' },
    { href: '#settings-content-legal', label: 'Legal pages' },
    { href: '#settings-content-nav', label: 'Navigation' },
    { href: '#settings-content-messages', label: 'Operational messages' },
  ]
  return (
    <nav aria-label="Content sections" className="mb-3">
      <div className="list-group small shadow-sm sticky-top" style={{ top: '72px' }}>
        {links.map((l) => (
          <a key={l.href} href={l.href} className="list-group-item list-group-item-action py-2">
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

export default function SettingsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'content' ? 'content' : 'system'

  const setTab = (t: Tab) => {
    if (t === 'system') setSearchParams({}, { replace: true })
    else setSearchParams({ tab: 'content' }, { replace: true })
  }
  const [settings, setSettings] = useState<SettingsMap>({})
  const [content, setContent] = useState<ContentMap>({})
  const [loading, setLoading] = useState(true)

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/settings')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      setSettings(normalizeAdminGroupedResponse<SettingsMap>(j))
    } catch (e) {
      console.error('settings fetch', e)
    }
  }, [apiFetch])

  const fetchContent = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/content')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      setContent(normalizeAdminGroupedResponse<ContentMap>(j))
    } catch (e) {
      console.error('content fetch', e)
    }
  }, [apiFetch])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchSettings(), fetchContent()]).finally(() => setLoading(false))
  }, [fetchSettings, fetchContent])

  // -----------------------------------------------------------------------
  // Setting mutators
  // -----------------------------------------------------------------------

  type PatchSettingOpts = { quietSuccess?: boolean; skipRefresh?: boolean }

  const patchSetting = useCallback(
    async (key: string, value: unknown, opts?: PatchSettingOpts) => {
      try {
        const res = await apiFetch('/v1/admin/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const msg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`
          toast.error(`Failed to update ${key}: ${msg}`)
          return false
        }
        if (!opts?.quietSuccess) toast.success(`Updated ${key}`)
        if (!opts?.skipRefresh) await fetchSettings()
        return true
      } catch (e) {
        toast.error(`Error updating ${key}`)
        console.error(e)
        return false
      }
    },
    [apiFetch, fetchSettings],
  )

  const saveContent = useCallback(
    async (key: string, value: unknown) => {
      try {
        const res = await apiFetch(`/v1/admin/content/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: value }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const msg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`
          toast.error(`Failed to save ${key}: ${msg}`)
          return false
        }
        toast.success(`Saved ${key}`)
        await fetchContent()
        return true
      } catch (e) {
        toast.error(`Error saving ${key}`)
        console.error(e)
        return false
      }
    },
    [apiFetch, fetchContent],
  )

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await apiFetch('/v1/admin/content/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          toast.error('Upload failed')
          return null
        }
        const j = (await res.json()) as { url: string }
        toast.success('File uploaded')
        return j.url
      } catch {
        toast.error('Upload error')
        return null
      }
    },
    [apiFetch],
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      <PageMeta title="Settings · Admin" description="Operational settings and content management" />
      <PageBreadcrumb
        pageTitle="Settings"
        subtitle="Operational switches, site content, and admin-only configuration."
      />

      {!isSuper ? (
        <div className="alert alert-info small py-2 mb-3">
          Signed in as <strong>{role}</strong>. Many toggles and payment flags require <strong>superadmin</strong>; you
          can still review read-only sections.
        </div>
      ) : null}

      <div className="btn-group mb-4" role="group" aria-label="Settings sections">
        <button
          type="button"
          className={`btn btn-sm ${tab === 'system' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setTab('system')}
        >
          System Controls
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'content' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setTab('content')}
        >
          Content Management
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : tab === 'system' ? (
        <SystemControlsTab
          settings={settings}
          patchSetting={patchSetting}
          isSuper={isSuper}
          apiFetch={apiFetch}
        />
      ) : (
        <ContentManagementTab
          content={content}
          saveContent={saveContent}
          uploadFile={uploadFile}
          isSuper={isSuper}
        />
      )}
    </>
  )
}

// ===========================================================================
// TAB 1: SYSTEM CONTROLS
// ===========================================================================

function SystemControlsTab({
  settings,
  patchSetting,
  isSuper,
  apiFetch,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown, opts?: { quietSuccess?: boolean; skipRefresh?: boolean }) => Promise<boolean>
  isSuper: boolean
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
}) {
  const { flags: operationalFlags, err: operationalFlagsErr, reload: reloadOperationalFlags } =
    useOperationalFlags(apiFetch)

  const maintenanceEffective = useMemo(() => {
    if (operationalFlags != null && typeof operationalFlags.maintenance_mode === 'boolean') {
      return operationalFlags.maintenance_mode
    }
    return coerceBoolSetting(getSettingVal(settings, 'system', 'maintenance_mode', false))
  }, [operationalFlags, settings])

  return (
    <>
      <SettingsAttentionStrip settings={settings} operationalFlags={operationalFlags} />
      <div className="row g-3">
        <div className="col-lg-3 d-none d-lg-block">
          <SettingsSystemOutline />
        </div>
        <div className="col-lg-9">
          <KillSwitchesPanel
            settings={settings}
            patchSetting={patchSetting}
            isSuper={isSuper}
            operationalFlags={operationalFlags}
            operationalFlagsErr={operationalFlagsErr}
            reloadOperationalFlags={reloadOperationalFlags}
          />
          <MaintenanceSchedulePanel
            settings={settings}
            patchSetting={patchSetting}
            isSuper={isSuper}
            maintenanceEffective={maintenanceEffective}
            reloadOperationalFlags={reloadOperationalFlags}
          />
          <SecurityAccessPanel settings={settings} patchSetting={patchSetting} isSuper={isSuper} />
          <WithdrawalLimitsPanel settings={settings} patchSetting={patchSetting} isSuper={isSuper} />
          <SocialProofPanel settings={settings} patchSetting={patchSetting} isSuper={isSuper} />
          <BonusWorkerReadonlyPanel apiFetch={apiFetch} />
          <IntegrationStatusPanel settings={settings} />
          <PaymentFlagsPanel apiFetch={apiFetch} isSuper={isSuper} />
          {isSuper ? <ClearBrowserDataPanel /> : null}
        </div>
      </div>
    </>
  )
}

function ClearBrowserDataPanel() {
  const { logout } = useAdminAuth()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    const msg =
      'Clear all data this browser has saved for the admin panel (local storage, session storage)? You will be signed out. ' +
      'Server-side data and other sites are not affected.'
    if (!window.confirm(msg)) return

    setBusy(true)
    try {
      try {
        await logout()
      } catch {
        /* still wipe local storage */
      }
      clearBrowserSiteData()
      toast.success('Admin panel data cleared. Sign in again when ready.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      id="settings-clear-admin-panel-data"
      title="Clear admin panel data"
      desc="Wipes localStorage and sessionStorage for this admin console only (theme, sidebar, tokens, etc.). Use for stuck sessions or local QA."
      defaultOpen={false}
    >
      <p className="small text-secondary mb-3">
        This does not delete database records or clear httpOnly cookies. The player site is a separate app—clear it in the
        player UI or that site’s devtools if needed.
      </p>
      <button type="button" className={dangerBtn} disabled={busy} onClick={() => void run()}>
        {busy ? 'Working…' : 'Clear admin panel data'}
      </button>
    </Section>
  )
}

function BonusWorkerReadonlyPanel({
  apiFetch,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
}) {
  const { flags, err } = useOperationalFlags(apiFetch)
  const n = flags?.bonus_max_bet_violations_auto_forfeit ?? null

  return (
    <Section
      id="settings-bonus-worker"
      title="Bonus worker (read-only)"
      desc="Values come from this API server’s environment, not from site_settings. Align the worker process in production."
      defaultOpen={false}
    >
      {err ? (
        <p className="text-sm text-red-600 dark:text-red-400">Could not load operational flags ({err}).</p>
      ) : flags == null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-white/[0.02]">
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Max-bet violations → auto-forfeit</dt>
            <dd className="mt-1 font-mono text-gray-900 dark:text-gray-100">
              {n === null ? '—' : n <= 0 ? 'Off (0)' : `≥ ${n} on instance counter`}
            </dd>
            <dd className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              Env: <code className="font-mono">BONUS_MAX_BET_VIOLATIONS_AUTO_FORFEIT</code>
            </dd>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-white/[0.02]">
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Related UI</dt>
            <dd className="mt-1 text-gray-700 dark:text-gray-300">
              Bonus Hub → Compliance → <span className="font-medium">Wager violations</span> lists rejects; audit shows{' '}
              <code className="font-mono text-[11px]">bonus_forfeited</code> with reason{' '}
              <code className="font-mono text-[11px]">max_bet_violations</code> when the sweep runs.
            </dd>
          </div>
        </dl>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Kill Switches
// ---------------------------------------------------------------------------

const KILL_SWITCHES = [
  { key: 'maintenance_mode', label: 'Maintenance Mode', cat: 'system' },
  { key: 'deposits_enabled', label: 'Deposits Enabled', cat: 'payments' },
  { key: 'withdrawals_enabled', label: 'Withdrawals Enabled', cat: 'payments' },
  { key: 'real_play_enabled', label: 'Real Play Enabled', cat: 'games' },
  { key: 'bonuses_enabled', label: 'Bonuses Enabled', cat: 'bonuses' },
  { key: 'automated_grants_enabled', label: 'Automated Grants', cat: 'bonuses' },
  { key: 'chat_enabled', label: 'Chat Enabled', cat: 'chat' },
] as const

type KillSwitchKey = (typeof KILL_SWITCHES)[number]['key']

const KILL_SWITCH_LIVE_FIELD = {
  maintenance_mode: 'maintenance_mode',
  deposits_enabled: 'deposits_enabled',
  withdrawals_enabled: 'withdrawals_enabled',
  real_play_enabled: 'real_play_enabled',
  bonuses_enabled: 'bonuses_enabled',
  automated_grants_enabled: 'automated_grants_enabled',
  chat_enabled: 'chat_enabled',
} as const satisfies Record<KillSwitchKey, keyof OperationalFlags>

/** Admin API should send booleans; tolerate legacy string/number payloads so Live pills never stick on "…". */
function coerceLiveBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no') return false
  }
  return undefined
}

function liveKillSwitchFromOps(swKey: KillSwitchKey, ops: OperationalFlags | null): boolean | undefined {
  if (!ops) return undefined
  const field = KILL_SWITCH_LIVE_FIELD[swKey]
  return coerceLiveBool(ops[field])
}

/** Fallback when operational-flags omits a field (matches API defaults). */
const KILL_SWITCH_PLAYER_DEFAULTS: Record<KillSwitchKey, boolean> = {
  maintenance_mode: false,
  deposits_enabled: true,
  withdrawals_enabled: true,
  real_play_enabled: false,
  bonuses_enabled: true,
  automated_grants_enabled: true,
  chat_enabled: true,
}

/** Player-facing state for this row (same sources as player `/health/operational`). */
function playerFacingKillSwitch(swKey: KillSwitchKey, ops: OperationalFlags | null): boolean | undefined {
  if (!ops) return undefined
  const v = liveKillSwitchFromOps(swKey, ops)
  return v !== undefined ? v : KILL_SWITCH_PLAYER_DEFAULTS[swKey]
}

function KillSwitchesPanel({
  settings,
  patchSetting,
  isSuper,
  operationalFlags,
  operationalFlagsErr,
  reloadOperationalFlags,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown, opts?: { quietSuccess?: boolean; skipRefresh?: boolean }) => Promise<boolean>
  isSuper: boolean
  operationalFlags: OperationalFlags | null
  operationalFlagsErr: string | null
  reloadOperationalFlags: () => Promise<OperationalFlags | null>
}) {
  const [patchingKey, setPatchingKey] = useState<string | null>(null)
  const opsReady = operationalFlags !== null && operationalFlagsErr === null

  const fmtMaintUntilHint = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  const applyToggle = async (sw: (typeof KILL_SWITCHES)[number], next: boolean) => {
    if (!isSuper || !opsReady || patchingKey !== null) return
    const fullKey = `${sw.cat}.${sw.key}`
    setPatchingKey(sw.key)
    try {
      const ok = await patchSetting(fullKey, next, { quietSuccess: true })
      const fresh = await reloadOperationalFlags()
      if (!ok) return
      const stillOn = fresh ? coerceLiveBool(fresh.maintenance_mode) === true : false
      if (sw.key === 'maintenance_mode' && next === false && stillOn) {
        if (fresh?.maintenance_mode_env) {
          toast.error(
            'Saved Off in the database, but MAINTENANCE_MODE in the API environment still forces maintenance. Unset it on the host and restart the API.',
          )
        } else {
          toast.error(
            'Saved Off, but maintenance still reads On. Restart all API replicas or verify Postgres site_settings.system.maintenance_mode.',
          )
        }
        return
      }
      toast.success(`${sw.label} ${next ? 'On' : 'Off'} — players see this once replicas pick it up.`)
    } finally {
      setPatchingKey(null)
    }
  }

  return (
    <Section
      id="settings-kill-switches"
      title="Kill Switches"
      desc="Switches show what players get right now. Flip one to update the database immediately — the handle stays aligned with the live gate."
      defaultOpen
    >
      {operationalFlags?.maintenance_mode_env ? (
        <div className="alert alert-warning small mb-3 py-2" role="status">
          <strong>MAINTENANCE_MODE</strong> is set in this API&apos;s environment. The switch stays <strong>On</strong> for players until you remove that variable on the host and restart; flipping Off still writes <strong>Off</strong> to the database.
        </div>
      ) : null}
      {operationalFlagsErr ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          Could not load live flags ({operationalFlagsErr}). Switches are disabled.
        </p>
      ) : !operationalFlags ? (
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">Loading live switches…</p>
      ) : null}
      {!isSuper ? (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Superadmin role required to edit kill switches.</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-3">
        {KILL_SWITCHES.map((sw) => {
          const fallback = coerceBoolSetting(
            getSettingVal(settings, sw.cat, sw.key, KILL_SWITCH_PLAYER_DEFAULTS[sw.key]),
          )
          const checked = playerFacingKillSwitch(sw.key, operationalFlags) ?? fallback
          const meta = getSettingMeta(settings, sw.cat, sw.key)
          const maintenanceRow = sw.key === 'maintenance_mode'
          const maintenanceOn = Boolean(checked)
          const rowBusy = patchingKey === sw.key
          const disabled = !isSuper || !opsReady || patchingKey !== null
          return (
            <div
              key={sw.key}
              className={[
                'flex min-h-[4.5rem] flex-col gap-3 rounded-xl border px-4 py-3 transition-colors sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3',
                maintenanceRow && maintenanceOn
                  ? 'border-amber-400/70 bg-amber-50/90 dark:border-amber-700/60 dark:bg-amber-950/35'
                  : 'border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-white/[0.02]',
              ].join(' ')}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="text-sm font-medium leading-snug text-gray-800 dark:text-gray-100">{sw.label}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      checked
                        ? 'border-emerald-500/35 bg-emerald-500/14 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/12 dark:text-emerald-200'
                        : 'border-slate-400/35 bg-slate-500/10 text-slate-700 dark:border-slate-500/30 dark:bg-slate-400/15 dark:text-slate-200',
                    ].join(' ')}
                  >
                    Players: {checked ? 'On' : 'Off'}
                  </span>
                  {rowBusy ? (
                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">Applying…</span>
                  ) : null}
                </div>
                {maintenanceRow && operationalFlags?.maintenance_until ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Scheduled end on maintenance page:{' '}
                    <strong className="font-medium text-gray-700 dark:text-gray-300">
                      {fmtMaintUntilHint(operationalFlags.maintenance_until)}
                    </strong>
                  </p>
                ) : maintenanceRow && maintenanceOn && !operationalFlags?.maintenance_until ? (
                  <p className="text-[11px] leading-snug text-amber-800/90 dark:text-amber-200/90">
                    No maintenance end time — set <span className="font-medium">Maintenance schedule</span> below for a player countdown.
                  </p>
                ) : null}
                {meta?.updated_at ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Last saved {formatRelativeTime(meta.updated_at)}
                    {meta.updated_by ? ` · ${meta.updated_by}` : ''}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200/80 pt-3 dark:border-white/[0.06] sm:border-t-0 sm:pt-0">
                <Toggle
                  checked={checked}
                  ariaLabel={`${sw.label}: ${checked ? 'on' : 'off'}`}
                  disabled={disabled}
                  onChange={(next) => void applyToggle(sw, next)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function parseBlockedCountriesRaw(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).toUpperCase().trim()).filter((x) => x.length === 2)
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t) as unknown
        if (Array.isArray(parsed)) return parseBlockedCountriesRaw(parsed)
      } catch {
        /* fall through to delimiter split */
      }
    }
    return t
      .split(/[,\s;]+/)
      .map((s) => s.toUpperCase().trim())
      .filter((s) => s.length === 2)
  }
  return []
}

function linesFromSetting(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const ipLineOk = (s: string) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^([0-9a-f:]+)(\/\d{1,3})?$/i.test(s)

const REGIONS_SEC: CountryRegion[] = ['Europe', 'Americas', 'Asia', 'Middle East', 'Oceania', 'Africa']

function IpRuleList({
  label,
  hint,
  lines,
  setLines,
  disabled,
  saving,
  onSave,
  saveKey,
  onDraftEdit,
}: {
  label: string
  hint?: string
  lines: string[]
  setLines: (next: string[]) => void
  disabled?: boolean
  saving: boolean
  onSave: () => void
  saveKey: string
  /** Called when chips or draft input mutates the pending list (before save). */
  onDraftEdit?: () => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const s = draft.trim()
    if (!s) return
    if (!ipLineOk(s)) {
      toast.error('Enter a valid IPv4/CIDR or IPv6/CIDR')
      return
    }
    if (lines.includes(s)) {
      setDraft('')
      return
    }
    onDraftEdit?.()
    setLines([...lines, s])
    setDraft('')
  }
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {hint ? <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
      <div className="min-h-[4rem] rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-white/[0.02]">
        <div className="flex flex-wrap gap-1.5">
          {lines.map((line) => (
            <span
              key={line}
              className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-100"
            >
              {line}
              <button
                type="button"
                disabled={disabled}
                className="text-red-600 hover:underline disabled:opacity-50"
                onClick={() => {
                  onDraftEdit?.()
                  setLines(lines.filter((x) => x !== line))
                }}
                aria-label={`Remove ${line}`}
              >
                ×
              </button>
            </span>
          ))}
          {lines.length === 0 ? (
            <span className="text-xs italic text-gray-400">No entries — add CIDR or single IP below.</span>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className={`${inputCls} max-w-md flex-1 font-mono text-xs`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="203.0.113.0/24"
          disabled={disabled}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button type="button" className={outlineBtn} disabled={disabled} onClick={add}>
          Add
        </button>
        <button type="button" className={settingsSaveBtn} disabled={disabled || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save list'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">Stored one rule per line in site settings ({saveKey}).</p>
    </div>
  )
}

function MaintenanceSchedulePanel({
  settings,
  patchSetting,
  isSuper,
  maintenanceEffective,
  reloadOperationalFlags,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown, opts?: { quietSuccess?: boolean; skipRefresh?: boolean }) => Promise<boolean>
  isSuper: boolean
  /** Live maintenance (DB + MAINTENANCE_MODE env), matches player gate. */
  maintenanceEffective: boolean
  reloadOperationalFlags: () => Promise<OperationalFlags | null>
}) {
  const maintenanceOn = maintenanceEffective
  const untilRaw = getSettingVal(settings, 'system', 'maintenance_until', '') as string
  const [localDt, setLocalDt] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const u = (untilRaw ?? '').trim()
    if (!u) {
      setLocalDt('')
      return
    }
    const d = new Date(u)
    if (Number.isNaN(d.getTime())) {
      setLocalDt('')
      return
    }
    const pad = (n: number) => String(n).padStart(2, '0')
    setLocalDt(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    )
  }, [untilRaw])

  const save = async () => {
    if (!isSuper) return toast.error('Superadmin required')
    setBusy(true)
    try {
      if (!localDt.trim()) {
        const ok = await patchSetting('system.maintenance_until', '')
        if (ok) void reloadOperationalFlags()
      } else {
        const iso = new Date(localDt).toISOString()
        if (!maintenanceOn) {
          const okMode = await patchSetting('system.maintenance_mode', true, { quietSuccess: true })
          if (!okMode) return
        }
        const okUntil = await patchSetting('system.maintenance_until', iso, { quietSuccess: true })
        if (!okUntil) return
        toast.success(
          maintenanceOn
            ? 'Maintenance schedule saved.'
            : 'Maintenance mode is on and the countdown schedule is saved.',
        )
        void reloadOperationalFlags()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      id="settings-maintenance-schedule"
      title="Maintenance schedule"
      desc="Countdown on the player maintenance page; “notify me” emails also fire when this time elapses while maintenance is still on."
      defaultOpen={maintenanceOn || Boolean((untilRaw ?? '').trim())}
    >
      {!isSuper ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Superadmin required to edit the maintenance schedule.</p>
      ) : (
        <div className="max-w-md space-y-3">
          {!maintenanceOn ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Saving a date and time below turns <strong>Maintenance Mode</strong> on automatically so players see the
              gate and countdown (same as the kill switch above).
            </p>
          ) : null}
          <label className={labelCls}>Expected back online (browser local time)</label>
          <input
            type="datetime-local"
            className={inputCls}
            value={localDt}
            onChange={(e) => setLocalDt(e.target.value)}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save schedule'}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={busy}
              onClick={() => {
                setLocalDt('')
                void patchSetting('system.maintenance_until', '').then((ok) => {
                  if (ok) void reloadOperationalFlags()
                })
              }}
            >
              Clear
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Emails also send when maintenance is turned off for subscribers who tapped Notify Me.
          </p>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Security & Access
// ---------------------------------------------------------------------------

function SecurityAccessPanel({
  settings,
  patchSetting,
  isSuper,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const serverBlocked = useMemo(
    () => parseBlockedCountriesRaw(getSettingVal(settings, 'security', 'blocked_countries', '')),
    [settings],
  )
  const serverIpBlack = useMemo(
    () => linesFromSetting(getSettingVal(settings, 'security', 'ip_blacklist', '')),
    [settings],
  )
  const serverIpWhite = useMemo(
    () => linesFromSetting(getSettingVal(settings, 'security', 'ip_whitelist', '')),
    [settings],
  )

  const [blockedCodes, setBlockedCodes] = useState<string[]>([])
  const [ipBlacklistLines, setIpBlacklistLines] = useState<string[]>([])
  const [ipWhitelistLines, setIpWhitelistLines] = useState<string[]>([])
  const [blockedDirty, setBlockedDirty] = useState(false)
  const [ipBlackDirty, setIpBlackDirty] = useState(false)
  const [ipWhiteDirty, setIpWhiteDirty] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!blockedDirty) setBlockedCodes(serverBlocked)
  }, [serverBlocked, blockedDirty])

  useEffect(() => {
    if (!ipBlackDirty) setIpBlacklistLines(serverIpBlack)
  }, [serverIpBlack, ipBlackDirty])

  useEffect(() => {
    if (!ipWhiteDirty) setIpWhitelistLines(serverIpWhite)
  }, [serverIpWhite, ipWhiteDirty])

  const corsOrigins = getSettingVal(settings, 'security', 'cors_origins', '') as string

  const saveKey = async (fullKey: string, value: string): Promise<boolean> => {
    if (!isSuper) {
      toast.error('Superadmin required')
      return false
    }
    const short = fullKey.replace(/^security\./, '')
    setSaving(short)
    const ok = await patchSetting(fullKey, value)
    setSaving(null)
    if (ok) {
      if (short === 'blocked_countries') setBlockedDirty(false)
      if (short === 'ip_blacklist') setIpBlackDirty(false)
      if (short === 'ip_whitelist') setIpWhiteDirty(false)
    }
    return ok
  }

  const toggleBlocked = (code: string) => {
    setBlockedDirty(true)
    const c = code.toUpperCase()
    setBlockedCodes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const applyRegionBlocked = (region: CountryRegion, add: boolean) => {
    setBlockedDirty(true)
    const codes = COUNTRY_OPTIONS.filter((x) => x.region === region).map((x) => x.code)
    setBlockedCodes((prev) => {
      const s = new Set(prev)
      for (const code of codes) {
        if (add) s.add(code)
        else s.delete(code)
      }
      return Array.from(s).sort()
    })
  }

  return (
    <Section
      id="settings-security"
      title="Security & Access"
      desc="Geo-blocking by region/country (flags), IP allow/deny lists, and CORS"
    >
      <div className="space-y-6">
        <div>
          <label className={labelCls}>Blocked countries (launch + eligibility)</label>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Enforcement uses the viewer&apos;s country from edge headers when present:{' '}
            <code className="rounded bg-gray-100 px-1 dark:bg-white/10">X-Geo-Country</code>, Cloudflare{' '}
            <code className="rounded bg-gray-100 px-1 dark:bg-white/10">CF-IPCountry</code>, CloudFront{' '}
            <code className="rounded bg-gray-100 px-1 dark:bg-white/10">CloudFront-Viewer-Country</code>, or Vercel{' '}
            <code className="rounded bg-gray-100 px-1 dark:bg-white/10">X-Vercel-IP-Country</code>. Local Vite can stub a
            country with <code className="rounded bg-gray-100 px-1 dark:bg-white/10">DEV_GEO_COUNTRY=GB</code> in{' '}
            <code className="rounded bg-gray-100 px-1 dark:bg-white/10">frontend/player-ui/.env.development</code>.
          </p>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {REGIONS_SEC.map((reg) => (
              <div
                key={reg}
                className="flex min-h-[2.75rem] overflow-hidden rounded-lg border border-gray-200 shadow-sm dark:border-gray-600"
              >
                <button
                  type="button"
                  className="flex-1 bg-red-600 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-800 dark:hover:bg-red-700"
                  disabled={!isSuper}
                  onClick={() => applyRegionBlocked(reg, true)}
                  title={`Block every country in ${reg}`}
                >
                  Block · {reg}
                </button>
                <button
                  type="button"
                  className="flex-1 border-l border-gray-200 bg-gray-100 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-900 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  disabled={!isSuper}
                  onClick={() => applyRegionBlocked(reg, false)}
                  title={`Remove ${reg} countries from the blocked list`}
                >
                  Unblock · {reg}
                </button>
              </div>
            ))}
          </div>
          <CountryPicker mode="deny" selected={blockedCodes} disabled={!isSuper} onToggle={toggleBlocked} />
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {blockedDirty ? 'Unsaved edits — save to write denylist' : 'Saved denylist (database)'}
              </p>
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {blockedCodes.length === 0
                  ? 'No countries blocked yet'
                  : `${blockedCodes.length} ${blockedCodes.length === 1 ? 'country' : 'countries'} blocked`}
              </p>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto text-xs text-gray-600 dark:text-gray-300">
                {blockedCodes.length ? (
                  blockedCodes.map((c) => {
                    const name = COUNTRY_OPTIONS.find((x) => x.code === c)?.name ?? c
                    return (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 dark:border-gray-600 dark:bg-gray-900/60"
                      >
                        <span aria-hidden>{flagEmoji(c)}</span>
                        <span>{name}</span>
                      </span>
                    )
                  })
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">Pick regions above or tap countries in the list.</span>
                )}
              </div>
            </div>
            <button
              type="button"
              className={`${settingsSaveBtn} shrink-0`}
              disabled={saving === 'blocked_countries' || !isSuper}
              onClick={() => void saveKey('security.blocked_countries', blockedCodes.join(','))}
            >
              {saving === 'blocked_countries' ? 'Saving…' : 'Save blocked countries'}
            </button>
          </div>
        </div>

        <IpRuleList
          label="IP blacklist"
          hint="Each entry is one IPv4/IPv6 address or CIDR range. Deny at edge or app — confirm with your deployment."
          lines={ipBlacklistLines}
          setLines={setIpBlacklistLines}
          disabled={!isSuper}
          saving={saving === 'ip_blacklist'}
          saveKey="security.ip_blacklist"
          onSave={() => void saveKey('security.ip_blacklist', ipBlacklistLines.join('\n'))}
          onDraftEdit={() => setIpBlackDirty(true)}
        />

        <IpRuleList
          label="IP whitelist — staff / break-glass"
          hint="Trusted IPs (one per chip). Enforcement depends on gateway integration."
          lines={ipWhitelistLines}
          setLines={setIpWhitelistLines}
          disabled={!isSuper}
          saving={saving === 'ip_whitelist'}
          saveKey="security.ip_whitelist"
          onSave={() => void saveKey('security.ip_whitelist', ipWhitelistLines.join('\n'))}
          onDraftEdit={() => setIpWhiteDirty(true)}
        />

        <div>
          <label className={labelCls}>CORS Origins (read-only)</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {corsOrigins || <span className="italic text-gray-400">Not configured</span>}
          </div>
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Withdrawal Limits
// ---------------------------------------------------------------------------

const WITHDRAWAL_FIELDS = [
  { key: 'max_single_withdrawal', label: 'Max Single Withdrawal', unit: '$', isCents: true },
  { key: 'daily_withdrawal_limit', label: 'Daily Withdrawal Limit', unit: '$', isCents: true },
  { key: 'daily_withdrawal_count', label: 'Daily Withdrawal Count', unit: 'txns', isCents: false },
  { key: 'min_account_age_withdraw', label: 'Min Account Age for Withdrawals', unit: 'seconds', isCents: false },
] as const

function WithdrawalLimitsPanel({
  settings,
  patchSetting,
  isSuper,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const v: Record<string, string> = {}
    for (const f of WITHDRAWAL_FIELDS) {
      const raw = getSettingVal(settings, 'withdrawals', f.key, 0) as number
      v[f.key] = f.isCents ? centsToStr(raw) : String(raw)
    }
    setValues(v)
  }, [settings])

  const save = async (key: string, isCents: boolean) => {
    if (!isSuper) return toast.error('Superadmin required')
    const raw = values[key] ?? '0'
    const numVal = isCents ? strToCents(raw) : parseInt(raw, 10)
    if (isNaN(numVal)) return toast.error('Invalid number')
    setSaving(key)
    await patchSetting(`withdrawals.${key}`, numVal)
    setSaving(null)
  }

  return (
    <Section id="settings-withdrawals" title="Withdrawal Limits" desc="Max amounts and frequency caps">
      <div className="grid gap-4 sm:grid-cols-2">
        {WITHDRAWAL_FIELDS.map((f) => (
          <div key={f.key}>
            <label className={labelCls}>
              {f.label} <span className="text-gray-400">({f.unit})</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step={f.isCents ? '0.01' : '1'}
                className={inputCls}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                disabled={!isSuper}
              />
              <button
                className={primaryBtn}
                disabled={saving === f.key || !isSuper}
                onClick={() => save(f.key, f.isCents)}
              >
                {saving === f.key ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function SocialProofPanel({
  settings,
  patchSetting,
  isSuper,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  type SocialCfg = {
    enabled: boolean
    online_target: number
    online_variance_pct: number
    online_bucket_secs: number
    wager_display_multiplier: number
    recent_wins_enabled: boolean
    recent_wins_base_duration_sec: number
    recent_wins_feed_size: number
    recent_wins_real_cap: number
    recent_wins_min_real_minor: number
    recent_wins_bot_min_minor: number
    recent_wins_bot_max_minor: number
    recent_wins_real_weight: number
  }

  const defaults: SocialCfg = {
    enabled: false,
    online_target: 180,
    online_variance_pct: 22,
    online_bucket_secs: 90,
    wager_display_multiplier: 1,
    recent_wins_enabled: false,
    recent_wins_base_duration_sec: 42,
    recent_wins_feed_size: 28,
    recent_wins_real_cap: 14,
    recent_wins_min_real_minor: 500,
    recent_wins_bot_min_minor: 800,
    recent_wins_bot_max_minor: 25000000,
    recent_wins_real_weight: 3,
  }

  const [cfg, setCfg] = useState<SocialCfg>(defaults)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const raw = getSettingVal(settings, 'social_proof', 'config', null)
    const next =
      raw && typeof raw === 'object' ? { ...defaults, ...(raw as Partial<SocialCfg>) } : defaults
    setCfg(next)
  }, [settings])

  const saveAll = async () => {
    if (!isSuper) {
      toast.error('Superadmin required')
      return
    }
    const ot = Math.round(Number(cfg.online_target))
    if (!Number.isFinite(ot) || ot < 1 || ot > 500_000) {
      toast.error('Online target must be between 1 and 500000')
      return
    }
    const vp = Number(cfg.online_variance_pct)
    if (!Number.isFinite(vp) || vp < 5 || vp > 55) {
      toast.error('Variance % should be between 5 and 55')
      return
    }
    const bs = Math.round(Number(cfg.online_bucket_secs))
    if (!Number.isFinite(bs) || bs < 30 || bs > 600) {
      toast.error('Refresh bucket must be 30–600 seconds')
      return
    }
    const wm = Number(cfg.wager_display_multiplier)
    if (!Number.isFinite(wm) || wm < 0.01 || wm > 100) {
      toast.error('Wager multiplier must be between 0.01 and 100')
      return
    }
    const rwDur = Number(cfg.recent_wins_base_duration_sec)
    if (!Number.isFinite(rwDur) || rwDur < 8 || rwDur > 240) {
      toast.error('Recent wins base duration must be 8–240 seconds')
      return
    }
    const rwFeed = Math.round(Number(cfg.recent_wins_feed_size))
    if (!Number.isFinite(rwFeed) || rwFeed < 8 || rwFeed > 80) {
      toast.error('Recent wins feed size must be 8–80')
      return
    }
    const rwRealCap = Math.round(Number(cfg.recent_wins_real_cap))
    if (!Number.isFinite(rwRealCap) || rwRealCap < 0 || rwRealCap > 40) {
      toast.error('Recent wins real cap must be 0–40')
      return
    }
    const rwMinReal = Math.round(Number(cfg.recent_wins_min_real_minor))
    if (!Number.isFinite(rwMinReal) || rwMinReal < 0) {
      toast.error('Min real win (minor units) must be ≥ 0')
      return
    }
    const rwBotLo = Math.round(Number(cfg.recent_wins_bot_min_minor))
    const rwBotHi = Math.round(Number(cfg.recent_wins_bot_max_minor))
    if (!Number.isFinite(rwBotLo) || !Number.isFinite(rwBotHi) || rwBotLo < 1 || rwBotHi < rwBotLo) {
      toast.error('Bot win minors: min ≥ 1 and max ≥ min')
      return
    }
    const rwW = Math.round(Number(cfg.recent_wins_real_weight))
    if (!Number.isFinite(rwW) || rwW < 1 || rwW > 10) {
      toast.error('Real vs bot mix weight must be 1–10')
      return
    }
    const payload: SocialCfg = {
      enabled: cfg.enabled,
      online_target: ot,
      online_variance_pct: vp,
      online_bucket_secs: bs,
      wager_display_multiplier: wm,
      recent_wins_enabled: cfg.recent_wins_enabled,
      recent_wins_base_duration_sec: rwDur,
      recent_wins_feed_size: rwFeed,
      recent_wins_real_cap: rwRealCap,
      recent_wins_min_real_minor: rwMinReal,
      recent_wins_bot_min_minor: rwBotLo,
      recent_wins_bot_max_minor: rwBotHi,
      recent_wins_real_weight: rwW,
    }
    setSaving(true)
    await patchSetting('social_proof.config', payload)
    setSaving(false)
  }

  return (
    <Section
      id="settings-social-proof"
      title="Menu social proof"
      desc="Compact stats pinned under the casino sidebar on desktop and a slim strip in the mobile drawer. Online count drifts around your target; wagered uses real stakes from the ledger multiplied for display. Lobby “Recent wins” (optional) mixes real game.credit/game.win lines with synthetic wins; marquee speed scales with the displayed online count."
      defaultOpen={false}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Toggle checked={cfg.enabled} disabled={!isSuper} onChange={(next) => setCfg((c) => ({ ...c, enabled: next }))} />
        <span className="text-sm text-gray-700 dark:text-gray-200">Show stats to players</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Online target (approximate centre)</label>
          <input
            type="number"
            min={1}
            className={inputCls}
            value={cfg.online_target}
            disabled={!isSuper}
            onChange={(e) => setCfg((c) => ({ ...c, online_target: parseInt(e.target.value, 10) || 0 }))}
          />
        </div>
        <div>
          <label className={labelCls}>Online variance (% of target)</label>
          <input
            type="number"
            step="1"
            min={5}
            max={55}
            className={inputCls}
            value={cfg.online_variance_pct}
            disabled={!isSuper}
            onChange={(e) => setCfg((c) => ({ ...c, online_variance_pct: parseFloat(e.target.value) || 0 }))}
          />
        </div>
        <div>
          <label className={labelCls}>Stable refresh bucket (seconds)</label>
          <input
            type="number"
            min={30}
            max={600}
            step={10}
            className={inputCls}
            value={cfg.online_bucket_secs}
            disabled={!isSuper}
            onChange={(e) => setCfg((c) => ({ ...c, online_bucket_secs: parseInt(e.target.value, 10) || 0 }))}
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            The displayed online count updates when this bucket rolls so players stay aligned.
          </p>
        </div>
        <div>
          <label className={labelCls}>Wager display multiplier</label>
          <input
            type="number"
            step="0.01"
            min={0.01}
            max={100}
            className={inputCls}
            value={cfg.wager_display_multiplier}
            disabled={!isSuper}
            onChange={(e) => setCfg((c) => ({ ...c, wager_display_multiplier: parseFloat(e.target.value) || 0 }))}
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Applies to the sum of casino & sports stakes (same basis as admin KPI “total wagered”).
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-white/[0.03]">
        <p className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Lobby recent wins strip</p>
        <p className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
          Shown on the casino home page below Hot now. Uses the same online target for scroll speed (higher displayed online → faster pass). Enable to mix ledger wins with bot tiles when the catalog has thumbnails.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Toggle
            checked={cfg.recent_wins_enabled}
            disabled={!isSuper}
            onChange={(next) => setCfg((c) => ({ ...c, recent_wins_enabled: next }))}
          />
          <span className="text-sm text-gray-700 dark:text-gray-200">Show recent wins marquee</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Base marquee duration (seconds at online target)</label>
            <input
              type="number"
              step="1"
              min={8}
              max={240}
              className={inputCls}
              value={cfg.recent_wins_base_duration_sec}
              disabled={!isSuper}
              onChange={(e) =>
                setCfg((c) => ({ ...c, recent_wins_base_duration_sec: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>
          <div>
            <label className={labelCls}>Cards in feed</label>
            <input
              type="number"
              min={8}
              max={80}
              className={inputCls}
              value={cfg.recent_wins_feed_size}
              disabled={!isSuper}
              onChange={(e) => setCfg((c) => ({ ...c, recent_wins_feed_size: parseInt(e.target.value, 10) || 0 }))}
            />
          </div>
          <div>
            <label className={labelCls}>Max real wins pulled from ledger</label>
            <input
              type="number"
              min={0}
              max={40}
              className={inputCls}
              value={cfg.recent_wins_real_cap}
              disabled={!isSuper}
              onChange={(e) => setCfg((c) => ({ ...c, recent_wins_real_cap: parseInt(e.target.value, 10) || 0 }))}
            />
          </div>
          <div>
            <label className={labelCls}>Real vs bot mix weight (1–10)</label>
            <input
              type="number"
              min={1}
              max={10}
              className={inputCls}
              value={cfg.recent_wins_real_weight}
              disabled={!isSuper}
              onChange={(e) => setCfg((c) => ({ ...c, recent_wins_real_weight: parseInt(e.target.value, 10) || 1 }))}
            />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              Higher favors showing real wins when available (weighted lottery vs each bot slot).
            </p>
          </div>
          <div>
            <label className={labelCls}>Min real win (minor units)</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={cfg.recent_wins_min_real_minor}
              disabled={!isSuper}
              onChange={(e) =>
                setCfg((c) => ({ ...c, recent_wins_min_real_minor: parseInt(e.target.value, 10) || 0 }))
              }
            />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Example: 500 = $5.00 in USD cents.</p>
          </div>
          <div>
            <label className={labelCls}>Bot win range (minor units)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={cfg.recent_wins_bot_min_minor}
                disabled={!isSuper}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, recent_wins_bot_min_minor: parseInt(e.target.value, 10) || 0 }))
                }
              />
              <input
                type="number"
                min={1}
                className={inputCls}
                value={cfg.recent_wins_bot_max_minor}
                disabled={!isSuper}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, recent_wins_bot_max_minor: parseInt(e.target.value, 10) || 0 }))
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button type="button" className={primaryBtn} disabled={saving || !isSuper} onClick={() => void saveAll()}>
          {saving ? 'Saving…' : 'Save social proof'}
        </button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Integration Status (read-only)
// ---------------------------------------------------------------------------

function IntegrationStatusPanel({ settings }: { settings: SettingsMap }) {
  const integrations = [
    {
      name: 'PassimPay',
      status: getSettingVal(settings, 'integrations', 'passimpay_configured', false) as boolean,
      detail: getSettingVal(settings, 'integrations', 'passimpay_configured', false)
        ? 'Platform + API key configured'
        : 'Not configured',
    },
    {
      name: 'BlueOcean',
      status: !!getSettingVal(settings, 'integrations', 'blueocean_launch_mode', ''),
      detail: `Launch mode: ${getSettingVal(settings, 'integrations', 'blueocean_launch_mode', 'N/A')}`,
    },
    {
      name: 'Redis',
      status: getSettingVal(settings, 'integrations', 'redis_connected', false) as boolean,
      detail: getSettingVal(settings, 'integrations', 'redis_connected', false)
        ? 'Connected'
        : 'Not connected',
    },
    {
      name: 'SMTP',
      status: getSettingVal(settings, 'integrations', 'smtp_configured', false) as boolean,
      detail: getSettingVal(settings, 'integrations', 'smtp_configured', false)
        ? 'Configured'
        : 'Not configured',
    },
  ]

  return (
    <Section id="settings-integrations" title="Integration Status" desc="External service connection state (read-only)">
      <div className="grid gap-3 sm:grid-cols-2">
        {integrations.map((i) => (
          <div
            key={i.name}
            className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-white/[0.02]"
          >
            <div>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{i.name}</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">{i.detail}</p>
            </div>
            <StatusBadge
              label={i.status ? 'OK' : 'N/A'}
              variant={i.status ? 'success' : 'neutral'}
              dot
            />
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Payment Flags
// ---------------------------------------------------------------------------

/** Same rails as Kill Switches; PATCH settings mirrors these into payment_ops_flags */
const PAYMENT_FLAGS_FROM_KILL_SWITCHES = new Set([
  'deposits_enabled',
  'withdrawals_enabled',
  'real_play_enabled',
  'bonuses_enabled',
  'automated_grants_enabled',
])

function PaymentFlagsPanel({
  apiFetch,
  isSuper,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isSuper: boolean
}) {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasLocalEdits, setHasLocalEdits] = useState(false)

  const fetchFlags = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/ops/payment-flags')
      if (!res.ok) return
      const j = (await res.json()) as Record<string, boolean>
      setFlags(j)
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void fetchFlags()
  }, [fetchFlags])

  useEffect(() => {
    if (Object.keys(flags).length === 0) return
    if (!hasLocalEdits) {
      setDraft(flags)
    }
  }, [flags, hasLocalEdits])

  const filteredEntries = useMemo(
    () => Object.entries(flags).filter(([k]) => !PAYMENT_FLAGS_FROM_KILL_SWITCHES.has(k)),
    [flags],
  )

  const dirtyKeys = useMemo(
    () => filteredEntries.filter(([k, v]) => draft[k] !== v).map(([k]) => k),
    [filteredEntries, draft],
  )

  const discard = () => {
    setHasLocalEdits(false)
    setDraft(flags)
  }

  const saveAll = async () => {
    if (!isSuper) {
      toast.error('Superadmin required')
      return
    }
    const body: Record<string, boolean> = {}
    for (const [k, v] of filteredEntries) {
      if (draft[k] !== v) body[k] = draft[k] ?? false
    }
    if (Object.keys(body).length === 0) return
    setSaving(true)
    try {
      const res = await apiFetch('/v1/admin/ops/payment-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error('Failed to save payment flags')
        return
      }
      toast.success(`Saved ${Object.keys(body).length} payment flag${Object.keys(body).length === 1 ? '' : 's'}`)
      await fetchFlags()
      setHasLocalEdits(false)
    } catch {
      toast.error('Error saving payment flags')
    } finally {
      setSaving(false)
    }
  }

  const saveDisabled = !isSuper || saving || dirtyKeys.length === 0
  const discardDisabled = !isSuper || saving || (!hasLocalEdits && dirtyKeys.length === 0)

  const allEntries = useMemo(() => Object.entries(flags), [flags])

  if (loading) return <SkeletonCard />
  if (Object.keys(flags).length === 0) return null

  return (
    <Section
      id="settings-payments"
      title="Payment Flags"
      desc="Provider-specific toggles not covered by Kill Switches. Adjust switches, then Save changes."
    >
      {filteredEntries.length === 0 ? (
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          All operational rails in this environment are exposed under{' '}
          <strong className="text-gray-800 dark:text-gray-200">Kill Switches</strong> (deposits, withdrawals, real play,
          bonuses, automated grants). Use that grid so site settings and the ledger stay in sync.
        </p>
      ) : (
        <>
          {!isSuper ? (
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Superadmin role required to edit payment flags.</p>
          ) : (
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Draft changes stay local until you save. Green badge means <strong>On</strong>.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-3">
            {filteredEntries.map(([key, serverVal]) => {
              const label = key.replace(/_/g, ' ')
              const val = draft[key] ?? serverVal
              const rowDirty = draft[key] !== serverVal
              return (
                <div
                  key={key}
                  className={[
                    'flex min-h-[4.5rem] flex-col gap-3 rounded-xl border px-4 py-3 sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3',
                    rowDirty
                      ? 'border-blue-300/80 bg-blue-50/60 dark:border-blue-600/50 dark:bg-blue-950/25'
                      : 'border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-white/[0.02]',
                  ].join(' ')}
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="text-sm font-medium capitalize leading-snug text-gray-800 dark:text-gray-100">
                      {label}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={[
                          'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                          val
                            ? 'bg-emerald-500/18 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-gray-500/15 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
                        ].join(' ')}
                      >
                        {val ? 'On' : 'Off'}
                      </span>
                      {rowDirty ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                          Unsaved
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={`text-xs font-medium ${val ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      {val ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200/80 pt-3 dark:border-white/[0.06] sm:border-t-0 sm:pt-0">
                    <Toggle
                      checked={val}
                      ariaLabel={`${label}: ${val ? 'on' : 'off'}`}
                      disabled={!isSuper}
                      onChange={(next) => {
                        setHasLocalEdits(true)
                        setDraft((p) => ({ ...p, [key]: next }))
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-4 dark:border-white/[0.08]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`${settingsSaveBtn} ${saveDisabled ? 'opacity-60' : ''}`}
                disabled={saveDisabled}
                onClick={() => void saveAll()}
              >
                {saving ? 'Saving…' : dirtyKeys.length === 0 ? 'Save changes' : `Save changes (${dirtyKeys.length})`}
              </button>
              <button
                type="button"
                className={`${settingsDiscardBtn} ${discardDisabled ? 'opacity-60' : ''}`}
                disabled={discardDisabled}
                onClick={discard}
              >
                Discard
              </button>
            </div>
            {isSuper ? (
              <p className="mb-0 text-xs text-gray-500 dark:text-gray-400">
                {dirtyKeys.length > 0
                  ? `${dirtyKeys.length} flag${dirtyKeys.length === 1 ? '' : 's'} pending. Save to apply or Discard to revert.`
                  : hasLocalEdits
                    ? 'Draft matches saved values. Use Discard to reload from the server or adjust a switch again.'
                    : 'Turn a switch on or off to enable Save and Discard.'}
              </p>
            ) : null}
          </div>

          {allEntries.length > filteredEntries.length ? (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Deposits, withdrawals, real play, bonuses, and automated grants are edited under Kill Switches only.
            </p>
          ) : null}
        </>
      )}
    </Section>
  )
}

// ===========================================================================
// TAB 2: CONTENT MANAGEMENT
// ===========================================================================

function ContentManagementTab({
  content,
  saveContent,
  uploadFile,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  uploadFile: (file: File) => Promise<string | null>
  isSuper: boolean
}) {
  return (
    <div className="row g-3">
      <div className="col-lg-3 d-none d-lg-block">
        <SettingsContentOutline />
      </div>
      <div className="col-lg-9">
        <div className="d-flex flex-column gap-0">
          <BrandingSection content={content} saveContent={saveContent} uploadFile={uploadFile} isSuper={isSuper} />
          <SocialLinksSection content={content} saveContent={saveContent} isSuper={isSuper} />
          <HeroPromotionsSection content={content} saveContent={saveContent} isSuper={isSuper} />
          <FooterContentSection content={content} saveContent={saveContent} isSuper={isSuper} />
          <LegalPagesSection content={content} saveContent={saveContent} isSuper={isSuper} />
          <NavigationConfigSection content={content} saveContent={saveContent} isSuper={isSuper} />
          <OperationalMessagesSection content={content} saveContent={saveContent} isSuper={isSuper} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

function BrandingSection({
  content,
  saveContent,
  uploadFile,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  uploadFile: (file: File) => Promise<string | null>
  isSuper: boolean
}) {
  const [siteName, setSiteName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [faviconUrl, setFaviconUrl] = useState('')
  const [tagline, setTagline] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setSiteName(getContentVal(content, 'branding', 'site_name', '') as string)
    setLogoUrl(getContentVal(content, 'branding', 'logo_url', '') as string)
    setFaviconUrl(getContentVal(content, 'branding', 'favicon_url', '') as string)
    setTagline(getContentVal(content, 'branding', 'tagline', '') as string)
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    await Promise.all([
      saveContent('branding.site_name', siteName),
      saveContent('branding.logo_url', logoUrl),
      saveContent('branding.favicon_url', faviconUrl),
      saveContent('branding.tagline', tagline),
    ])
    setSaving(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const url = await uploadFile(file)
    if (url) setLogoUrl(url)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Section id="settings-content-branding" title="Branding" desc="Site identity and visuals" defaultOpen>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Site Name</label>
          <input className={inputCls} value={siteName} onChange={(e) => setSiteName(e.target.value)} disabled={!isSuper} />
        </div>
        <div>
          <label className={labelCls}>Tagline</label>
          <input className={inputCls} value={tagline} onChange={(e) => setTagline(e.target.value)} disabled={!isSuper} />
        </div>
        <div>
          <label className={labelCls}>Logo URL</label>
          <input
            className={inputCls}
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            disabled={!isSuper}
            placeholder="Leave blank for built-in vybebet logo"
          />
          <p className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
            When empty, players see the default casino logo (<code className="rounded bg-gray-100 px-1 dark:bg-gray-800">/vybebet-logo.png</code>). Paste a URL or upload — preview keeps aspect ratio.
          </p>
          <img
            src={logoUrl.trim() || PLAYER_BRANDING_DEFAULT_LOGO_PREVIEW}
            alt="Logo preview"
            className="mt-2 h-auto max-h-32 w-auto max-w-full rounded object-contain object-left bg-gray-100 px-2 py-1 dark:bg-gray-800"
          />
        </div>
        <div>
          <label className={labelCls}>Favicon URL</label>
          <input className={inputCls} value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} disabled={!isSuper} />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button className={primaryBtn} disabled={saving || !isSuper} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Branding'}
        </button>
        <label
          className={`${primaryBtn} cursor-pointer ${!isSuper || uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {uploading ? 'Uploading…' : 'Upload Image'}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={!isSuper} />
        </label>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Social Links
// ---------------------------------------------------------------------------

const SOCIAL_PLATFORMS = ['discord', 'twitter', 'instagram', 'telegram'] as const

function SocialLinksSection({
  content,
  saveContent,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [links, setLinks] = useState<Record<string, { url: string; enabled: boolean }>>({})
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const l: Record<string, { url: string; enabled: boolean }> = {}
    for (const p of SOCIAL_PLATFORMS) {
      const raw = getContentVal(content, 'social', p, { url: '', enabled: false }) as {
        url: string
        enabled: boolean
      }
      l[p] = { url: raw.url ?? '', enabled: raw.enabled ?? false }
    }
    setLinks(l)
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    await Promise.all(SOCIAL_PLATFORMS.map((p) => saveContent(`social.${p}`, links[p])))
    setSaving(false)
  }

  const update = (platform: string, field: 'url' | 'enabled', value: string | boolean) => {
    setLinks((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], [field]: value },
    }))
  }

  return (
    <Section id="settings-content-social" title="Social Links" desc="Community and social media links">
      <div className="space-y-3">
        {SOCIAL_PLATFORMS.map((p) => (
          <div key={p} className="flex items-center gap-3">
            <span className="w-24 text-sm font-medium capitalize text-gray-700 dark:text-gray-200">{p === 'twitter' ? 'Twitter / X' : p}</span>
            <input
              className={`${inputCls} flex-1`}
              value={links[p]?.url ?? ''}
              onChange={(e) => update(p, 'url', e.target.value)}
              placeholder={`https://${p}.com/...`}
              disabled={!isSuper}
            />
            <Toggle
              checked={links[p]?.enabled ?? false}
              disabled={!isSuper}
              onChange={(v) => update(p, 'enabled', v)}
            />
          </div>
        ))}
      </div>
      <button className={primaryBtn} disabled={saving || !isSuper} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save Social Links'}
      </button>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Hero Promotions
// ---------------------------------------------------------------------------

const EMPTY_SLIDE: HeroSlide = {
  image_url: '',
  tag: '',
  tag_color: '#6366f1',
  title: '',
  subtitle: '',
  cta_text: '',
  cta_link: '',
  enabled: true,
  sort_order: 0,
}

function HeroPromotionsSection({
  content,
  saveContent,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [slides, setSlides] = useState<HeroSlide[]>([])
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const raw = getContentVal(content, 'hero', 'slides', []) as HeroSlide[]
    setSlides(raw.length ? raw : [{ ...EMPTY_SLIDE }])
  }, [content])

  const updateSlide = (idx: number, field: keyof HeroSlide, value: unknown) => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
  }

  const addSlide = () => setSlides((p) => [...p, { ...EMPTY_SLIDE, sort_order: p.length }])
  const removeSlide = (idx: number) => setSlides((p) => p.filter((_, i) => i !== idx))

  const handleSave = async () => {
    setSaving(true)
    await saveContent('hero.slides', slides)
    setSaving(false)
  }

  return (
    <Section id="settings-content-hero" title="Hero Promotions" desc="Homepage hero carousel slides">
      <div className="space-y-4">
        {slides.map((slide, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/[0.02] space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Slide {idx + 1}
              </span>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={slide.enabled}
                  disabled={!isSuper}
                  onChange={(v) => updateSlide(idx, 'enabled', v)}
                />
                {slides.length > 1 && (
                  <button
                    className={dangerBtn}
                    disabled={!isSuper}
                    onClick={() => removeSlide(idx)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {slide.image_url && (
              <img
                src={slide.image_url}
                alt={`Slide ${idx + 1}`}
                className="h-24 w-full rounded-lg object-cover"
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Image URL</label>
                <input className={inputCls} value={slide.image_url} onChange={(e) => updateSlide(idx, 'image_url', e.target.value)} disabled={!isSuper} />
              </div>
              <div>
                <label className={labelCls}>Title</label>
                <input className={inputCls} value={slide.title} onChange={(e) => updateSlide(idx, 'title', e.target.value)} disabled={!isSuper} />
              </div>
              <div>
                <label className={labelCls}>Subtitle</label>
                <input className={inputCls} value={slide.subtitle} onChange={(e) => updateSlide(idx, 'subtitle', e.target.value)} disabled={!isSuper} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={labelCls}>Tag</label>
                  <input className={inputCls} value={slide.tag} onChange={(e) => updateSlide(idx, 'tag', e.target.value)} disabled={!isSuper} />
                </div>
                <div className="w-24">
                  <label className={labelCls}>Color</label>
                  <input
                    type="color"
                    className="h-[38px] w-full cursor-pointer rounded-lg border border-gray-300 dark:border-gray-600"
                    value={slide.tag_color}
                    onChange={(e) => updateSlide(idx, 'tag_color', e.target.value)}
                    disabled={!isSuper}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>CTA Text</label>
                <input className={inputCls} value={slide.cta_text} onChange={(e) => updateSlide(idx, 'cta_text', e.target.value)} disabled={!isSuper} />
              </div>
              <div>
                <label className={labelCls}>CTA Link</label>
                <input className={inputCls} value={slide.cta_link} onChange={(e) => updateSlide(idx, 'cta_link', e.target.value)} disabled={!isSuper} />
              </div>
              <div>
                <label className={labelCls}>Sort Order</label>
                <input
                  type="number"
                  className={inputCls}
                  value={slide.sort_order}
                  onChange={(e) => updateSlide(idx, 'sort_order', parseInt(e.target.value, 10) || 0)}
                  disabled={!isSuper}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button className={primaryBtn} disabled={saving || !isSuper} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Slides'}
        </button>
        <button
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/10 disabled:opacity-50"
          disabled={!isSuper}
          onClick={addSlide}
        >
          + Add Slide
        </button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Footer Content
// ---------------------------------------------------------------------------

function FooterContentSection({
  content,
  saveContent,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [seoHeading, setSeoHeading] = useState('')
  const [seoSubheading, setSeoSubheading] = useState('')
  const [seoBody, setSeoBody] = useState('')
  const [copyright, setCopyright] = useState('')
  const [disclaimer, setDisclaimer] = useState('')
  const [badges, setBadges] = useState<Record<string, boolean>>({
    licensed: true,
    provably_fair: true,
    responsible_gaming: true,
  })
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setSeoHeading(getContentVal(content, 'footer', 'seo_heading', '') as string)
    setSeoSubheading(getContentVal(content, 'footer', 'seo_subheading', '') as string)
    setSeoBody(getContentVal(content, 'footer', 'seo_body', '') as string)
    setCopyright(getContentVal(content, 'footer', 'copyright', '') as string)
    setDisclaimer(getContentVal(content, 'footer', 'legal_disclaimer', '') as string)
    const rawBadges = getContentVal(content, 'footer', 'trust_badges', {
      licensed: true,
      provably_fair: true,
      responsible_gaming: true,
    }) as Record<string, boolean>
    setBadges(rawBadges)
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    await Promise.all([
      saveContent('footer.seo_heading', seoHeading),
      saveContent('footer.seo_subheading', seoSubheading),
      saveContent('footer.seo_body', seoBody),
      saveContent('footer.copyright', copyright),
      saveContent('footer.legal_disclaimer', disclaimer),
      saveContent('footer.trust_badges', badges),
    ])
    setSaving(false)
  }

  return (
    <Section id="settings-content-footer" title="Footer Content" desc="SEO, legal text, and trust badges">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>SEO Heading</label>
            <input className={inputCls} value={seoHeading} onChange={(e) => setSeoHeading(e.target.value)} disabled={!isSuper} />
          </div>
          <div>
            <label className={labelCls}>SEO Subheading</label>
            <input className={inputCls} value={seoSubheading} onChange={(e) => setSeoSubheading(e.target.value)} disabled={!isSuper} />
          </div>
        </div>

        <div>
          <label className={labelCls}>SEO Body</label>
          <textarea
            className={textareaCls}
            style={{ minHeight: '8rem' }}
            rows={4}
            value={seoBody}
            onChange={(e) => setSeoBody(e.target.value)}
            disabled={!isSuper}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Copyright Text</label>
            <input className={inputCls} value={copyright} onChange={(e) => setCopyright(e.target.value)} disabled={!isSuper} />
          </div>
          <div>
            <label className={labelCls}>Legal Disclaimer</label>
            <input className={inputCls} value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} disabled={!isSuper} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Trust Badges</label>
          <div className="flex flex-wrap gap-4">
            {Object.entries(badges).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <Toggle
                  checked={val}
                  disabled={!isSuper}
                  onChange={(v) => setBadges((p) => ({ ...p, [key]: v }))}
                />
                <span className="text-sm capitalize text-gray-700 dark:text-gray-200">
                  {key.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className={primaryBtn} disabled={saving || !isSuper} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save Footer Content'}
      </button>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Legal Pages
// ---------------------------------------------------------------------------

const LEGAL_PAGES = [
  { key: 'terms_of_service', label: 'Terms of Service' },
  { key: 'privacy_policy', label: 'Privacy Policy' },
  { key: 'responsible_gambling', label: 'Responsible Gambling' },
  { key: 'fairness', label: 'AML Policy' },
] as const

function LegalPagesSection({
  content,
  saveContent,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [pages, setPages] = useState<Record<string, { body: string; published: boolean }>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const p: Record<string, { body: string; published: boolean }> = {}
    for (const lp of LEGAL_PAGES) {
      const raw = getContentVal(content, 'legal', lp.key, { body: '', published: false }) as {
        body: string
        published: boolean
      }
      p[lp.key] = { body: raw.body ?? '', published: raw.published ?? false }
    }
    setPages(p)
  }, [content])

  const savePage = async (key: string) => {
    setSavingKey(key)
    await saveContent(`legal.${key}`, pages[key])
    setSavingKey(null)
  }

  return (
    <Section id="settings-content-legal" title="Legal Pages" desc="Editable legal content (supports markdown)">
      <div className="space-y-5">
        {LEGAL_PAGES.map((lp) => {
          const meta = getContentMeta(content, 'legal', lp.key)
          return (
            <div
              key={lp.key}
              className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/[0.02] space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{lp.label}</span>
                  {meta?.updated_at && (
                    <p className="text-xs text-gray-400">{formatRelativeTime(meta.updated_at)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Published</span>
                  <Toggle
                    checked={pages[lp.key]?.published ?? false}
                    disabled={!isSuper}
                    onChange={(v) =>
                      setPages((p) => ({ ...p, [lp.key]: { ...p[lp.key], published: v } }))
                    }
                  />
                </div>
              </div>
              <textarea
                className={textareaCls}
                style={{ minHeight: '10rem' }}
                rows={6}
                value={pages[lp.key]?.body ?? ''}
                onChange={(e) =>
                  setPages((p) => ({ ...p, [lp.key]: { ...p[lp.key], body: e.target.value } }))
                }
                placeholder={`${lp.label} content (markdown supported)`}
                disabled={!isSuper}
              />
              <button
                className={primaryBtn}
                disabled={savingKey === lp.key || !isSuper}
                onClick={() => savePage(lp.key)}
              >
                {savingKey === lp.key ? 'Saving…' : `Save ${lp.label}`}
              </button>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Navigation Config
// ---------------------------------------------------------------------------

function NavigationConfigSection({
  content,
  saveContent,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [items, setItems] = useState<NavItem[]>([])
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const raw = getContentVal(content, 'navigation', 'sidebar_items', []) as NavItem[]
    setItems(raw)
  }, [content])

  const updateItem = (idx: number, field: keyof NavItem, value: unknown) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  const addItem = () =>
    setItems((p) => [...p, { label: '', enabled: true, coming_soon: false, sort_order: p.length }])
  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx))

  const handleSave = async () => {
    setSaving(true)
    await saveContent('navigation.sidebar_items', items)
    setSaving(false)
  }

  return (
    <Section id="settings-content-nav" title="Navigation Config" desc="Sidebar navigation items">
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-white/[0.02]"
          >
            <input
              className={`${inputCls} w-40`}
              value={item.label}
              onChange={(e) => updateItem(idx, 'label', e.target.value)}
              placeholder="Label"
              disabled={!isSuper}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Enabled</span>
              <Toggle
                checked={item.enabled}
                disabled={!isSuper}
                onChange={(v) => updateItem(idx, 'enabled', v)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Coming Soon</span>
              <Toggle
                checked={item.coming_soon}
                disabled={!isSuper}
                onChange={(v) => updateItem(idx, 'coming_soon', v)}
              />
            </div>
            <input
              type="number"
              className={`${inputCls} w-20`}
              value={item.sort_order}
              onChange={(e) => updateItem(idx, 'sort_order', parseInt(e.target.value, 10) || 0)}
              disabled={!isSuper}
            />
            <button
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
              disabled={!isSuper}
              onClick={() => removeItem(idx)}
            >
              Remove
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-gray-400 italic">No navigation items configured.</p>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button className={primaryBtn} disabled={saving || !isSuper} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Navigation'}
        </button>
        <button
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/10 disabled:opacity-50"
          disabled={!isSuper}
          onClick={addItem}
        >
          + Add Item
        </button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Operational Messages
// ---------------------------------------------------------------------------

function OperationalMessagesSection({
  content,
  saveContent,
  isSuper,
}: {
  content: ContentMap
  saveContent: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [maintenanceMsg, setMaintenanceMsg] = useState('')
  const [gameDisabledMsg, setGameDisabledMsg] = useState('')
  const [emptyCatalogMsg, setEmptyCatalogMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setMaintenanceMsg(getContentVal(content, 'messages', 'maintenance', '') as string)
    setGameDisabledMsg(getContentVal(content, 'messages', 'game_disabled', '') as string)
    setEmptyCatalogMsg(getContentVal(content, 'messages', 'empty_catalog', '') as string)
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    await Promise.all([
      saveContent('messages.maintenance', maintenanceMsg),
      saveContent('messages.game_disabled', gameDisabledMsg),
      saveContent('messages.empty_catalog', emptyCatalogMsg),
    ])
    setSaving(false)
  }

  return (
    <Section id="settings-content-messages" title="Operational Messages" desc="Player-facing status and fallback messages">
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Maintenance Message</label>
          <textarea
            className={textareaCls}
            style={{ minHeight: '6rem' }}
            rows={3}
            value={maintenanceMsg}
            onChange={(e) => setMaintenanceMsg(e.target.value)}
            placeholder="We're currently performing scheduled maintenance…"
            disabled={!isSuper}
          />
        </div>
        <div>
          <label className={labelCls}>Game Disabled Message</label>
          <textarea
            className={textareaCls}
            style={{ minHeight: '6rem' }}
            rows={3}
            value={gameDisabledMsg}
            onChange={(e) => setGameDisabledMsg(e.target.value)}
            placeholder="This game is currently unavailable."
            disabled={!isSuper}
          />
        </div>
        <div>
          <label className={labelCls}>Empty Catalog Message</label>
          <textarea
            className={textareaCls}
            style={{ minHeight: '6rem' }}
            rows={3}
            value={emptyCatalogMsg}
            onChange={(e) => setEmptyCatalogMsg(e.target.value)}
            placeholder="No games available at this time."
            disabled={!isSuper}
          />
        </div>
      </div>
      <button className={primaryBtn} disabled={saving || !isSuper} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save Messages'}
      </button>
    </Section>
  )
}
