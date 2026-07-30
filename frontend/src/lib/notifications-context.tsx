import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { NotificationItem, api } from '../api/client'
import { getToken } from './auth'
import { useCurrentUser } from './auth-context'

interface NotificationsContextValue {
  items: NotificationItem[]
  unread: number
  connected: boolean
  refresh: () => Promise<void>
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (id: number) => Promise<void>
}

const Ctx = createContext<NotificationsContextValue>({
  items: [],
  unread: 0,
  connected: false,
  refresh: async () => undefined,
  markRead: async () => undefined,
  markAllRead: async () => undefined,
  remove: async () => undefined,
})

const RECENT_LIMIT = 50

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await api.notifications.list({ limit: RECENT_LIMIT })
      setItems(list)
      setUnread(list.filter((n) => !n.is_read).length)
    } catch {
      // ignore — могут быть кратковременные перебои
    }
  }, [])

  // Initial REST fetch + open SSE on user change
  useEffect(() => {
    if (!user) {
      setItems([])
      setUnread(0)
      esRef.current?.close()
      esRef.current = null
      setConnected(false)
      return
    }

    refresh()

    // SSE
    const token = getToken()
    if (!token) return
    const es = new EventSource(
      `/api/notifications/stream?token=${encodeURIComponent(token)}`,
    )
    esRef.current = es
    es.addEventListener('ready', () => setConnected(true))
    es.addEventListener('ping', () => {
      /* heartbeat — состояние подтверждено */
    })
    es.addEventListener('notification', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as NotificationItem
        setItems((prev) => {
          if (prev.some((p) => p.id === data.id)) return prev
          return [data, ...prev].slice(0, RECENT_LIMIT)
        })
        setUnread((c) => c + 1)
      } catch {
        // ignore
      }
    })
    es.onerror = () => {
      // EventSource сам ретраит — просто сбрасываем connected
      setConnected(false)
    }
    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [user, refresh])

  const markRead = useCallback(async (id: number) => {
    setItems((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n,
      ),
    )
    setUnread((c) => Math.max(0, c - 1))
    try {
      await api.notifications.markRead(id)
    } catch {
      refresh()
    }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnread(0)
    try {
      await api.notifications.markAllRead()
    } catch {
      refresh()
    }
  }, [refresh])

  const remove = useCallback(async (id: number) => {
    const wasUnread = items.find((n) => n.id === id)?.is_read === false
    setItems((prev) => prev.filter((n) => n.id !== id))
    if (wasUnread) setUnread((c) => Math.max(0, c - 1))
    try {
      await api.notifications.remove(id)
    } catch {
      refresh()
    }
  }, [items, refresh])

  return (
    <Ctx.Provider
      value={{ items, unread, connected, refresh, markRead, markAllRead, remove }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useNotifications(): NotificationsContextValue {
  return useContext(Ctx)
}
