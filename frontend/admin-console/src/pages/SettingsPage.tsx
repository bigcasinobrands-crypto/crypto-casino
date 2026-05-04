import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { useOperationalFlags } from '../hooks/useOperationalFlags'
import { StatusBadge } from '../components/dashboard'
import { formatRelativeTime } from '../lib/format'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { Toggle } from '../components/common/Toggle'
import { CountryPicker } from '../components/admin-ui/CountryPicker'
import type { CountryRegion } from '../lib/countryIsoList'
import { COUNTRY_OPTIONS, flagEmoji } from '../lib/countryIsoList'
import { PLAYER_BRANDING_DEFAULT_LOGO_PREVIEW } from '../lib/playerBrandLogo'

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const primaryBtn = 'btn btn-primary btn-sm'

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

function SettingsAttentionStrip({ settings }: { settings: SettingsMap }) {
  const maintenance = !!getSettingVal(settings, 'system', 'maintenance_mode', false)
  const deposits = !!getSettingVal(settings, 'payments', 'deposits_enabled', true)
  const withdrawals = !!getSettingVal(settings, 'payments', 'withdrawals_enabled', true)
  const realPlay = !!getSettingVal(settings, 'games', 'real_play_enabled', true)
  const risky = maintenance || !deposits || !withdrawals || !realPlay
  if (!risky) return null
  return (
    <div className="alert alert-warning small py-2 mb-3 d-flex flex-wrap align-items-center gap-2">
      <strong>Platform flags:</strong>
      {maintenance ? <span className="badge text-bg-danger">Maintenance on</span> : null}
      {!deposits ? <span className="badge text-bg-warning">Deposits off</span> : null}
      {!withdrawals ? <span className="badge text-bg-warning">Withdrawals off</span> : null}
      {!realPlay ? <span className="badge text-bg-warning">Real play off</span> : null}
    </div>
  )
}

function SettingsSystemOutline() {
  const links = [
    { href: '#settings-kill-switches', label: 'Kill switches' },
    { href: '#settings-security', label: 'Security & access' },
    { href: '#settings-withdrawals', label: 'Withdrawal limits' },
    { href: '#settings-bonus-worker', label: 'Bonus worker' },
    { href: '#settings-integrations', label: 'Integration status' },
    { href: '#settings-payments', label: 'Payment flags' },
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
      const j = (await res.json()) as { groups: SettingsMap }
      setSettings(j.groups ?? {})
    } catch (e) {
      console.error('settings fetch', e)
    }
  }, [apiFetch])

  const fetchContent = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/content')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = (await res.json()) as { groups: ContentMap }
      setContent(j.groups ?? {})
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

  const patchSetting = useCallback(
    async (key: string, value: unknown) => {
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
        toast.success(`Updated ${key}`)
        await fetchSettings()
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
  patchSetting: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
}) {
  return (
    <>
      <SettingsAttentionStrip settings={settings} />
      <div className="row g-3">
        <div className="col-lg-3 d-none d-lg-block">
          <SettingsSystemOutline />
        </div>
        <div className="col-lg-9">
          <KillSwitchesPanel settings={settings} patchSetting={patchSetting} isSuper={isSuper} />
          <SecurityAccessPanel settings={settings} patchSetting={patchSetting} isSuper={isSuper} />
          <WithdrawalLimitsPanel settings={settings} patchSetting={patchSetting} isSuper={isSuper} />
          <BonusWorkerReadonlyPanel apiFetch={apiFetch} />
          <IntegrationStatusPanel settings={settings} />
          <PaymentFlagsPanel apiFetch={apiFetch} isSuper={isSuper} />
        </div>
      </div>
    </>
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
  { key: 'maintenance_mode', label: 'Maintenance Mode', cat: 'system', invertBadge: true },
  { key: 'deposits_enabled', label: 'Deposits Enabled', cat: 'payments' },
  { key: 'withdrawals_enabled', label: 'Withdrawals Enabled', cat: 'payments' },
  { key: 'real_play_enabled', label: 'Real Play Enabled', cat: 'games' },
  { key: 'bonuses_enabled', label: 'Bonuses Enabled', cat: 'bonuses' },
  { key: 'automated_grants_enabled', label: 'Automated Grants', cat: 'bonuses' },
  { key: 'chat_enabled', label: 'Chat Enabled', cat: 'chat' },
] as const

function KillSwitchesPanel({
  settings,
  patchSetting,
  isSuper,
}: {
  settings: SettingsMap
  patchSetting: (key: string, value: unknown) => Promise<boolean>
  isSuper: boolean
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const toggleSwitch = async (fullKey: string, shortKey: string, currentVal: boolean) => {
    if (!isSuper) return toast.error('Superadmin required')
    setBusyKey(shortKey)
    await patchSetting(fullKey, !currentVal)
    setBusyKey(null)
  }

  return (
    <Section id="settings-kill-switches" title="Kill Switches" desc="Master toggles for platform features" defaultOpen>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KILL_SWITCHES.map((sw) => {
          const fullKey = `${sw.cat}.${sw.key}`
          const val = !!getSettingVal(settings, sw.cat, sw.key, false)
          const meta = getSettingMeta(settings, sw.cat, sw.key)
          const isOn = 'invertBadge' in sw && sw.invertBadge ? !val : val
          return (
            <div
              key={sw.key}
              className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-white/[0.02]"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    {sw.label}
                  </span>
                  <StatusBadge
                    label={isOn ? 'ON' : 'OFF'}
                    variant={isOn ? 'success' : 'error'}
                    dot
                  />
                </div>
                {meta?.updated_at && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {formatRelativeTime(meta.updated_at)}
                    {meta.updated_by ? ` by ${meta.updated_by}` : ''}
                  </p>
                )}
              </div>
              <Toggle
                checked={val}
                disabled={busyKey === sw.key || !isSuper}
                onChange={() => void toggleSwitch(fullKey, sw.key, val)}
              />
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function parseBlockedCountriesRaw(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).toUpperCase().trim()).filter((x) => x.length === 2)
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
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
}: {
  label: string
  hint?: string
  lines: string[]
  setLines: (next: string[]) => void
  disabled?: boolean
  saving: boolean
  onSave: () => void
  saveKey: string
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
                onClick={() => setLines(lines.filter((x) => x !== line))}
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
        <button type="button" className={primaryBtn} disabled={disabled} onClick={add}>
          Add
        </button>
        <button type="button" className={primaryBtn} disabled={disabled || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save list'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">Stored one rule per line in site settings ({saveKey}).</p>
    </div>
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
  const [blockedCodes, setBlockedCodes] = useState<string[]>([])
  const [ipBlacklistLines, setIpBlacklistLines] = useState<string[]>([])
  const [ipWhitelistLines, setIpWhitelistLines] = useState<string[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    setBlockedCodes(parseBlockedCountriesRaw(getSettingVal(settings, 'security', 'blocked_countries', '')))
    setIpBlacklistLines(linesFromSetting(getSettingVal(settings, 'security', 'ip_blacklist', '')))
    setIpWhitelistLines(linesFromSetting(getSettingVal(settings, 'security', 'ip_whitelist', '')))
  }, [settings])

  const corsOrigins = getSettingVal(settings, 'security', 'cors_origins', '') as string

  const saveKey = async (fullKey: string, value: string) => {
    if (!isSuper) return toast.error('Superadmin required')
    const short = fullKey.replace(/^security\./, '')
    setSaving(short)
    await patchSetting(fullKey, value)
    setSaving(null)
  }

  const toggleBlocked = (code: string) => {
    const c = code.toUpperCase()
    setBlockedCodes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const applyRegionBlocked = (region: CountryRegion, add: boolean) => {
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
            Players with matching <code className="rounded bg-gray-100 px-1 dark:bg-white/10">X-Geo-Country</code> cannot open
            real/demo play when this list is enforced server-side. Save applies ISO codes as a comma-separated setting.
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {REGIONS_SEC.map((reg) => (
              <span key={reg} className="inline-flex gap-1">
                <button
                  type="button"
                  className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
                  disabled={!isSuper}
                  onClick={() => applyRegionBlocked(reg, true)}
                >
                  Block {reg}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-600"
                  disabled={!isSuper}
                  onClick={() => applyRegionBlocked(reg, false)}
                >
                  Unblock {reg}
                </button>
              </span>
            ))}
          </div>
          <CountryPicker mode="deny" selected={blockedCodes} disabled={!isSuper} onToggle={toggleBlocked} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 text-xs text-gray-600 dark:text-gray-300">
              {blockedCodes.length ? (
                blockedCodes.map((c) => {
                  const name = COUNTRY_OPTIONS.find((x) => x.code === c)?.name ?? c
                  return (
                    <span key={c} className="rounded-full border border-gray-200 px-2 py-0.5 dark:border-gray-600">
                      {flagEmoji(c)} {name}
                    </span>
                  )
                })
              ) : (
                <span className="text-gray-400">None selected</span>
              )}
            </div>
            <button
              type="button"
              className={primaryBtn}
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

// ---------------------------------------------------------------------------
// Integration Status (read-only)
// ---------------------------------------------------------------------------

function IntegrationStatusPanel({ settings }: { settings: SettingsMap }) {
  const integrations = [
    {
      name: 'Fystack',
      status: getSettingVal(settings, 'integrations', 'fystack_configured', false) as boolean,
      detail: getSettingVal(settings, 'integrations', 'fystack_configured', false)
        ? 'API key configured'
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

function PaymentFlagsPanel({
  apiFetch,
  isSuper,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isSuper: boolean
}) {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)

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
    fetchFlags()
  }, [fetchFlags])

  const toggleFlag = async (key: string, val: boolean) => {
    if (!isSuper) return toast.error('Superadmin required')
    setBusyKey(key)
    try {
      const res = await apiFetch('/v1/admin/ops/payment-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !val }),
      })
      if (!res.ok) {
        toast.error('Failed to update payment flag')
      } else {
        toast.success(`Updated ${key}`)
        await fetchFlags()
      }
    } catch {
      toast.error('Error updating payment flag')
    }
    setBusyKey(null)
  }

  if (loading) return <SkeletonCard />
  if (Object.keys(flags).length === 0) return null

  return (
    <Section id="settings-payments" title="Payment Flags" desc="Per-currency and provider-level payment toggles">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(flags).map(([key, val]) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-white/[0.02]"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {key.replace(/_/g, ' ')}
              </span>
              <StatusBadge label={val ? 'ON' : 'OFF'} variant={val ? 'success' : 'error'} dot />
            </div>
            <Toggle
              checked={val}
              disabled={busyKey === key || !isSuper}
              onChange={() => toggleFlag(key, val)}
            />
          </div>
        ))}
      </div>
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
