import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, UseChatReturn } from '../hooks/useChat'
import { playerApiUrl } from '../lib/playerApiUrl'
import { sanitizeChatRichLine } from '../lib/sanitizeHtml'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import {
  IconArrowDownToLine,
  IconCloudRain,
  IconPartyPopper,
  IconSend,
  IconSmile,
  IconVolume2,
  IconVolumeX,
  IconX,
} from './icons'

type ChatDrawerProps = {
  open: boolean
  onClose: () => void
  chat: UseChatReturn
}

const AVATAR_COLORS = [
  '#7b61ff', '#e91e63', '#00bcd4', '#ff9800',
  '#4caf50', '#9c27b0', '#f44336', '#2196f3',
]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function getAvatarColor(username: string) {
  return AVATAR_COLORS[hashCode(username) % AVATAR_COLORS.length]
}

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase()
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

const vipColorMap: Record<string, string> = {
  gold: 'text-[#facc15]',
  silver: 'text-[#94a3b8]',
  bronze: 'text-[#d97706]',
  mod: 'text-casino-success',
}

const EMOJI_SET = [
  '🎰', '🎲', '💰', '💎', '🔥', '🚀', '💜', '🎉',
  '🏆', '⚡', '💸', '🤑', '👑', '💀', '🤡', '😂',
  '❤️', '😎', '🙏', '💯', '🎯', '✅', '😭', '🫡',
  '👀', '🐋', '🌧️', '⭐', '🍀', '🃏', '♠️', '♥️',
  '♦️', '♣️', '🎱', '🪙', '📈', '📉', '🤝', '👊',
]

const LS_SOUND_KEY = 'chat_sound_enabled'
const LS_MUTED_USERS_KEY = 'chat_muted_users'

export default function ChatDrawer({ open, onClose, chat }: ChatDrawerProps) {
  const { isAuthenticated, me } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const {
    messages,
    sendMessage,
    connected,
    onlineCount,
    resetUnread,
    error,
  } = chat

  const [inputVal, setInputVal] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(LS_SOUND_KEY) !== 'false')
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_MUTED_USERS_KEY)
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })
  const [newMsgCount, setNewMsgCount] = useState(0)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottom = useRef(true)
  const prevMsgCount = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)

  const uniqueUsers = useMemo(() => {
    const seen = new Set<string>()
    return messages
      .filter(m => m.msg_type === 'user' && m.username)
      .reduce<string[]>((acc, m) => {
        if (!seen.has(m.username)) {
          seen.add(m.username)
          acc.push(m.username)
        }
        return acc
      }, [])
  }, [messages])

  const mentionResults = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return uniqueUsers.filter(u => u.toLowerCase().startsWith(q)).slice(0, 5)
  }, [mentionQuery, uniqueUsers])

  useEffect(() => {
    if (open) resetUnread()
  }, [open, resetUnread])

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('data:audio/wav;base64,UklGRl9vT19teleQBAABAAEARKwAABCxAgAEABAAZGF0YQ==')
      audioRef.current.volume = 0.3
    }
  }, [])

  const toggleSound = useCallback(() => {
    setSoundOn(p => {
      const next = !p
      localStorage.setItem(LS_SOUND_KEY, String(next))
      return next
    })
  }, [])

  const toggleMuteUser = useCallback((participantId: string) => {
    if (!participantId) return
    setMutedUsers(prev => {
      const next = new Set(prev)
      if (next.has(participantId)) next.delete(participantId)
      else next.add(participantId)
      localStorage.setItem(LS_MUTED_USERS_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const scrollToEnd = useCallback(() => {
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (isNearBottom.current) setNewMsgCount(0)
  }, [])

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      const newCount = messages.length - prevMsgCount.current
      if (isNearBottom.current) {
        requestAnimationFrame(scrollToEnd)
      } else {
        setNewMsgCount(c => c + newCount)
      }
      if (soundOn && newCount > 0 && audioRef.current) {
        audioRef.current.play().catch(() => {})
      }
    }
    prevMsgCount.current = messages.length
  }, [messages.length, soundOn, scrollToEnd])

  const scrollToBottom = useCallback(() => {
    scrollToEnd()
    setNewMsgCount(0)
  }, [scrollToEnd])

  const handleSend = useCallback(() => {
    if (!inputVal.trim()) return
    sendMessage(inputVal)
    setInputVal('')
    setShowEmoji(false)
    setMentionQuery(null)
    requestAnimationFrame(scrollToEnd)
  }, [inputVal, sendMessage, scrollToEnd])

  const insertMention = useCallback((username: string) => {
    const atIdx = inputVal.lastIndexOf('@')
    if (atIdx === -1) return
    const newVal = inputVal.slice(0, atIdx) + `@${username} `
    setInputVal(newVal)
    setMentionQuery(null)
    inputRef.current?.focus()
  }, [inputVal])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx(i => (i + 1) % mentionResults.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx(i => (i - 1 + mentionResults.length) % mentionResults.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        insertMention(mentionResults[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [mentionQuery, mentionResults, mentionIdx, handleSend, insertMention])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputVal(val)

    const cursor = e.target.selectionStart ?? val.length
    const before = val.slice(0, cursor)
    const atMatch = before.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionIdx(0)
    } else {
      setMentionQuery(null)
    }
  }, [])

  const insertEmoji = useCallback((emoji: string) => {
    setInputVal(v => v + emoji)
    inputRef.current?.focus()
  }, [])

  const filteredMessages = useMemo(
    () =>
      messages.filter(
        m => m.msg_type !== 'user' || !m.participant_id || !mutedUsers.has(m.participant_id),
      ),
    [messages, mutedUsers],
  )

  const myParticipantId = me?.participant_id

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close chat"
        className={`fixed inset-0 z-[235] bg-black/60 backdrop-blur-[2px] transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Bottom inset matches main scroll column so the composer sits above the fixed mobile nav. */}
      <aside
        className={`
          chat-drawer-aside fixed right-0 bottom-0 z-[236] flex shrink-0 flex-col overflow-hidden
          border-l border-white/[0.04] bg-casino-sidebar
          transition-[width] duration-200 ease-out
          max-md:box-border max-md:pb-[var(--casino-mobile-nav-offset)]
          ${open ? 'min-w-0 w-[var(--shell-chat-panel-w)]' : 'w-0'}
        `}
      >
        {/* Header */}
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-white/[0.04] px-4 max-md:box-border max-md:h-auto max-md:min-h-[calc(60px+env(safe-area-inset-top,0px))] max-md:pt-[env(safe-area-inset-top,0px)]">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-casino-success shadow-[0_0_6px_theme(colors.casino-success)]" />
            <span className="text-[14px] font-extrabold text-casino-foreground">Global Chat</span>
            <span className="rounded-casino-sm bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-casino-muted">
              {onlineCount.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-casino-sm text-casino-muted transition hover:bg-casino-primary-dim hover:text-white"
              onClick={toggleSound}
              aria-label={soundOn ? 'Mute sound' : 'Enable sound'}
            >
              {soundOn ? <IconVolume2 size={16} /> : <IconVolumeX size={16} />}
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-casino-sm text-casino-muted transition hover:bg-casino-primary-dim hover:text-white"
              onClick={onClose}
              aria-label="Close chat"
            >
              <IconX size={18} />
            </button>
          </div>
        </div>

        {/* Body wrapper — grid below keeps the composer row from collapsing on mobile Safari (flex + overflow quirks). */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Connection status */}
          {!connected && open && (
            <div className="flex shrink-0 items-center gap-2 bg-casino-warning/10 px-4 py-1.5 text-[11px] font-semibold text-casino-warning">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-casino-warning" />
              Reconnecting...
            </div>
          )}

          {/* Error toast */}
          {error && (
            <div className="shrink-0 bg-casino-destructive/10 px-4 py-1.5 text-[11px] font-semibold text-casino-destructive">
              {error}
            </div>
          )}

          <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
            {/* Messages */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="scrollbar-chat flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-y-contain px-4 py-4"
            >
              {filteredMessages.length === 0 && (
                <p className="py-10 text-center text-[13px] text-casino-muted">No messages yet. Say hello!</p>
              )}
              {filteredMessages.map(msg => (
                <ChatMessageRow
                  key={msg.id || msg.created_at}
                  msg={msg}
                  isOwn={!!myParticipantId && msg.participant_id === myParticipantId}
                  currentUsername={me?.username}
                  isMuted={!!msg.participant_id && mutedUsers.has(msg.participant_id)}
                  onMuteUser={toggleMuteUser}
                />
              ))}
            </div>

            {/* Scroll-to-bottom pill */}
            {newMsgCount > 0 && (
              <div className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 max-md:bottom-[calc(8.5rem+env(safe-area-inset-bottom,0px))] md:max-lg:bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-24">
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-casino-primary px-3 py-1.5 text-[11px] font-bold text-white shadow-lg transition hover:brightness-110"
                >
                  <IconArrowDownToLine size={12} />
                  {newMsgCount} new {newMsgCount === 1 ? 'message' : 'messages'}
                </button>
              </div>
            )}

            {/* Input area — second grid row: always reserves space for typing on phones */}
            <div className="relative z-[1] border-t border-white/[0.08] bg-casino-bg/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] max-md:px-3 max-md:py-1.5">
              {/* Emoji picker */}
              {showEmoji && (
                <div className="absolute bottom-full left-4 right-4 mb-2 grid grid-cols-8 gap-0.5 rounded-casino-md border border-white/[0.06] bg-casino-elevated p-1.5 shadow-xl">
                  {EMOJI_SET.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[14px] transition hover:bg-white/[0.08]"
                      onClick={() => insertEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* Mention autocomplete */}
              {mentionQuery !== null && mentionResults.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-2 flex flex-col rounded-casino-md bg-casino-elevated shadow-xl">
                  {mentionResults.map((u, i) => (
                    <button
                      key={u}
                      type="button"
                      className={`flex items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold transition ${
                        i === mentionIdx ? 'bg-casino-primary-dim text-casino-foreground' : 'text-casino-muted hover:bg-white/[0.04]'
                      }`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(u) }}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold text-white" style={{ background: getAvatarColor(u) }}>
                        {getInitials(u)}
                      </span>
                      @{u}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex w-full min-w-0 flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
                {/* Row 1: field + emoji (mobile); tablet/desktop adds inline Send */}
                <div className="flex min-h-0 min-w-0 flex-1 items-center gap-2 rounded-casino-md bg-white/[0.06] py-1.5 pl-3.5 pr-2 max-md:py-1 max-md:pl-2.5">
                  {!isAuthenticated ? (
                    <button
                      type="button"
                      className="min-w-0 flex-1 py-0.5 text-left text-[13px] font-medium text-white/30 max-md:text-[12px]"
                      onClick={() => openAuth('login')}
                    >
                      Sign in to chat
                    </button>
                  ) : (
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputVal}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message..."
                      maxLength={500}
                      className="min-h-0 min-w-0 flex-1 bg-transparent py-1 text-[13px] font-medium leading-tight text-white placeholder:text-white/30 outline-none max-md:py-0.5 max-md:text-[12px]"
                      enterKeyHint="send"
                    />
                  )}
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-casino-sm bg-white/[0.04] text-casino-muted transition hover:text-casino-foreground max-md:h-7 max-md:w-7"
                    onClick={() => setShowEmoji(e => !e)}
                    aria-label="Emoji"
                  >
                    <IconSmile size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-casino-sm bg-casino-primary text-white transition hover:brightness-110 disabled:opacity-40 md:inline-flex"
                    onClick={handleSend}
                    disabled={!isAuthenticated || !inputVal.trim()}
                    aria-label="Send message"
                  >
                    <IconSend size={14} aria-hidden />
                  </button>
                </div>
                {/* Row 2 (mobile only): full-width Send — keeps icon row compact and action visible */}
                {isAuthenticated ? (
                  <button
                    type="button"
                    className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-casino-md bg-casino-primary px-3 text-[13px] font-bold text-white transition hover:brightness-110 disabled:opacity-40 md:hidden"
                    onClick={handleSend}
                    disabled={!inputVal.trim()}
                  >
                    <IconSend size={15} aria-hidden />
                    Send
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

// --- Message row ---

type ChatMessageRowProps = {
  msg: ChatMessage
  isOwn: boolean
  currentUsername?: string
  isMuted: boolean
  onMuteUser: (participantId: string) => void
}

function ChatMessageRow({ msg, isOwn, currentUsername, isMuted, onMuteUser }: ChatMessageRowProps) {
  if (msg.msg_type === 'system') {
    return (
      <div className="flex items-center gap-3 rounded-casino-md border-l-[3px] border-casino-primary bg-casino-primary/[0.08] p-3">
        <IconPartyPopper size={18} className="shrink-0 text-casino-primary" />
        <p className="text-[12px] font-medium text-[#e5dfff]" dangerouslySetInnerHTML={{ __html: sanitizeChatRichLine(highlightBold(msg.body)) }} />
      </div>
    )
  }

  if (msg.msg_type === 'rain') {
    return (
      <div className="flex items-center gap-3 rounded-casino-md border-l-[3px] border-casino-success bg-casino-success/[0.08] p-3">
        <IconCloudRain size={18} className="shrink-0 text-casino-success" />
        <p className="text-[12px] font-medium text-[#caffeb]" dangerouslySetInnerHTML={{ __html: sanitizeChatRichLine(highlightBold(msg.body)) }} />
      </div>
    )
  }

  const vipClass = msg.vip_rank ? vipColorMap[msg.vip_rank] || '' : ''
  const avatarSrc = msg.avatar_url ? playerApiUrl(msg.avatar_url) : null

  return (
    <div className={`flex gap-3 ${isOwn ? 'bg-casino-primary/[0.04] -mx-2 rounded-casino-md px-2 py-1' : ''}`}>
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=""
          className="h-9 w-9 shrink-0 rounded-casino-sm object-cover"
        />
      ) : (
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-casino-sm text-[12px] font-bold text-white"
          style={{ background: getAvatarColor(msg.username) }}
        >
          {getInitials(msg.username)}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-[13px] font-extrabold ${vipClass || 'text-casino-foreground'} truncate`}>
            {msg.username}
          </span>
          {!isOwn && msg.participant_id && (
            <button
              type="button"
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition ${
                isMuted
                  ? 'text-casino-destructive hover:text-casino-destructive/70'
                  : 'text-casino-muted/50 hover:text-casino-destructive'
              }`}
              onClick={() => onMuteUser(msg.participant_id)}
              aria-label={isMuted ? 'Unmute user' : 'Mute user'}
              title={isMuted ? 'Unmute user' : 'Mute user'}
            >
              {isMuted ? <IconVolumeX size={11} /> : <IconVolume2 size={11} />}
            </button>
          )}
          <span className="shrink-0 text-[11px] font-semibold text-casino-muted">{relativeTime(msg.created_at)}</span>
        </div>
        <p className="break-words text-[13px] font-medium leading-[1.45] text-white/75">
          {renderBody(msg.body, currentUsername)}
        </p>
      </div>
    </div>
  )
}

// --- Helpers ---

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlightBold(raw: string): string {
  return escapeHtml(raw).replace(/\*\*(.+?)\*\*/g, '<strong class="font-extrabold text-white">$1</strong>')
}

function renderBody(body: string, currentUsername?: string) {
  if (!currentUsername) return body
  const mentionRe = new RegExp(`(@${escapeRegex(currentUsername)})`, 'gi')
  const parts = body.split(mentionRe)
  if (parts.length === 1) return body
  return parts.map((part, i) =>
    mentionRe.test(part) ? (
      <span key={i} className="font-bold text-casino-primary">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
