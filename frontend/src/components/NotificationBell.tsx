import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NotificationItem } from '../api/client'
import { useNotifications } from '../lib/notifications-context'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'только что'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

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

export function NotificationBell() {
  const { items, unread, connected, markRead, markAllRead, remove } =
    useNotifications()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement | null>(null)

  // close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const onClickItem = async (n: NotificationItem) => {
    if (!n.is_read) markRead(n.id)
    if (n.link) {
      setOpen(false)
      navigate(n.link)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-bg-panel hover:text-accent"
        title={
          connected
            ? `Уведомления (${unread} новых)`
            : 'Уведомления (соединение восстанавливается…)'
        }
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {!connected && (
          <span
            className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-slate-500"
            title="SSE отсоединён"
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-96 max-h-[80vh] overflow-hidden rounded-xl bg-bg-elevated shadow-xl ring-1 ring-white/10">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-400">
              Уведомления
            </span>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="text-slate-400 hover:text-accent"
                >
                  отметить все прочитанными
                </button>
              )}
              <button
                onClick={() => {
                  setOpen(false)
                  navigate('/notifications')
                }}
                className="text-slate-400 hover:text-accent"
              >
                все →
              </button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Пока ничего нет.
              </div>
            ) : (
              <ul>
                {items.slice(0, 20).map((n) => (
                  <li
                    key={n.id}
                    className={
                      'group border-b border-white/5 last:border-0 ' +
                      (n.is_read ? 'opacity-60' : '')
                    }
                  >
                    <button
                      onClick={() => onClickItem(n)}
                      className="block w-full px-4 py-3 text-left hover:bg-bg-panel/50"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={
                            'mt-1 inline-block h-2 w-2 shrink-0 rounded-full ' +
                            (KIND_DOT[n.kind] || 'bg-slate-400')
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-200">
                            {n.title}
                          </div>
                          {n.body && (
                            <div className="mt-0.5 text-xs text-slate-400">
                              {n.body}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{timeAgo(n.created_at)}</span>
                            {!n.is_read && (
                              <span className="rounded bg-rose-500/15 px-1 py-px font-medium text-rose-300">
                                новое
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation()
                            remove(n.id)
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
          </div>
        </div>
      )}
    </div>
  )
}
