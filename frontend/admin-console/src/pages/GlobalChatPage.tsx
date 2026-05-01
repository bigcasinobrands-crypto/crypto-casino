import { useCallback, useEffect, useState } from 'react'
import { formatApiError, readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { StatCard } from '../components/dashboard'
import { formatCompact } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type TabId = 'transcript' | 'bans' | 'settings' | 'broadcast' | 'blocked'

type ChatMessage = {
  id: number
  user_id: string
  username: string
  body: string
  deleted: boolean
  created_at: string
}

type ChatBan = {
  id: number
  user_id: string
  banned_by: string
  reason: string
  expires_at?: string
  created_at: string
}

type ChatMute = {
  id: number
  user_id: string
  muted_by: string
  reason: string
  expires_at: string
  created_at: string
}

type ChatSettings = {
  chat_enabled: boolean
  slow_mode_seconds: number
  min_account_age_seconds: number
}

type BlockedTerm = {
  id: number
  term: string
  enabled: boolean
  created_at: string
}

const inputClass = 'form-control form-control-sm'

const btnPrimary = 'btn btn-primary btn-sm'

const btnDanger = 'btn btn-danger btn-sm'

const tableWrap = 'table-responsive'
const tableClass = 'table table-sm table-striped table-hover align-middle mb-0'
const thClass = 'small'
const tdClass = 'small'

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export default function GlobalChatPage() {
  const { apiFetch } = useAdminAuth()
  const [activeTab, setActiveTab] = useState<TabId>('transcript')

  const [globalErr, setGlobalErr] = useState<string | null>(null)

  const [online, setOnline] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const [bans, setBans] = useState<ChatBan[]>([])
  const [mutes, setMutes] = useState<ChatMute[]>([])
  const [bansLoading, setBansLoading] = useState(false)

  const [settingsDraft, setSettingsDraft] = useState<ChatSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastReason, setBroadcastReason] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)

  const [terms, setTerms] = useState<BlockedTerm[]>([])
  const [termsLoading, setTermsLoading] = useState(false)
  const [newTerm, setNewTerm] = useState('')
  const [termBusy, setTermBusy] = useState<number | null>(null)
  const [termAdding, setTermAdding] = useState(false)

  const loadTranscript = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!silent) {
      setTranscriptLoading(true)
      setGlobalErr(null)
    }
    try {
      const [oRes, mRes] = await Promise.all([
        apiFetch('/v1/admin/chat/online'),
        apiFetch('/v1/admin/chat/messages?limit=100'),
      ])
      if (oRes.ok) {
        const j = (await oRes.json()) as { online?: number }
        setOnline(typeof j.online === 'number' ? j.online : null)
      } else {
        const e = await readApiError(oRes)
        setGlobalErr(formatApiError(e, 'Failed to load online count'))
      }
      if (mRes.ok) {
        const j = (await mRes.json()) as { messages?: ChatMessage[] }
        setMessages(Array.isArray(j.messages) ? j.messages : [])
      } else {
        const e = await readApiError(mRes)
        setGlobalErr(formatApiError(e, 'Failed to load messages'))
      }
    } catch {
      setGlobalErr('Network error loading transcript')
    } finally {
      if (!silent) setTranscriptLoading(false)
    }
  }, [apiFetch])

  const loadBansMutes = useCallback(async () => {
    setBansLoading(true)
    setGlobalErr(null)
    try {
      const [bRes, mRes] = await Promise.all([
        apiFetch('/v1/admin/chat/bans'),
        apiFetch('/v1/admin/chat/mutes'),
      ])
      if (bRes.ok) {
        const j = (await bRes.json()) as { bans?: ChatBan[] }
        setBans(Array.isArray(j.bans) ? j.bans : [])
      } else {
        const e = await readApiError(bRes)
        setGlobalErr(formatApiError(e, 'Failed to load bans'))
      }
      if (mRes.ok) {
        const j = (await mRes.json()) as { mutes?: ChatMute[] }
        setMutes(Array.isArray(j.mutes) ? j.mutes : [])
      } else {
        const e = await readApiError(mRes)
        setGlobalErr(formatApiError(e, 'Failed to load mutes'))
      }
    } catch {
      setGlobalErr('Network error loading bans/mutes')
    } finally {
      setBansLoading(false)
    }
  }, [apiFetch])

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    setGlobalErr(null)
    try {
      const res = await apiFetch('/v1/admin/chat/settings')
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Failed to load settings'))
        return
      }
      const j = (await res.json()) as Partial<ChatSettings>
      const next: ChatSettings = {
        chat_enabled: Boolean(j.chat_enabled),
        slow_mode_seconds: Number(j.slow_mode_seconds ?? 0),
        min_account_age_seconds: Number(j.min_account_age_seconds ?? 0),
      }
      setSettingsDraft(next)
    } catch {
      setGlobalErr('Network error loading settings')
    } finally {
      setSettingsLoading(false)
    }
  }, [apiFetch])

  const loadBlockedTerms = useCallback(async () => {
    setTermsLoading(true)
    setGlobalErr(null)
    try {
      const res = await apiFetch('/v1/admin/chat/blocked-terms')
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Failed to load blocked terms'))
        return
      }
      const j = (await res.json()) as { terms?: BlockedTerm[] }
      setTerms(Array.isArray(j.terms) ? j.terms : [])
    } catch {
      setGlobalErr('Network error loading blocked terms')
    } finally {
      setTermsLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (activeTab !== 'transcript') return
    void loadTranscript()
    const id = window.setInterval(() => void loadTranscript({ silent: true }), 5000)
    return () => window.clearInterval(id)
  }, [activeTab, loadTranscript])

  useEffect(() => {
    if (activeTab !== 'bans') return
    void loadBansMutes()
  }, [activeTab, loadBansMutes])

  useEffect(() => {
    if (activeTab !== 'settings') return
    void loadSettings()
  }, [activeTab, loadSettings])

  useEffect(() => {
    if (activeTab !== 'blocked') return
    void loadBlockedTerms()
  }, [activeTab, loadBlockedTerms])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [bRes, mRes] = await Promise.all([
          apiFetch('/v1/admin/chat/bans'),
          apiFetch('/v1/admin/chat/mutes'),
        ])
        if (cancelled) return
        if (bRes.ok) {
          const j = (await bRes.json()) as { bans?: ChatBan[] }
          setBans(Array.isArray(j.bans) ? j.bans : [])
        }
        if (mRes.ok) {
          const j = (await mRes.json()) as { mutes?: ChatMute[] }
          setMutes(Array.isArray(j.mutes) ? j.mutes : [])
        }
      } catch { /* stat cards degrade gracefully */ }
    })()
    return () => { cancelled = true }
  }, [apiFetch])

  async function handleDeleteMessage(msg: ChatMessage) {
    const reason = window.prompt('Reason for deleting this message (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setGlobalErr('Delete cancelled: reason is required')
      return
    }
    const key = `del-${msg.id}`
    setRowBusy(key)
    setGlobalErr(null)
    try {
      const res = await apiFetch(`/v1/admin/chat/messages/${msg.id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Delete failed'))
        return
      }
      void loadTranscript()
    } catch {
      setGlobalErr('Network error deleting message')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleMuteUser(userId: string) {
    const durRaw = window.prompt('Mute duration in minutes (required, max 1440):')
    if (durRaw === null) return
    const duration_minutes = parseInt(durRaw, 10)
    if (!Number.isFinite(duration_minutes) || duration_minutes <= 0) {
      setGlobalErr('Mute cancelled: enter a positive number of minutes')
      return
    }
    const reason = window.prompt('Reason for mute (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setGlobalErr('Mute cancelled: reason is required')
      return
    }
    const key = `mute-${userId}`
    setRowBusy(key)
    setGlobalErr(null)
    try {
      const res = await apiFetch(`/v1/admin/chat/users/${encodeURIComponent(userId)}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration_minutes,
          reason: reason.trim(),
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Mute failed'))
        return
      }
      void loadTranscript()
    } catch {
      setGlobalErr('Network error muting user')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleBanUser(userId: string) {
    const reason = window.prompt('Reason for ban (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setGlobalErr('Ban cancelled: reason is required')
      return
    }
    const key = `ban-${userId}`
    setRowBusy(key)
    setGlobalErr(null)
    try {
      const res = await apiFetch(`/v1/admin/chat/users/${encodeURIComponent(userId)}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Ban failed'))
        return
      }
      void loadTranscript()
    } catch {
      setGlobalErr('Network error banning user')
    } finally {
      setRowBusy(null)
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return
    setSettingsSaving(true)
    setGlobalErr(null)
    try {
      const res = await apiFetch('/v1/admin/chat/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_enabled: settingsDraft.chat_enabled,
          slow_mode_seconds: settingsDraft.slow_mode_seconds,
          min_account_age_seconds: settingsDraft.min_account_age_seconds,
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Save settings failed'))
        return
      }
      const j = (await res.json()) as Partial<ChatSettings>
      const next: ChatSettings = {
        chat_enabled: Boolean(j.chat_enabled),
        slow_mode_seconds: Number(j.slow_mode_seconds ?? 0),
        min_account_age_seconds: Number(j.min_account_age_seconds ?? 0),
      }
      setSettingsDraft(next)
    } catch {
      setGlobalErr('Network error saving settings')
    } finally {
      setSettingsSaving(false)
    }
  }

  async function sendBroadcast() {
    const msg = broadcastMessage.trim()
    if (!msg) {
      setGlobalErr('Enter a message to broadcast')
      return
    }
    if (
      !window.confirm(
        'Send this message to all connected chat clients? This cannot be undone.',
      )
    ) {
      return
    }
    setBroadcastSending(true)
    setGlobalErr(null)
    try {
      const res = await apiFetch('/v1/admin/chat/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          reason: broadcastReason.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Broadcast failed'))
        return
      }
      setBroadcastMessage('')
      setBroadcastReason('')
    } catch {
      setGlobalErr('Network error sending broadcast')
    } finally {
      setBroadcastSending(false)
    }
  }

  async function addBlockedTerm() {
    const t = newTerm.trim()
    if (!t) {
      setGlobalErr('Enter a term to block')
      return
    }
    setTermAdding(true)
    setGlobalErr(null)
    try {
      const res = await apiFetch('/v1/admin/chat/blocked-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: t }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Add term failed'))
        return
      }
      setNewTerm('')
      void loadBlockedTerms()
    } catch {
      setGlobalErr('Network error adding term')
    } finally {
      setTermAdding(false)
    }
  }

  async function deleteBlockedTerm(id: number) {
    if (!window.confirm('Delete this blocked term?')) return
    setTermBusy(id)
    setGlobalErr(null)
    try {
      const res = await apiFetch(`/v1/admin/chat/blocked-terms/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setGlobalErr(formatApiError(e, 'Delete term failed'))
        return
      }
      void loadBlockedTerms()
    } catch {
      setGlobalErr('Network error deleting term')
    } finally {
      setTermBusy(null)
    }
  }

  return (
    <>
      <PageMeta
        title="Global chat · Admin"
        description="Moderation, settings, broadcast, and blocked terms"
      />
      <PageBreadcrumb
        pageTitle="Global chat"
        subtitle="Moderation, settings, broadcast, and blocked terms."
      />

      {globalErr ? <div className="alert alert-danger small py-2 mb-3">{globalErr}</div> : null}

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <StatCard
            label="Online now"
            value={online != null ? formatCompact(online) : '—'}
            variant="info"
            iconClass="bi-people"
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label="Messages today" value="—" variant="secondary" iconClass="bi-chat-dots" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Active bans"
            value={bans.length > 0 ? formatCompact(bans.length) : '—'}
            variant="danger"
            iconClass="bi-slash-circle"
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Active mutes"
            value={mutes.length > 0 ? formatCompact(mutes.length) : '—'}
            variant="warning"
            iconClass="bi-mic-mute"
          />
        </div>
      </div>

      <div className="btn-group flex-wrap mb-3" role="group" aria-label="Chat sections">
        {(
          [
            ['transcript', 'Transcript'],
            ['bans', 'Bans & mutes'],
            ['settings', 'Settings'],
            ['broadcast', 'Broadcast'],
            ['blocked', 'Blocked terms'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${activeTab === id ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => {
              setActiveTab(id)
              setGlobalErr(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'transcript' ? (
        <ComponentCard
          title="Transcript"
          desc="Recent chat messages (auto-refreshes every 5 seconds). Moderation actions require a reason."
        >
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3 small">
            <span>
              Online: <strong>{online ?? '—'}</strong>
            </span>
            {transcriptLoading ? <span className="text-secondary">Refreshing…</span> : null}
            <button type="button" className={btnPrimary} onClick={() => void loadTranscript()}>
              Refresh now
            </button>
          </div>
          <div className={tableWrap}>
            <table className={tableClass}>
              <thead className="table-light">
                <tr>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>User</th>
                  <th className={thClass}>Username</th>
                  <th className={thClass}>Body</th>
                  <th className={thClass}>Deleted</th>
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.length === 0 ? (
                  <tr>
                    <td className="text-center text-secondary py-5" colSpan={7}>
                      No messages yet.
                    </td>
                  </tr>
                ) : (
                  messages.map((m) => {
                    const busyDel = rowBusy === `del-${m.id}`
                    const busyMute = rowBusy === `mute-${m.user_id}`
                    const busyBan = rowBusy === `ban-${m.user_id}`
                    return (
                      <tr key={m.id}>
                        <td className={tdClass}>{m.id}</td>
                        <td
                          className={`${tdClass} max-w-[140px] truncate font-mono text-xs`}
                          title={m.user_id}
                        >
                          {m.user_id}
                        </td>
                        <td className={tdClass}>{m.username}</td>
                        <td className={`${tdClass} max-w-md break-words`}>{m.body}</td>
                        <td className={tdClass}>{m.deleted ? 'Yes' : 'No'}</td>
                        <td className={`${tdClass} whitespace-nowrap text-xs`}>
                          {formatTime(m.created_at)}
                        </td>
                        <td className={tdClass}>
                          {m.deleted ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <div className="d-flex flex-wrap gap-1">
                              <button
                                type="button"
                                className={btnDanger}
                                disabled={busyDel || busyMute || busyBan}
                                onClick={() => void handleDeleteMessage(m)}
                              >
                                {busyDel ? '…' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                className={btnPrimary}
                                disabled={busyDel || busyMute || busyBan}
                                onClick={() => void handleMuteUser(m.user_id)}
                              >
                                {busyMute ? '…' : 'Mute user'}
                              </button>
                              <button
                                type="button"
                                className={btnDanger}
                                disabled={busyDel || busyMute || busyBan}
                                onClick={() => void handleBanUser(m.user_id)}
                              >
                                {busyBan ? '…' : 'Ban user'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </ComponentCard>
      ) : null}

      {activeTab === 'bans' ? (
        <ComponentCard
          title="Bans & mutes"
          desc="Active chat bans and timed mutes from the database."
        >
          {bansLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : null}
          <h3 className="h6 mb-2">Bans</h3>
          <div className={`${tableWrap} mb-4`}>
            <table className={tableClass}>
              <thead className="table-light">
                <tr>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>User ID</th>
                  <th className={thClass}>Banned by</th>
                  <th className={thClass}>Reason</th>
                  <th className={thClass}>Expires</th>
                  <th className={thClass}>Created</th>
                </tr>
              </thead>
              <tbody>
                {bans.length === 0 ? (
                  <tr>
                    <td className="text-center text-secondary py-4" colSpan={6}>
                      No bans.
                    </td>
                  </tr>
                ) : (
                  bans.map((b) => (
                    <tr key={b.id}>
                      <td className={tdClass}>{b.id}</td>
                      <td
                        className={`${tdClass} max-w-[160px] truncate font-mono text-xs`}
                        title={b.user_id}
                      >
                        {b.user_id}
                      </td>
                      <td
                        className={`${tdClass} max-w-[140px] truncate font-mono text-xs`}
                        title={b.banned_by}
                      >
                        {b.banned_by}
                      </td>
                      <td className={`${tdClass} max-w-xs break-words`}>{b.reason}</td>
                      <td className={tdClass}>
                        {b.expires_at ? formatTime(b.expires_at) : '—'}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-xs`}>
                        {formatTime(b.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <h3 className="h6 mb-2">Mutes</h3>
          <div className={tableWrap}>
            <table className={tableClass}>
              <thead className="table-light">
                <tr>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>User ID</th>
                  <th className={thClass}>Muted by</th>
                  <th className={thClass}>Reason</th>
                  <th className={thClass}>Expires</th>
                  <th className={thClass}>Created</th>
                </tr>
              </thead>
              <tbody>
                {mutes.length === 0 ? (
                  <tr>
                    <td className="text-center text-secondary py-4" colSpan={6}>
                      No mutes.
                    </td>
                  </tr>
                ) : (
                  mutes.map((m) => (
                    <tr key={m.id}>
                      <td className={tdClass}>{m.id}</td>
                      <td
                        className={`${tdClass} max-w-[160px] truncate font-mono text-xs`}
                        title={m.user_id}
                      >
                        {m.user_id}
                      </td>
                      <td
                        className={`${tdClass} max-w-[140px] truncate font-mono text-xs`}
                        title={m.muted_by}
                      >
                        {m.muted_by}
                      </td>
                      <td className={`${tdClass} max-w-xs break-words`}>{m.reason}</td>
                      <td className={`${tdClass} whitespace-nowrap text-xs`}>
                        {formatTime(m.expires_at)}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-xs`}>
                        {formatTime(m.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className={`${btnPrimary} mt-4`}
            onClick={() => void loadBansMutes()}
            disabled={bansLoading}
          >
            Refresh
          </button>
        </ComponentCard>
      ) : null}

      {activeTab === 'settings' ? (
        <ComponentCard
          title="Chat settings"
          desc="Master toggle, slow mode interval, and minimum account age for sending messages."
        >
          {settingsLoading && !settingsDraft ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : null}
          {settingsDraft ? (
            <div className="mw-100" style={{ maxWidth: 520 }}>
              <div className="form-check mb-3">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="chat-enabled"
                  checked={settingsDraft.chat_enabled}
                  onChange={(e) =>
                    setSettingsDraft((s) =>
                      s ? { ...s, chat_enabled: e.target.checked } : s,
                    )
                  }
                />
                <label className="form-check-label" htmlFor="chat-enabled">
                  Chat enabled
                </label>
              </div>
              <div className="mb-3">
                <label className="form-label small mb-1">Slow mode (seconds between messages)</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={settingsDraft.slow_mode_seconds}
                  onChange={(e) =>
                    setSettingsDraft((s) =>
                      s
                        ? { ...s, slow_mode_seconds: parseInt(e.target.value, 10) || 0 }
                        : s,
                    )
                  }
                />
              </div>
              <div className="mb-3">
                <label className="form-label small mb-1">Minimum account age (seconds)</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={settingsDraft.min_account_age_seconds}
                  onChange={(e) =>
                    setSettingsDraft((s) =>
                      s
                        ? {
                            ...s,
                            min_account_age_seconds: parseInt(e.target.value, 10) || 0,
                          }
                        : s,
                    )
                  }
                />
              </div>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void saveSettings()}
                disabled={settingsSaving}
              >
                {settingsSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : !settingsLoading ? (
            <p className="text-secondary small mb-0">No settings loaded.</p>
          ) : null}
        </ComponentCard>
      ) : null}

      {activeTab === 'broadcast' ? (
        <ComponentCard
          title="Broadcast"
          desc="Sends a system message to all connected chat clients. Logged to the admin audit trail."
        >
          <div className="mw-100" style={{ maxWidth: 560 }}>
            <div className="mb-3">
              <label className="form-label small mb-1">Message</label>
              <textarea
                className={`${inputClass}`}
                style={{ minHeight: 120 }}
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Message shown in chat…"
              />
            </div>
            <div className="mb-3">
              <label className="form-label small mb-1">Reason (optional, audit log)</label>
              <input
                type="text"
                className={inputClass}
                value={broadcastReason}
                onChange={(e) => setBroadcastReason(e.target.value)}
                placeholder="Why you are broadcasting…"
              />
            </div>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void sendBroadcast()}
              disabled={broadcastSending}
            >
              {broadcastSending ? 'Sending…' : 'Send broadcast'}
            </button>
          </div>
        </ComponentCard>
      ) : null}

      {activeTab === 'blocked' ? (
        <ComponentCard
          title="Blocked terms"
          desc="Terms filtered from chat (superadmin only to add/remove)."
        >
          {termsLoading ? (
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : null}
          <div className="d-flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              className={`${inputClass} flex-grow-1`}
              style={{ minWidth: 200 }}
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              placeholder="New blocked term…"
            />
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void addBlockedTerm()}
              disabled={termAdding}
            >
              {termAdding ? 'Adding…' : 'Add term'}
            </button>
          </div>
          <div className={tableWrap}>
            <table className={tableClass}>
              <thead className="table-light">
                <tr>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>Term</th>
                  <th className={thClass}>Enabled</th>
                  <th className={thClass}>Created</th>
                  <th className={thClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {terms.length === 0 ? (
                  <tr>
                    <td className="text-center text-secondary py-4" colSpan={5}>
                      No blocked terms.
                    </td>
                  </tr>
                ) : (
                  terms.map((t) => (
                    <tr key={t.id}>
                      <td className={tdClass}>{t.id}</td>
                      <td className={tdClass}>{t.term}</td>
                      <td className={tdClass}>{t.enabled ? 'Yes' : 'No'}</td>
                      <td className={`${tdClass} whitespace-nowrap text-xs`}>
                        {formatTime(t.created_at)}
                      </td>
                      <td className={tdClass}>
                        <button
                          type="button"
                          className={btnDanger}
                          disabled={termBusy === t.id}
                          onClick={() => void deleteBlockedTerm(t.id)}
                        >
                          {termBusy === t.id ? '…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className={`${btnPrimary} mt-4`}
            onClick={() => void loadBlockedTerms()}
            disabled={termsLoading}
          >
            Refresh
          </button>
        </ComponentCard>
      ) : null}
    </>
  )
}
