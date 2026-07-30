import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  Department,
  Grade,
  ProjectListItem,
  Role,
  VacancyListItem,
  VacancyStatus,
  api,
} from '../api/client'
import { useReadOnly } from '../lib/auth-context'

const STATUS_LABEL: Record<VacancyStatus, string> = {
  open: 'открыта',
  closed: 'закрыта',
}

const STATUS_TONE: Record<VacancyStatus, string> = {
  open: 'text-emerald-400 bg-emerald-500/15',
  closed: 'text-slate-400 bg-slate-500/15',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function VacancyList() {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const [items, setItems] = useState<VacancyListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | VacancyStatus>('open')

  // create form
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<number | ''>('')
  const [departmentId, setDepartmentId] = useState<number | ''>('')
  const [roleId, setRoleId] = useState<number | ''>('')
  const [gradeId, setGradeId] = useState<number | ''>('')
  const [requirements, setRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await api.vacancies.list(
        statusFilter === 'all' ? undefined : { status: statusFilter },
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
  }, [statusFilter])

  useEffect(() => {
    api.projects.list().then(setProjects).catch(() => undefined)
    api.departments.list().then(setDepartments).catch(() => undefined)
    api.mpk.roles().then(setRoles).catch(() => undefined)
    api.mpk.grades().then(setGrades).catch(() => undefined)
  }, [])

  const generateTemplate = async () => {
    try {
      const res = await api.vacancies.requirementsTemplate({
        role_id: roleId === '' ? null : Number(roleId),
        grade_id: gradeId === '' ? null : Number(gradeId),
        project_id: projectId === '' ? null : Number(projectId),
      })
      setRequirements(res.requirements_md)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const create = async () => {
    setCreateError(null)
    if (!title.trim()) {
      setCreateError('Введите название вакансии')
      return
    }
    if (projectId === '' && departmentId === '') {
      setCreateError('Привяжите вакансию к проекту или отделу')
      return
    }
    setBusy(true)
    try {
      const v = await api.vacancies.create({
        title: title.trim(),
        project_id: projectId === '' ? null : Number(projectId),
        department_id: departmentId === '' ? null : Number(departmentId),
        role_id: roleId === '' ? null : Number(roleId),
        grade_id: gradeId === '' ? null : Number(gradeId),
        requirements_md: requirements.trim() || null,
      })
      navigate(`/vacancies/${v.id}`)
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    let open = 0
    let closed = 0
    for (const v of items) {
      if (v.status === 'open') open++
      else closed++
    }
    return { open, closed, all: items.length }
  }, [items])

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Вакансии</h1>
          <p className="mt-1 text-sm text-slate-500">
            Открытые позиции для найма. Кандидаты привязываются к конкретной
            вакансии — её требования становятся контекстом для AI-скрининга
            резюме.
          </p>
        </div>
        {!readOnly && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
          >
            + Создать вакансию
          </button>
        )}
      </div>

      {showCreate && (
        <div className="space-y-3 rounded-2xl bg-bg-elevated p-5">
          <div className="text-sm font-semibold text-slate-200">
            Новая вакансия
          </div>

          <input
            placeholder="Название (например: Senior Backend Python — Уберизация НТЦ) *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">Проект</span>
              <select
                value={projectId}
                onChange={(e) =>
                  setProjectId(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— не выбран —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.code && ` (${p.code})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">
                Отдел/практика (или вместо проекта)
              </span>
              <select
                value={departmentId}
                onChange={(e) =>
                  setDepartmentId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— не выбран —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">Роль МПК</span>
              <select
                value={roleId}
                onChange={(e) =>
                  setRoleId(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— не выбрана —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">Грейд</span>
              <select
                value={gradeId}
                onChange={(e) =>
                  setGradeId(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— не выбран —</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <label className="block text-xs">
              <span className="text-slate-400">Требования (markdown)</span>
            </label>
            <button
              type="button"
              onClick={generateTemplate}
              className="rounded bg-bg-panel px-3 py-1 text-xs text-slate-300 ring-1 ring-white/5 hover:text-accent"
              title="Заполнит стартовый шаблон на основе выбранных role/grade/project"
            >
              сгенерировать шаблон
            </button>
          </div>
          <textarea
            rows={12}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder="## Что мы ищем
**Позиция:** Senior Backend Python

## Принцип отбора
Сильный инженер > узкоспециальное соответствие. ..."
            className="w-full rounded-lg bg-bg-panel px-3 py-2 font-mono text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
          />

          {createError && (
            <div className="text-sm text-red-400">{createError}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? 'Сохраняем…' : 'Создать вакансию'}
            </button>
            <button
              onClick={() => {
                setShowCreate(false)
                setTitle('')
                setProjectId('')
                setDepartmentId('')
                setRoleId('')
                setGradeId('')
                setRequirements('')
                setCreateError(null)
              }}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => setStatusFilter('all')}
          className={
            'rounded-full px-3 py-1 ring-1 ring-white/5 ' +
            (statusFilter === 'all'
              ? 'bg-accent/15 text-accent'
              : 'bg-bg-panel text-slate-300 hover:text-accent')
          }
        >
          все ({counts.all})
        </button>
        <button
          onClick={() => setStatusFilter('open')}
          className={
            'rounded-full px-3 py-1 ring-1 ring-white/5 ' +
            (statusFilter === 'open'
              ? 'bg-accent/15 text-accent'
              : 'bg-bg-panel text-slate-300 hover:text-accent')
          }
        >
          открытые ({counts.open})
        </button>
        <button
          onClick={() => setStatusFilter('closed')}
          className={
            'rounded-full px-3 py-1 ring-1 ring-white/5 ' +
            (statusFilter === 'closed'
              ? 'bg-accent/15 text-accent'
              : 'bg-bg-panel text-slate-300 hover:text-accent')
          }
        >
          закрытые ({counts.closed})
        </button>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}
      {loading ? (
        <div className="text-slate-500">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Вакансий в этом фильтре нет.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">Вакансия</th>
                <th className="px-4 py-3">Проект / Отдел</th>
                <th className="px-4 py-3">Роль / Грейд</th>
                <th className="px-4 py-3 text-center">Кандидатов</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Создана</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => navigate(`/vacancies/${v.id}`)}
                  className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                >
                  <td className="px-4 py-3 font-medium">{v.title}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {v.project_name || v.department_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {v.role_name || '—'}
                    {v.grade_code && ` · ${v.grade_code}`}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-300">
                    {v.candidates_count}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'rounded px-2 py-0.5 text-xs font-medium ' +
                        STATUS_TONE[v.status]
                      }
                    >
                      {STATUS_LABEL[v.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDate(v.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
