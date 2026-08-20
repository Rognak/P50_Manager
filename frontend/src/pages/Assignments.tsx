import { useEffect, useMemo, useState } from 'react'

import {
  Assignment,
  AssignmentListItem,
  AssignmentScope,
  AssignmentStatus,
  api,
} from '../api/client'
import { AssignmentDetail } from '../components/assignment/AssignmentDetail'
import { AssignmentCreateModal } from '../components/assignment/AssignmentCreateModal'
import { useCurrentUser } from '../lib/auth-context'

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  open: 'открыто',
  in_progress: 'в работе',
  pending_review: 'на подтверждении',
  done: 'выполнено',
  cancelled: 'отменено',
}

const STATUS_TONE: Record<AssignmentStatus, string> = {
  open: 'text-amber-300',
  in_progress: 'text-accent',
  pending_review: 'text-ink-secondary',
  done: 'text-emerald-400',
  cancelled: 'text-slate-500',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function dueTone(due: string | null, status: AssignmentStatus): string {
  if (status === 'done' || status === 'cancelled') return 'text-slate-500'
  if (!due) return 'text-slate-500'
  const ms = new Date(due).getTime() - Date.now()
  if (ms < 0) return 'text-rose-400'
  if (ms < 3 * 86400000) return 'text-amber-400'
  return 'text-slate-300'
}

function dueLabel(due: string | null, status: AssignmentStatus): string {
  if (!due) return 'без срока'
  const f = formatDate(due)
  if (status === 'done' || status === 'cancelled') return f
  const ms = new Date(due).getTime() - Date.now()
  if (ms < 0) return `${f} (просрочено)`
  const days = Math.ceil(ms / 86400000)
  if (days < 8) return `${f} (через ${days} дн)`
  return f
}

type Tab = AssignmentScope

export function Assignments() {
  const me = useCurrentUser()
  const isCoreTeam = me?.role === 'core_team'
  const [tab, setTab] = useState<Tab>('assigned')
  const [items, setItems] = useState<AssignmentListItem[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | AssignmentStatus>(
    'all',
  )
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await api.assignments.list(
        tab,
        statusFilter === 'all' ? undefined : statusFilter,
      )
      setItems(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter])

  const counts = useMemo(() => {
    const c: Record<AssignmentStatus, number> = {
      open: 0,
      in_progress: 0,
      pending_review: 0,
      done: 0,
      cancelled: 0,
    }
    for (const a of items) c[a.status]++
    return c
  }, [items])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'assigned', label: 'На меня' },
    { key: 'created', label: 'Мои поручения' },
  ]
  if (isCoreTeam) tabs.push({ key: 'all', label: 'Все' })

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Поручения</h1>
          <p className="mt-1 text-sm text-slate-500">
            Задачи с дедлайном между руководителями и сотрудниками. CoreTeam
            ставит поручение любому, руководитель — своим.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
        >
          + Создать поручение
        </button>
      </div>

      <div className="flex gap-1 border-b border-white/5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key)
              setOpenId(null)
            }}
            className={`-mb-px px-4 py-2 text-sm transition ${
              tab === t.key
                ? 'border-b-2 border-accent text-accent'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-2 text-xs">
          <span className="text-slate-500">Статус:</span>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | AssignmentStatus)
            }
            className="rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            <option value="all">все ({items.length})</option>
            <option value="open">открыто ({counts.open})</option>
            <option value="in_progress">в работе ({counts.in_progress})</option>
            <option value="pending_review">
              на подтверждении ({counts.pending_review})
            </option>
            <option value="done">выполнено ({counts.done})</option>
            <option value="cancelled">отменено ({counts.cancelled})</option>
          </select>
        </div>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}
      {loading ? (
        <div className="text-slate-500">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          {tab === 'assigned'
            ? 'На вас ничего не назначено.'
            : tab === 'created'
              ? 'Вы ещё не создавали поручений.'
              : 'Поручений пока нет.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">Поручение</th>
                <th className="px-4 py-3">
                  {tab === 'created' ? 'Адресат' : 'Создал'}
                </th>
                {tab === 'all' && (
                  <th className="px-4 py-3">Адресат</th>
                )}
                <th className="px-4 py-3">Срок</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3 text-xs text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}
                  className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-200">{a.title}</div>
                    {a.has_attachment && (
                      <div className="mt-0.5 text-xs text-slate-500">
                        📎 вложение
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {tab === 'created'
                      ? `${a.assignee.full_name}${
                          a.assignee.kind === 'user' ? ' · руководитель' : ''
                        }`
                      : a.created_by_name || '—'}
                  </td>
                  {tab === 'all' && (
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {a.assignee.full_name}
                      {a.assignee.kind === 'user' && (
                        <span className="ml-1 text-slate-500">
                          · руководитель
                        </span>
                      )}
                    </td>
                  )}
                  <td className={`px-4 py-3 text-xs ${dueTone(a.due_at, a.status)}`}>
                    {dueLabel(a.due_at, a.status)}
                  </td>
                  <td className={`px-4 py-3 text-xs ${STATUS_TONE[a.status]}`}>
                    {STATUS_LABEL[a.status]}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {openId === a.id ? '▾' : '▸'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId !== null && (
        <AssignmentDetail
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}

      {creating && (
        <AssignmentCreateModal
          onClose={() => setCreating(false)}
          onCreated={(a: Assignment) => {
            setCreating(false)
            setTab('created')
            setOpenId(a.id)
            refresh()
          }}
        />
      )}
    </div>
  )
}
