import { Fragment, FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, ProjectListItem, ProjectStatus } from '../api/client'
import { useReadOnly } from '../lib/auth-context'

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Активен',
  on_hold: 'На паузе',
  completed: 'Завершён',
}

const STATUS_STYLE: Record<ProjectStatus, string> = {
  active: 'bg-accent/15 text-accent',
  on_hold: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-slate-500/15 text-slate-400',
}

export function Projects() {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const [items, setItems] = useState<ProjectListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  const refresh = () =>
    api.projects.list().then(setItems).catch((e) => setError((e as Error).message))

  useEffect(() => {
    refresh()
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const p = await api.projects.create({
        name: name.trim(),
        code: code.trim() || null,
      })
      navigate(`/projects/${p.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Проекты</h1>
        {!creating && !readOnly && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90"
          >
            + Создать
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={create}
          className="mb-6 flex flex-wrap gap-2 rounded-2xl bg-bg-elevated p-4"
        >
          <input
            required
            placeholder="Название проекта"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-[260px] rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <input
            placeholder="Код (опц.)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-40 rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <button className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90">
            Создать
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setName('')
              setCode('')
            }}
            className="rounded-lg px-4 py-2 text-slate-400 hover:text-slate-200"
          >
            Отмена
          </button>
        </form>
      )}

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="px-4 py-3">Название</th>
              <th className="px-4 py-3">Код</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3 text-center">Участников</th>
              <th className="px-4 py-3 text-center">В стеке</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Пока нет проектов
                </td>
              </tr>
            )}
            {(() => {
              // Сортируем: проекты с одной GitLab-группой стоят рядом, без
              // группы — в конце. В рамках группы — по имени.
              const sorted = [...items].sort((a, b) => {
                const ag = a.gitlab_group || '￿'
                const bg = b.gitlab_group || '￿'
                if (ag !== bg) return ag.localeCompare(bg)
                return a.name.localeCompare(b.name)
              })
              const groupSize = new Map<string, number>()
              for (const p of sorted) {
                if (p.gitlab_group)
                  groupSize.set(
                    p.gitlab_group,
                    (groupSize.get(p.gitlab_group) || 0) + 1,
                  )
              }
              return sorted.map((p, idx) => {
                const prev = idx > 0 ? sorted[idx - 1] : null
                const showGroupHeader =
                  !!p.gitlab_group &&
                  (groupSize.get(p.gitlab_group) || 0) > 1 &&
                  (!prev || prev.gitlab_group !== p.gitlab_group)
                return (
                  <Fragment key={p.id}>
                    {showGroupHeader && (
                      <tr className="border-t border-white/5 bg-bg-panel/20">
                        <td
                          colSpan={5}
                          className="px-4 py-1.5 text-[11px] font-mono text-slate-500"
                        >
                          📁 {p.gitlab_group}
                          <span className="ml-2 text-slate-600">
                            · {groupSize.get(p.gitlab_group || '')} репо
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                    >
                      <td className="px-4 py-3 font-medium">
                        {p.name}
                        {p.gitlab_group &&
                          (groupSize.get(p.gitlab_group) || 0) === 1 && (
                            <span
                              className="ml-2 rounded bg-bg-panel/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-500"
                              title={`GitLab group: ${p.gitlab_group}`}
                            >
                              {p.gitlab_group}
                            </span>
                          )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {p.code || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}
                        >
                          {STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.members_count}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.competencies_count}
                      </td>
                    </tr>
                  </Fragment>
                )
              })
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
