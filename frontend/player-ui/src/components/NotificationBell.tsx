import { useCallback, useEffect, useRef, useState } from 'react'

import { usePlayerAuth } from '../playerAuth'
import { IconBell } from './icons'

export type PlayerNotification = {
  id: number
  kind: string
  title: string
  body: string
  read: boolean
  created_at: string
}

type NotificationsResponse = {
  notifications: PlayerNotification[]
}

function formatNotificationTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = Date.now()
  const diffMs = now - d.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 45) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

const defaultOpenClass =
  'bg-casino-primary-dim text-casino-foreground [&_svg]:text-casino-foreground'

const panelClass =
  'absolute right-0 top-full z-[60] mt-1.5 max-h-[min(70vh,24rem)] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-casino-border bg-casino-bg text-casino-foreground shadow-2xl ring-1 ring-white/[0.04]'

type NotificationBellProps = {
  /** Classes for the bell trigger (e.g. shared header icon button styles). */
  className?: string
  /** Appended while the dropdown is open (matches other header toggles). */
  openClassName?: string
}

export default function NotificationBell({
  className = '',
  openClassName = defaultOpenClass,
}: NotificationBellProps) {
  const { accessToken, apiFetch } = usePlayerAuth()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<PlayerNotification[]>([])
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(async () => {
    if (!accessToken) return
    try {
      const res = await apiFetch('/v1/notifications')
      if (!res.ok) {
        setError('Could not load notifications')
        return
      }
      const j = (await res.json()) as NotificationsResponse
      setNotifications(Array.isArray(j.notifications) ? j.notifications : [])
      setError(null)
    } catch {
      setError('Could not load notifications')
    }
  }, [accessToken, apiFetch])

  useEffect(() => {
    if (!accessToken) {
      setNotifications([])
      setError(null)
      setOpen(false)
      return
    }

    let cancelled = false
    async function firstLoad() {
      setInitialLoading(true)
      await fetchNotifications()
      if (!cancelled) setInitialLoading(false)
    }
    void firstLoad()

    const interval = window.setInterval(() => void fetchNotifications(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [accessToken, fetchNotifications])

  useEffect(() => {
    if (open && accessToken) void fetchNotifications()
  }, [open, accessToken, fetchNotifications])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const unreadCount = notifications.filter((n) => !n.read).length

  const markRead = async (notificationId: number) => {
    setMarkingId(notificationId)
    try {
      const res = await apiFetch('/v1/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: notificationId }),
      })
      if (!res.ok) return
      const j = (await res.json()) as { updated?: boolean }
      if (j.updated) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
        )
      }
    } finally {
      setMarkingId(null)
    }
  }

  if (!accessToken) return null

  const triggerClasses = `${className} ${open ? openClassName : ''}`.trim()

  return (
    <div ref={rootRef} className="relative hidden sm:inline-flex">
      <button
        type="button"
        className={triggerClasses}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <IconBell size={18} aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-casino-destructive px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open ? (
        <div className={panelClass} role="region" aria-label="Notifications list">
          <div className="border-b border-casino-border bg-casino-surface/40 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-casino-muted">Notifications</p>
          </div>
          <div className="scrollbar-chat max-h-[min(70vh-2.5rem,22rem)] overflow-y-auto">
            {initialLoading && notifications.length === 0 ? (
              <p className="px-3 py-4 text-sm text-casino-muted">Loading…</p>
            ) : error && notifications.length === 0 ? (
              <p className="px-3 py-4 text-sm text-casino-destructive">{error}</p>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-4 text-sm text-casino-muted">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-casino-border">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`px-3 py-3 transition-colors ${
                      n.read
                        ? 'opacity-90'
                        : 'bg-casino-primary/[0.07] shadow-[inset_0_0_0_1px_rgba(124,77,255,0.12)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-casino-foreground">{n.title}</span>
                          {!n.read && (
                            <span className="shrink-0 rounded-full bg-gradient-to-b from-casino-primary to-casino-primary-dim px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm shadow-casino-primary/25">
                              New
                            </span>
                          )}
                        </div>
                        {n.body ? (
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-casino-muted">
                            {n.body}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-[11px] text-casino-muted/80">
                          {formatNotificationTime(n.created_at)}
                          {n.kind ? ` · ${n.kind}` : ''}
                        </p>
                      </div>
                    </div>
                    {!n.read ? (
                      <button
                        type="button"
                        className="mt-2.5 rounded-lg border border-casino-border bg-casino-surface px-3 py-1.5 text-xs font-semibold text-casino-foreground shadow-sm transition hover:border-casino-primary/45 hover:bg-casino-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:opacity-50"
                        disabled={markingId === n.id}
                        onClick={() => void markRead(n.id)}
                      >
                        {markingId === n.id ? 'Marking…' : 'Mark as read'}
                      </button>
                    ) : (
                      <p className="mt-2 text-[11px] font-medium text-casino-muted">Read</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
