import { FormEvent, useEffect, useState } from 'react'

import {
  Assignment,
  CurrentUser,
  Employee,
  api,
} from '../../api/client'
import { useCurrentUser } from '../../lib/auth-context'

type TargetKind = 'user' | 'employee'

export function AssignmentCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (a: Assignment) => void
}) {
  const me = useCurrentUser()
  const isCoreTeam = me?.role === 'core_team'

  // CoreTeam часто ставит на руководителя — стартуем с user.
  // DH чаще ставит на своего сотрудника — стартуем с employee.
  const [targetKind, setTargetKind] = useState<TargetKind>(
    isCoreTeam ? 'user' : 'employee',
  )
  const [users, setUsers] = useState<CurrentUser[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [targetUserId, setTargetUserId] = useState<number | ''>('')
  const [targetEmpId, setTargetEmpId] = useState<number | ''>('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueLocal, setDueLocal] = useState('')

  const [file, setFile] = useState<File | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.users
      .list()
      .then((list) => {
        // нельзя самому себе
        setUsers(list.filter((u) => u.id !== me?.id))
      })
      .catch(() => undefined)
    api.employees
      .list()
      .then(setEmployees)
      .catch(() => undefined)
  }, [me?.id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Заголовок обязателен')
      return
    }
    if (targetKind === 'user' && !targetUserId) {
      setError('Выберите руководителя-адресата')
      return
    }
    if (targetKind === 'employee' && !targetEmpId) {
      setError('Выберите сотрудника-адресата')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const a = await api.assignments.create({
        title: title.trim(),
        description_md: description.trim() || null,
        due_at: dueLocal ? new Date(dueLocal).toISOString() : null,
        assignee_user_id:
          targetKind === 'user' ? Number(targetUserId) : null,
        assignee_employee_id:
          targetKind === 'employee' ? Number(targetEmpId) : null,
      })
      // Если есть файл — загрузим его
      let final = a
      if (file) {
        try {
          final = await api.assignments.uploadAttachment(a.id, file)
        } catch (err) {
          // поручение создано, но файл не загрузился — сообщим, не валим
          alert(
            'Поручение создано, но вложение не загружено: ' +
              (err as Error).message,
          )
        }
      }
      onCreated(final)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-4 rounded-2xl bg-bg-elevated p-6 ring-1 ring-white/10"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Новое поручение</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            закрыть
          </button>
        </div>

        <label className="block">
          <div className="mb-1 text-xs text-slate-400">Заголовок *</div>
          <input
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Что нужно сделать"
            className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </label>

        <label className="block">
          <div className="mb-1 text-xs text-slate-400">Описание (markdown)</div>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Контекст, ссылки, ожидаемый результат…"
            className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-xs text-slate-400">Срок</div>
            <input
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Можно оставить пустым — без срока
            </div>
          </label>
          <label className="block">
            <div className="mb-1 text-xs text-slate-400">Вложение</div>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent hover:file:bg-accent/25"
            />
            {file && (
              <div className="mt-1 text-[11px] text-slate-500">
                {file.name} · {Math.round(file.size / 1024)} КБ
              </div>
            )}
          </label>
        </div>

        <div className="rounded-lg bg-bg-panel/40 p-3 ring-1 ring-white/5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Адресат
          </div>
          <div className="mb-3 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={targetKind === 'user'}
                onChange={() => setTargetKind('user')}
                className="accent-accent"
              />
              <span className="text-slate-300">Руководителю</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={targetKind === 'employee'}
                onChange={() => setTargetKind('employee')}
                className="accent-accent"
              />
              <span className="text-slate-300">Сотруднику</span>
              {!isCoreTeam && (
                <span className="text-slate-500">(только своему)</span>
              )}
            </label>
          </div>

          {targetKind === 'user' ? (
            <select
              value={targetUserId}
              onChange={(e) =>
                setTargetUserId(
                  e.target.value === '' ? '' : Number(e.target.value),
                )
              }
              className="w-full rounded bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="">— выберите пользователя —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                  {u.role === 'department_head' && ' · руководитель отдела'}
                  {u.role === 'manager' && ' · PM'}
                  {u.role === 'core_team' && ' · CoreTeam'}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={targetEmpId}
              onChange={(e) =>
                setTargetEmpId(
                  e.target.value === '' ? '' : Number(e.target.value),
                )
              }
              className="w-full rounded bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="">— выберите сотрудника —</option>
              {employees
                .filter((e) => !e.left_at)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                    {e.position && ` · ${e.position}`}
                    {isCoreTeam &&
                      e.owner &&
                      ` · отчитывается ${e.owner.full_name}`}
                  </option>
                ))}
            </select>
          )}
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Создание…' : 'Создать поручение'}
          </button>
        </div>
      </form>
    </div>
  )
}
