import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NotificationItem, api } from '../api/client'
import { useNotifications } from '../lib/notifications-context'

const KIND_DOT: Record<string, string> = {
  // assignments
  assignment_created: 'bg-accent',
  assignment_pending_review: 'bg-violet-400',
  assignment_done: 'bg-emerald-400',
  assignment_returned: 'bg-amber-400',
  assignment_cancelled: 'bg-slate-400',
  assignment_due_soon: 'bg-amber-400',
  assignment_overdue: 'bg-rose-500',
  // rotations
  rotation_proposed: 'bg-accent',
  rotation_accepted: 'bg-emerald-400',
  rotation_rejected: 'bg-rose-400',
  rotation_cancelled: 'bg-slate-400',
  rotation_completed: 'bg-emerald-400',
  rotation_reverted: 'bg-amber-400',
  // dept maturity
  dept_maturity_started: 'bg-accent',
  dept_maturity_done: 'bg-emerald-400',
  // AI jobs
  ai_job_done: 'bg-emerald-400',
  ai_job_error: 'bg-rose-500',
  // self-review reminders
  self_review_stuck: 'bg-amber-400',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function NotificationsPage() {
  const { unread, markAllRead, markRead, remove } = useNotifications()
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await api.notifications.list({ limit: 200, unread_only: unreadOnly })
      setItems(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly])

  const open = async (n: NotificationItem) => {
    if (!n.is_read) {
      await markRead(n.id)
      setItems((prev) =>
        prev.map((p) => (p.id === n.id ? { ...p, is_read: true } : p)),
      )
    }
    if (n.link) navigate(n.link)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Уведомления</h1>
          <p className="mt-1 text-sm text-slate-500">
            История событий за последние 30 дней.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="accent-accent"
            />
            только непрочитанные
          </label>
          {unread > 0 && (
            <button
              onClick={async () => {
                await markAllRead()
                refresh()
              }}
              className="rounded bg-bg-panel px-3 py-1 text-xs text-slate-300 ring-1 ring-white/5 hover:text-accent"
            >
              Отметить все прочитанными
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          {unreadOnly
            ? 'Непрочитанных уведомлений нет.'
            : 'Уведомлений пока не было.'}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-bg-elevated ring-1 ring-white/5">
          {items.map((n) => (
            <li
              key={n.id}
              className={
                'group border-b border-white/5 last:border-0 ' +
                (n.is_read ? 'opacity-70' : '')
              }
            >
              <button
                onClick={() => open(n)}
                className="block w-full px-5 py-3 text-left hover:bg-bg-panel/40"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={
                      'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ' +
                      (KIND_DOT[n.kind] || 'bg-slate-400')
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-slate-200">
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                          новое
                        </span>
                      )}
                    </div>
                    {n.body && (
                      <div className="mt-0.5 text-xs text-slate-400">
                        {n.body}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-slate-500">
                      {formatDate(n.created_at)}
                      {' · '}
                      <span className="text-slate-600">{n.kind}</span>
                    </div>
                  </div>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation()
                      remove(n.id)
                      setItems((prev) => prev.filter((p) => p.id !== n.id))
                    }}
                    className="invisible text-xs text-slate-500 hover:text-rose-400 group-hover:visible"
                    title="Удалить"
                  >
                    ✕
                  </button>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        Уведомления автоматически удаляются спустя 30 дней.
      </p>
    </div>
  )
}
