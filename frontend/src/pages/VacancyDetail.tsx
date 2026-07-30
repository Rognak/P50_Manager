import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  CandidateListItem,
  Department,
  Grade,
  ProjectListItem,
  Role,
  Vacancy,
  api,
} from '../api/client'
import { Markdown } from '../components/Markdown'
import { useReadOnly } from '../lib/auth-context'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function VacancyDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const vid = Number(id)
  const readOnly = useReadOnly()

  const [v, setV] = useState<Vacancy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editReq, setEditReq] = useState('')
  const [editProjectId, setEditProjectId] = useState<number | ''>('')
  const [editDepartmentId, setEditDepartmentId] = useState<number | ''>('')
  const [editRoleId, setEditRoleId] = useState<number | ''>('')
  const [editGradeId, setEditGradeId] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<CandidateListItem[]>([])

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  const refresh = useCallback(async () => {
    try {
      const fetched = await api.vacancies.get(vid)
      setV(fetched)
      setEditTitle(fetched.title)
      setEditReq(fetched.requirements_md || '')
      setEditProjectId(fetched.project_id ?? '')
      setEditDepartmentId(fetched.department_id ?? '')
      setEditRoleId(fetched.role_id ?? '')
      setEditGradeId(fetched.grade_id ?? '')
      const all = await api.candidates.list()
      setCandidates(all.filter((c) => c.vacancy_id === vid))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [vid])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    api.projects.list().then(setProjects).catch(() => undefined)
    api.departments.list().then(setDepartments).catch(() => undefined)
    api.mpk.roles().then(setRoles).catch(() => undefined)
    api.mpk.grades().then(setGrades).catch(() => undefined)
  }, [])

  const generateTemplate = async () => {
    try {
      const res = await api.vacancies.requirementsTemplate({
        role_id: editRoleId === '' ? null : Number(editRoleId),
        grade_id: editGradeId === '' ? null : Number(editGradeId),
        project_id: editProjectId === '' ? null : Number(editProjectId),
      })
      setEditReq(res.requirements_md)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const save = async () => {
    setEditError(null)
    if (!editTitle.trim()) {
      setEditError('Введите название вакансии')
      return
    }
    if (editProjectId === '' && editDepartmentId === '') {
      setEditError('Привяжите вакансию к проекту или отделу')
      return
    }
    setSaving(true)
    try {
      const updated = await api.vacancies.update(vid, {
        title: editTitle.trim(),
        project_id: editProjectId === '' ? null : Number(editProjectId),
        department_id:
          editDepartmentId === '' ? null : Number(editDepartmentId),
        role_id: editRoleId === '' ? null : Number(editRoleId),
        grade_id: editGradeId === '' ? null : Number(editGradeId),
        requirements_md: editReq.trim() || null,
      })
      setV(updated)
      setEditing(false)
    } catch (e) {
      setEditError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async () => {
    if (!v) return
    try {
      const updated = await api.vacancies.update(vid, {
        status: v.status === 'open' ? 'closed' : 'open',
      })
      setV(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const remove = async () => {
    if (!confirm('Удалить вакансию? Кандидаты сохранятся, но отвязываются.'))
      return
    try {
      await api.vacancies.delete(vid)
      navigate('/vacancies')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!v) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/vacancies')}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← Вакансии
      </button>

      <div className="space-y-2">
        {!editing ? (
          <h1 className="text-2xl font-semibold">{v.title}</h1>
        ) : (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 text-xl font-semibold ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        )}
        {!editing && (
          <div className="flex flex-wrap items-baseline gap-3 text-sm text-slate-400">
            {v.project_name && (
              <span>
                Проект:{' '}
                <span className="text-slate-300">{v.project_name}</span>
              </span>
            )}
            {v.department_name && (
              <span>
                Отдел:{' '}
                <span className="text-slate-300">{v.department_name}</span>
              </span>
            )}
            {v.role_name && (
              <span>
                Роль: <span className="text-slate-300">{v.role_name}</span>
              </span>
            )}
            {v.grade_code && (
              <span>
                Грейд: <span className="text-slate-300">{v.grade_code}</span>
              </span>
            )}
            <span>·</span>
            <span>Кандидатов: {candidates.length}</span>
            <span>·</span>
            <span>Создана {formatDate(v.created_at)} ({v.created_by_name || '—'})</span>
            <span
              className={
                'ml-auto rounded px-2 py-0.5 text-xs ' +
                (v.status === 'open'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-500/15 text-slate-400')
              }
            >
              {v.status === 'open' ? 'открыта' : 'закрыта'}
            </span>
          </div>
        )}

        {!readOnly && (
          <div className="flex flex-wrap gap-2 pt-1">
            {!editing ? (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-slate-500 hover:text-slate-200"
                >
                  редактировать
                </button>
                <button
                  onClick={toggleStatus}
                  className="text-xs text-slate-500 hover:text-accent"
                >
                  {v.status === 'open' ? 'закрыть' : 'открыть'} вакансию
                </button>
                <button
                  onClick={remove}
                  className="text-xs text-slate-500 hover:text-rose-400"
                >
                  удалить
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg hover:bg-accent/90"
                >
                  {saving ? '…' : 'Сохранить'}
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setEditTitle(v.title)
                    setEditReq(v.requirements_md || '')
                    setEditProjectId(v.project_id ?? '')
                    setEditDepartmentId(v.department_id ?? '')
                    setEditRoleId(v.role_id ?? '')
                    setEditGradeId(v.grade_id ?? '')
                    setEditError(null)
                  }}
                  className="text-xs text-slate-500 hover:text-slate-200"
                >
                  Отмена
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {editing && (
        <section className="space-y-3 rounded-2xl bg-bg-elevated p-5">
          <div className="text-sm font-semibold text-slate-200">
            Привязка и параметры
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">Проект</span>
              <select
                value={editProjectId}
                onChange={(e) =>
                  setEditProjectId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
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
                value={editDepartmentId}
                onChange={(e) =>
                  setEditDepartmentId(
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
                value={editRoleId}
                onChange={(e) =>
                  setEditRoleId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
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
                value={editGradeId}
                onChange={(e) =>
                  setEditGradeId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
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
          {editError && (
            <div className="text-sm text-red-400">{editError}</div>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Требования к позиции
          </h2>
          {editing && (
            <button
              type="button"
              onClick={generateTemplate}
              className="rounded bg-bg-panel px-3 py-1 text-xs text-slate-300 ring-1 ring-white/5 hover:text-accent"
              title="Заполнит шаблон по выбранным role/grade/project (перезаписывает поле)"
            >
              сгенерировать шаблон
            </button>
          )}
        </div>
        {!editing ? (
          v.requirements_md ? (
            <div className="rounded-2xl bg-bg-elevated p-5">
              <Markdown content={v.requirements_md} />
            </div>
          ) : (
            <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
              Требования не заполнены. Откройте редактирование — кнопка
              «сгенерировать шаблон» соберёт стартовый текст по role/grade/project.
            </div>
          )
        ) : (
          <textarea
            rows={20}
            value={editReq}
            onChange={(e) => setEditReq(e.target.value)}
            placeholder="markdown..."
            className="w-full rounded-2xl bg-bg-elevated p-5 font-mono text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Кандидаты на эту вакансию ({candidates.length})
        </h2>
        {candidates.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Пока никого не привязали. Создайте кандидата в разделе «Кандидаты» и
            выберите эту вакансию.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-4 py-3">ФИО</th>
                  <th className="px-4 py-3">Стадия</th>
                  <th className="px-4 py-3">AI-скрининг</th>
                  <th className="px-4 py-3">Резюме</th>
                  <th className="px-4 py-3">Создан</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/hiring/${c.id}`)}
                    className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                  >
                    <td className="px-4 py-3">{c.full_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{c.stage}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.ai_screening_recommended === true ? (
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                          ✓ да
                        </span>
                      ) : c.ai_screening_recommended === false ? (
                        <span className="rounded bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-300">
                          ✗ нет
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {c.has_resume ? 'есть' : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
