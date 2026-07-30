import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { UpcomingMeeting, api } from '../api/client'

const KIND_BADGE: Record<UpcomingMeeting['kind'], { label: string; cls: string }> =
  {
    mpk: { label: 'МПК', cls: 'bg-accent/15 text-accent' },
    hiring: { label: 'Найм', cls: 'bg-amber-500/15 text-amber-300' },
    self_review: { label: 'Self-Review', cls: 'bg-emerald-500/15 text-emerald-300' },
  }

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  const time = d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
  if (sameDay) return `сегодня ${time}`
  if (isTomorrow) return `завтра ${time}`
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function navUrl(m: UpcomingMeeting): string {
  if (m.kind === 'self_review') {
    return `/self-review/${m.employee_id}/${m.self_review_id}`
  }
  if (m.kind === 'hiring') {
    return `/hiring/${m.employee_id}`
  }
  return `/employees/${m.employee_id}`
}

export function UpcomingMeetingsWidget({
  filterKinds,
  filterEmployeeId,
  days = 30,
  limit = 20,
  emptyHint,
}: {
  /** Если задан — показывает только встречи указанных типов. */
  filterKinds?: UpcomingMeeting['kind'][]
  /** Если задан — только встречи этого сотрудника/кандидата. */
  filterEmployeeId?: number
  days?: number
  limit?: number
  emptyHint?: string
}) {
  const navigate = useNavigate()
  const [items, setItems] = useState<UpcomingMeeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.dashboard
      .upcoming(days, limit)
      .then((list) => {
        if (cancelled) return
        let filtered = list
        if (filterKinds) filtered = filtered.filter((m) => filterKinds.includes(m.kind))
        if (filterEmployeeId !== undefined)
          filtered = filtered.filter((m) => m.employee_id === filterEmployeeId)
        setItems(filtered)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [days, limit, filterKinds?.join(','), filterEmployeeId])

  if (loading) return <div className="text-xs text-slate-500">Загрузка…</div>

  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-bg-elevated px-6 py-5 text-center text-sm text-slate-500">
        {emptyHint || 'Нет назначенных встреч в ближайшие 30 дней.'}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-bg-elevated">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-panel text-slate-400">
          <tr>
            <th className="px-4 py-2.5">Когда</th>
            <th className="px-4 py-2.5">Тип</th>
            <th className="px-4 py-2.5">Кому</th>
            <th className="px-4 py-2.5">Описание</th>
            <th className="px-4 py-2.5 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((m, i) => {
            const badge = KIND_BADGE[m.kind]
            return (
              <tr
                key={`${m.kind}-${m.meeting_id ?? m.self_review_id ?? i}`}
                onClick={() => navigate(navUrl(m))}
                className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
              >
                <td className="px-4 py-2.5 text-slate-300">{formatWhen(m.when)}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {m.employee_name}
                  {m.employee_kind === 'candidate' && (
                    <span className="ml-2 text-xs text-amber-400">кандидат</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-400">{m.title}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">→</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
