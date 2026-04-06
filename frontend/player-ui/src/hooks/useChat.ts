import { useCallback, useEffect, useRef, useState } from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

export type ChatMessage = {
  id: number
  user_id: string
  username: string
  body: string
  msg_type: 'user' | 'system' | 'rain'
  created_at: string
  vip_rank?: 'gold' | 'silver' | 'bronze' | 'mod' | null
  avatar_url?: string | null
  mentions?: string[]
}

type Envelope = {
  type: string
  data: any
}

export type UseChatReturn = {
  messages: ChatMessage[]
  sendMessage: (body: string) => void
  connected: boolean
  onlineCount: number
  unreadCount: number
  resetUnread: () => void
  error: string | null
}

const MAX_MESSAGES = 200
const RECONNECT_BASE = 1000
const RECONNECT_MAX = 30000

export function useChat(accessToken: string | null, enabled: boolean): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const enabledRef = useRef(enabled)
  const tokenRef = useRef(accessToken)
  const pendingMessages = useRef<ChatMessage[]>([])
  const rafId = useRef<number | null>(null)

  enabledRef.current = enabled
  tokenRef.current = accessToken

  const resetUnread = useCallback(() => setUnreadCount(0), [])

  const flushPending = useCallback(() => {
    rafId.current = null
    const batch = pendingMessages.current
    if (batch.length === 0) return
    pendingMessages.current = []
    setMessages(prev => {
      const next = [...prev, ...batch]
      return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next
    })
    if (!enabledRef.current) {
      setUnreadCount(c => c + batch.length)
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    if (rafId.current == null) {
      rafId.current = requestAnimationFrame(flushPending)
    }
  }, [flushPending])

  useEffect(() => {
    if (!enabled || !accessToken) return

    let disposed = false
    let delay = RECONNECT_BASE
    let timer: ReturnType<typeof setTimeout> | null = null

    function openConnection() {
      const tok = tokenRef.current
      if (!tok || disposed) return

      const apiOrigin = (import.meta.env.VITE_PLAYER_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') ?? ''
      const wsBase = apiOrigin
        ? apiOrigin.replace(/^http/, 'ws')
        : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`

      const url = `${wsBase}/v1/chat/ws?token=${encodeURIComponent(tok)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) { ws.close(); return }
        setConnected(true)
        setError(null)
        delay = RECONNECT_BASE

        fetch(playerApiUrl('/v1/chat/history?limit=50'), {
          headers: { Authorization: `Bearer ${tok}` },
        })
          .then(r => r.ok ? r.json() : [])
          .then((history: ChatMessage[]) => {
            if (!disposed && Array.isArray(history) && history.length > 0) {
              setMessages(history)
            }
          })
          .catch(() => {})
      }

      ws.onmessage = (e) => {
        try {
          const env: Envelope = JSON.parse(e.data)
          switch (env.type) {
            case 'message':
            case 'system':
            case 'rain':
              pendingMessages.current.push(env.data as ChatMessage)
              scheduleFlush()
              break
            case 'delete':
              setMessages(prev => prev.filter(m => m.id !== env.data.message_id))
              break
            case 'online_count':
              setOnlineCount(env.data.count ?? 0)
              break
            case 'error':
              setError(env.data.message ?? 'Unknown error')
              setTimeout(() => setError(null), 5000)
              break
          }
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        if (!disposed && enabledRef.current && tokenRef.current) {
          timer = setTimeout(() => {
            delay = Math.min(delay * 2, RECONNECT_MAX)
            openConnection()
          }, delay)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    openConnection()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (rafId.current) cancelAnimationFrame(rafId.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, accessToken, scheduleFlush])

  const sendMessage = useCallback((body: string) => {
    const trimmed = body.trim()
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'message', body: trimmed }))
  }, [])

  return { messages, sendMessage, connected, onlineCount, unreadCount, resetUnread, error }
}
