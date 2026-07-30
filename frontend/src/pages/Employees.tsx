import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, Employee } from '../api/client'
import { ImportXlsxModal } from '../components/employee/ImportXlsxModal'
import { useCurrentUser, useReadOnly } from '../lib/auth-context'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function Employees() {
  const readOnly = useReadOnly()
  const currentUser = useCurrentUser()
  const isCoreTeam = currentUser?.role === 'core_team'
  const navigate = useNavigate()
  const [items, setItems] = useState<Employee[]>([])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [showLeft, setShowLeft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // CoreTeam-фильтр по руководителю / отделу.
  // 'all' — все, 'mine' — без сегментации (для DH равно своим), число —
  // конкретный owner_id.
  const [ownerFilter, setOwnerFilter] = useState<number | 'all'>('all')
  const [deptFilter, setDeptFilter] = useState<number | 'all'>('all')
  const [roleFilter, setRoleFilter] = useState<number | 'all'>('all')
  const [gradeFilter, setGradeFilter] = useState<number | 'all'>('all')
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState(false)

  const refresh = () => api.employees.list().then(setItems)

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message))
  }, [])

  const onAdd = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.employees.create({
        full_name: fullName.trim(),
        email: email.trim() || null,
        position: position.trim() || null,
        hired_at: todayIso(),
      })
      setFullName('')
      setEmail('')
      setPosition('')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const markLeft = async (e: React.MouseEvent, emp: Employee) => {
    e.stopPropagation()
    const today = todayIso()
    const ok = confirm(
      `Пометить «${emp.full_name}» как ушедшего с ${today}?\n\n` +
        'История (МПК, проекты, ревью, ротации) сохраняется. ' +
        'Сотрудник перестаёт учитываться в активных метриках, попадает в ' +
        '«ушло за год».',
    )
    if (!ok) return
    try {
      await api.employees.update(emp.id, { left_at: today })
      await refresh()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const restore = async (e: React.MouseEvent, emp: Employee) => {
    e.stopPropagation()
    if (!confirm(`Вернуть «${emp.full_name}» в активные?`)) return
    try {
      await api.employees.update(emp.id, { left_at: null })
      await refresh()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const hardDelete = async (e: React.MouseEvent, emp: Employee) => {
    e.stopPropagation()
    const ok = confirm(
      `УДАЛИТЬ «${emp.full_name}» полностью?\n\n` +
        'ВНИМАНИЕ: будет удалена ВСЯ история — оценки МПК, процедуры, встречи, ' +
        'ротации, self-review, рекомендации. Это нельзя отменить.\n\n' +
        'Если сотрудник ушёл — лучше использовать «Пометить ушедшим», ' +
        'история сохранится.',
    )
    if (!ok) return
    try {
      await api.employees.delete(emp.id)
      await refresh()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  // Уникальные руководители и отделы (для пикеров CoreTeam).
  const owners = useMemo(() => {
    const map = new Map<number, string>()
    for (const e of items) {
      if (e.owner) map.set(e.owner.id, e.owner.full_name)
    }
    return Array.from(map.entries())
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [items])

  const departments = useMemo(() => {
    const map = new Map<number, string>()
    for (const e of items) {
      if (e.department) map.set(e.department.id, e.department.name)
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const roles = useMemo(() => {
    const map = new Map<number, string>()
    for (const e of items) {
      if (e.role) map.set(e.role.id, e.role.name)
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const grades = useMemo(() => {
    const map = new Map<number, { code: string; sort_order: number }>()
    for (const e of items) {
      if (e.grade) map.set(e.grade.id, { code: e.grade.code, sort_order: e.grade.sort_order ?? 0 })
    }
    return Array.from(map.entries())
      .map(([id, g]) => ({ id, code: g.code, sort_order: g.sort_order }))
      .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
  }, [items])

  const searchLower = search.trim().toLowerCase()
  const visible = items
    .filter((e) => (showLeft ? true : !e.left_at))
    .filter((e) => ownerFilter === 'all' || e.owner_id === ownerFilter)
    .filter((e) => deptFilter === 'all' || e.department?.id === deptFilter)
    .filter((e) => roleFilter === 'all' || e.role?.id === roleFilter)
    .filter((e) => gradeFilter === 'all' || e.grade?.id === gradeFilter)
    .filter((e) => {
      if (!searchLower) return true
      return (
        e.full_name.toLowerCase().includes(searchLower) ||
        (e.email || '').toLowerCase().includes(searchLower) ||
        (e.position || '').toLowerCase().includes(searchLower)
      )
    })
  const leftCount = items.filter((e) => e.left_at).length

  const anyFilterActive =
    !!searchLower ||
    deptFilter !== 'all' ||
    roleFilter !== 'all' ||
    gradeFilter !== 'all' ||
    (isCoreTeam && ownerFilter !== 'all')

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        {!readOnly && (
          <button
            onClick={() => setImporting(true)}
            className="rounded-lg bg-bg-panel px-3 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent"
          >
            ⬆ Импорт из Excel
          </button>
        )}
      </div>

      {importing && (
        <ImportXlsxModal
          onClose={() => setImporting(false)}
          onImported={refresh}
        />
      )}

      {!readOnly && (
        <form
          onSubmit={onAdd}
          className="mb-6 flex flex-wrap gap-2 rounded-2xl bg-bg-elevated p-4"
        >
          <input
            required
            placeholder="ФИО"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-56 rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <input
            placeholder="Должность"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="w-56 rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <button className="rounded-lg bg-accent px-4 font-medium text-bg hover:bg-accent/90">
            Добавить
          </button>
        </form>
      )}
      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <input
          placeholder="Поиск по ФИО, email, должности…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[260px] flex-1 rounded-lg bg-bg-panel px-3 py-2 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        {isCoreTeam && (
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Руководитель
            </span>
            <select
              value={ownerFilter === 'all' ? 'all' : String(ownerFilter)}
              onChange={(e) =>
                setOwnerFilter(
                  e.target.value === 'all' ? 'all' : Number(e.target.value),
                )
              }
              className="rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="all">все ({items.length})</option>
              {owners.map((u) => {
                const cnt = items.filter((e) => e.owner_id === u.id).length
                return (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({cnt})
                  </option>
                )
              })}
            </select>
          </label>
        )}
        {departments.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Отдел
            </span>
            <select
              value={deptFilter === 'all' ? 'all' : String(deptFilter)}
              onChange={(e) =>
                setDeptFilter(
                  e.target.value === 'all' ? 'all' : Number(e.target.value),
                )
              }
              className="rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="all">все</option>
              {departments.map((d) => {
                const cnt = items.filter((e) => e.department?.id === d.id).length
                return (
                  <option key={d.id} value={d.id}>
                    {d.name} ({cnt})
                  </option>
                )
              })}
            </select>
          </label>
        )}
        {roles.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Роль
            </span>
            <select
              value={roleFilter === 'all' ? 'all' : String(roleFilter)}
              onChange={(e) =>
                setRoleFilter(
                  e.target.value === 'all' ? 'all' : Number(e.target.value),
                )
              }
              className="rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="all">все</option>
              {roles.map((r) => {
                const cnt = items.filter((e) => e.role?.id === r.id).length
                return (
                  <option key={r.id} value={r.id}>
                    {r.name} ({cnt})
                  </option>
                )
              })}
            </select>
          </label>
        )}
        {grades.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Грейд
            </span>
            <select
              value={gradeFilter === 'all' ? 'all' : String(gradeFilter)}
              onChange={(e) =>
                setGradeFilter(
                  e.target.value === 'all' ? 'all' : Number(e.target.value),
                )
              }
              className="rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="all">все</option>
              {grades.map((g) => {
                const cnt = items.filter((e) => e.grade?.id === g.id).length
                return (
                  <option key={g.id} value={g.id}>
                    {g.code} ({cnt})
                  </option>
                )
              })}
            </select>
          </label>
        )}
        {anyFilterActive && (
          <button
            onClick={() => {
              setSearch('')
              setOwnerFilter('all')
              setDeptFilter('all')
              setRoleFilter('all')
              setGradeFilter('all')
            }}
            className="text-xs text-slate-500 hover:text-rose-400"
          >
            сброс
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          показано {visible.length} из {items.length}
        </span>
        {leftCount > 0 && (
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showLeft}
              onChange={(e) => setShowLeft(e.target.checked)}
              className="accent-accent"
            />
            показать ушедших ({leftCount})
          </label>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="px-4 py-3">ФИО</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Должность</th>
              <th className="px-4 py-3">Роль / Грейд</th>
              <th className="px-4 py-3">Отдел</th>
              {isCoreTeam && (
                <th className="px-4 py-3">Руководитель</th>
              )}
              <th className="px-4 py-3">В команде с</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={isCoreTeam ? 9 : 8} className="px-4 py-6 text-center text-slate-500">
                  Пока нет сотрудников
                </td>
              </tr>
            )}
            {visible.map((e) => {
              const isLeft = !!e.left_at
              return (
                <tr
                  key={e.id}
                  onClick={() => navigate(`/employees/${e.id}`)}
                  className={
                    'cursor-pointer border-t border-white/5 hover:bg-bg-panel/40 ' +
                    (isLeft ? 'opacity-60' : '')
                  }
                >
                  <td className="px-4 py-3">{e.full_name}</td>
                  <td className="px-4 py-3 text-slate-400">{e.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{e.position || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {e.role ? (
                      <>
                        {e.role.name}
                        {e.grade && ` · ${e.grade.code}`}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {e.department?.name || '—'}
                  </td>
                  {isCoreTeam && (
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {e.owner?.full_name || '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(e.hired_at)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {isLeft ? (
                      <span className="text-rose-400">
                        ушёл {formatDate(e.left_at)}
                      </span>
                    ) : (
                      <span className="text-emerald-400">активен</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!readOnly && (
                      <div className="flex items-center justify-end gap-3">
                        {isLeft ? (
                          <button
                            onClick={(ev) => restore(ev, e)}
                            className="text-xs text-slate-400 hover:text-emerald-400"
                            title="Вернуть в активные"
                          >
                            восстановить
                          </button>
                        ) : (
                          <button
                            onClick={(ev) => markLeft(ev, e)}
                            className="text-xs text-slate-400 hover:text-amber-400"
                            title="Сотрудник уволился / перешёл в другой отдел. История сохранится."
                          >
                            ушёл
                          </button>
                        )}
                        <button
                          onClick={(ev) => hardDelete(ev, e)}
                          className="text-xs text-slate-500 hover:text-red-400"
                          title="Удалить запись полностью с историей. Используйте только для ошибочно созданных записей."
                        >
                          удалить
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
