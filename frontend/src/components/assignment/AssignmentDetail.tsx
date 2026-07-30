import { useEffect, useRef, useState } from 'react'

import {
  Assignment,
  AssignmentStatus,
  api,
} from '../../api/client'
import { useCurrentUser } from '../../lib/auth-context'

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  open: 'открыто',
  in_progress: 'в работе',
  pending_review: 'на подтверждении',
  done: 'выполнено',
  cancelled: 'отменено',
}

const STATUS_TONE: Record<AssignmentStatus, string> = {
  open: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-accent/15 text-accent',
  pending_review: 'bg-violet-500/15 text-violet-300',
  done: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-slate-500/15 text-slate-400',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

function fromLocalDatetimeInput(local: string): string | null {
  if (!local) return null
  // local input is "YYYY-MM-DDTHH:mm" в локали — превращаем в ISO
  return new Date(local).toISOString()
}

export function AssignmentDetail({
  assignmentId,
  onClose,
  onChanged,
}: {
  assignmentId: number
  onClose: () => void
  onChanged: () => void
}) {
  const me = useCurrentUser()
  const [a, setA] = useState<Assignment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDue, setEditDue] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = () => {
    api.assignments
      .get(assignmentId)
      .then((x) => {
        setA(x)
        setEditTitle(x.title)
        setEditDesc(x.description_md || '')
        setEditDue(toLocalDatetimeInput(x.due_at))
      })
      .catch((e) => setError((e as Error).message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!a) return <div className="text-slate-500">Загрузка…</div>

  const isCreator = me?.id === a.created_by_id
  // Адресат: либо адресат-User это я, либо назначено на сотрудника, чей
  // owner — я (для assignee-employee серверный guard уточнит).
  const isAssigneeUser = a.assignee.kind === 'user' && me?.id === a.assignee.id
  // Для employee-адресата фронт показывает кнопки оптимистично —
  // если backend откажет (DH чужого employee), увидим alert.
  const isAssignee =
    isAssigneeUser ||
    (a.assignee.kind === 'employee' && me?.role === 'department_head')

  const setStatus = async (status: AssignmentStatus) => {
    setBusy(true)
    try {
      const updated = await api.assignments.update(assignmentId, { status })
      setA(updated)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const updated = await api.assignments.update(assignmentId, {
        title: editTitle.trim() || a.title,
        description_md: editDesc.trim() || null,
        due_at: editDue ? fromLocalDatetimeInput(editDue) : null,
      })
      setA(updated)
      setEditing(false)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Удалить поручение?')) return
    try {
      await api.assignments.delete(assignmentId)
      onChanged()
      onClose()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const onUpload = async (file: File) => {
    setBusy(true)
    try {
      const updated = await api.assignments.uploadAttachment(assignmentId, file)
      setA(updated)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removeAttachment = async () => {
    if (!confirm('Удалить вложение?')) return
    setBusy(true)
    try {
      const updated = await api.assignments.deleteAttachment(assignmentId)
      setA(updated)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
      <div className="flex flex-wrap items-baseline gap-3">
        {!editing ? (
          <h2 className="text-lg font-semibold">{a.title}</h2>
        ) : (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="flex-1 rounded bg-bg-panel px-3 py-1.5 text-sm font-semibold ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        )}
        <span
          className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[a.status]}`}
        >
          {STATUS_LABEL[a.status]}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-xs text-slate-500 hover:text-slate-300"
        >
          закрыть
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>
          Создал:{' '}
          <span className="text-slate-200">{a.created_by_name || '—'}</span>{' '}
          · {formatDate(a.created_at)}
        </span>
        <span>·</span>
        <span>
          Адресат:{' '}
          <span className="text-slate-200">{a.assignee.full_name}</span>
          {a.assignee.kind === 'user' && (
            <span className="ml-1 text-slate-500">(руководитель)</span>
          )}
          {a.assignee.kind === 'employee' && (
            <span className="ml-1 text-slate-500">(сотрудник)</span>
          )}
        </span>
        <span>·</span>
        <span>
          Срок:{' '}
          {!editing ? (
            <span className="text-slate-200">
              {a.due_at ? formatDate(a.due_at) : 'без срока'}
            </span>
          ) : (
            <input
              type="datetime-local"
              value={editDue}
              onChange={(e) => setEditDue(e.target.value)}
              className="rounded bg-bg-panel px-2 py-0.5 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          )}
        </span>
        {a.completed_at && (
          <>
            <span>·</span>
            <span className="text-emerald-400">
              Закрыто {formatDate(a.completed_at)}
            </span>
          </>
        )}
      </div>

      {/* description */}
      <div className="rounded-lg bg-bg-panel/40 p-3 ring-1 ring-white/5">
        {!editing ? (
          a.description_md ? (
            <p className="whitespace-pre-wrap text-sm text-slate-300">
              {a.description_md}
            </p>
          ) : (
            <p className="text-sm italic text-slate-500">Без описания.</p>
          )
        ) : (
          <textarea
            rows={6}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Описание (markdown)"
            className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        )}
      </div>

      {/* attachment */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Вложение:</span>
        {a.has_attachment ? (
          <>
            <span className="text-slate-300">
              📎 {a.attachment_filename}
              {a.attachment_size_bytes && (
                <> · {Math.round(a.attachment_size_bytes / 1024)} КБ</>
              )}
            </span>
            <button
              onClick={() =>
                api.assignments
                  .downloadAttachment(
                    assignmentId,
                    a.attachment_filename || 'attachment',
                  )
                  .catch((e) => alert((e as Error).message))
              }
              className="rounded bg-bg-panel px-2 py-0.5 text-slate-300 ring-1 ring-white/5 hover:text-accent"
            >
              скачать
            </button>
            {isCreator && (
              <button
                onClick={removeAttachment}
                className="text-slate-500 hover:text-rose-400"
              >
                удалить
              </button>
            )}
          </>
        ) : isCreator ? (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded bg-accent/15 px-2 py-0.5 text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              + загрузить файл
            </button>
            <span className="text-slate-500">до 20 МБ</span>
          </>
        ) : (
          <span className="text-slate-500">нет</span>
        )}
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        {!editing && a.status === 'pending_review' && (
          <span className="text-xs text-violet-300">
            {isCreator
              ? 'Адресат заявил выполнение — подтвердите или верните на доработку.'
              : 'Ожидаем подтверждения от инициатора.'}
          </span>
        )}
        {!editing && (
          <>
            {/* Адресат: взять в работу */}
            {isAssignee &&
              (a.status === 'open') && (
                <button
                  disabled={busy}
                  onClick={() => setStatus('in_progress')}
                  className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25"
                >
                  Взять в работу
                </button>
              )}
            {/* Адресат: заявить выполнение */}
            {isAssignee &&
              (a.status === 'open' || a.status === 'in_progress') && (
                <button
                  disabled={busy}
                  onClick={() => setStatus('pending_review')}
                  className="rounded bg-violet-500/15 px-3 py-1 text-xs text-violet-300 hover:bg-violet-500/25"
                  title="Отправить инициатору на подтверждение"
                >
                  Отметить выполненным
                </button>
              )}
            {/* Адресат: отозвать заявку (вернул в работу) */}
            {isAssignee && a.status === 'pending_review' && !isCreator && (
              <button
                disabled={busy}
                onClick={() => setStatus('in_progress')}
                className="rounded px-3 py-1 text-xs text-slate-400 hover:text-amber-300"
                title="Отозвать заявку — вернуть в работу"
              >
                Отозвать
              </button>
            )}
            {/* Инициатор: подтвердить выполнение */}
            {isCreator && a.status === 'pending_review' && (
              <button
                disabled={busy}
                onClick={() => setStatus('done')}
                className="rounded bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
              >
                Подтвердить выполнение
              </button>
            )}
            {/* Инициатор: вернуть на доработку */}
            {isCreator && a.status === 'pending_review' && (
              <button
                disabled={busy}
                onClick={() => setStatus('in_progress')}
                className="rounded px-3 py-1 text-xs text-amber-300 hover:text-amber-200"
              >
                Вернуть на доработку
              </button>
            )}
            {/* Инициатор: переоткрыть */}
            {isCreator && a.status === 'done' && (
              <button
                disabled={busy}
                onClick={() => setStatus('open')}
                className="rounded px-3 py-1 text-xs text-slate-400 hover:text-amber-300"
              >
                Переоткрыть
              </button>
            )}
            {/* Инициатор: отмена */}
            {isCreator &&
              (a.status === 'open' ||
                a.status === 'in_progress' ||
                a.status === 'pending_review') && (
                <button
                  disabled={busy}
                  onClick={() => setStatus('cancelled')}
                  className="rounded px-3 py-1 text-xs text-slate-400 hover:text-rose-400"
                >
                  Отменить
                </button>
              )}
            {/* Инициатор: вернуть отменённое */}
            {isCreator && a.status === 'cancelled' && (
              <button
                disabled={busy}
                onClick={() => setStatus('open')}
                className="rounded px-3 py-1 text-xs text-slate-400 hover:text-amber-300"
              >
                Восстановить
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isCreator &&
            (!editing ? (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  редактировать
                </button>
                <button
                  onClick={remove}
                  className="rounded px-3 py-1 text-xs text-slate-500 hover:text-rose-400"
                >
                  удалить
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={busy}
                  onClick={save}
                  className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg hover:bg-accent/90"
                >
                  Сохранить
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setEditTitle(a.title)
                    setEditDesc(a.description_md || '')
                    setEditDue(toLocalDatetimeInput(a.due_at))
                  }}
                  className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  Отмена
                </button>
              </>
            ))}
        </div>
      </div>
    </div>
  )
}
