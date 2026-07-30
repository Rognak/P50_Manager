import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  api,
  EmployeeSearchItem,
  ProjectMember,
  RotationCandidate,
  RotationListItem,
} from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'
import { RotationCreateModal } from '../rotation/RotationCreateModal'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function AddMember({
  projectId,
  existingIds,
  onAdded,
}: {
  projectId: number
  existingIds: Set<number>
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<EmployeeSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleInProject, setRoleInProject] = useState('')
  const [joinedAt, setJoinedAt] = useState(todayIso())

  const search = async (e: FormEvent) => {
    e.preventDefault()
    setSearching(true)
    setError(null)
    try {
      const list = await api.employeesSearch(q, 30)
      setResults(list)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const add = async (emp: EmployeeSearchItem) => {
    setError(null)
    try {
      await api.projects.addMember(projectId, {
        employee_id: emp.id,
        role_in_project: roleInProject.trim() || null,
        joined_at: joinedAt || null,
      })
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
      >
        + Добавить участника
      </button>
    )

  return (
    <div className="space-y-2 rounded-lg bg-bg-panel/50 p-3 ring-1 ring-white/5">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input
          autoFocus
          placeholder="Поиск по ФИО или email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[220px] flex-1 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <input
          placeholder="Роль в проекте"
          value={roleInProject}
          onChange={(e) => setRoleInProject(e.target.value)}
          className="w-44 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <input
          type="date"
          title="С какой даты в проекте"
          value={joinedAt}
          onChange={(e) => setJoinedAt(e.target.value)}
          className="w-40 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
        >
          {searching ? '…' : 'Найти'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          Закрыть
        </button>
      </form>
      {error && <div className="text-xs text-red-400">{error}</div>}
      {results.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((emp) => {
            const already = existingIds.has(emp.id)
            return (
              <div
                key={emp.id}
                className="flex items-center gap-3 rounded bg-bg-panel px-3 py-2 text-sm"
              >
                <div className="flex-1">
                  <div className="font-medium">
                    {emp.full_name}
                    {!emp.is_yours && (
                      <span className="ml-2 text-xs text-slate-500">
                        ({emp.owner_name})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {emp.role_name || '—'}
                    {emp.grade_code && ` · ${emp.grade_code}`}
                  </div>
                </div>
                <button
                  disabled={already}
                  onClick={() => add(emp)}
                  className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-30"
                >
                  {already ? 'уже в проекте' : 'добавить'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ROT_STATUS_DISPLAY: Record<
  string,
  { label: string; cls: string }
> = {
  proposed: { label: 'на согласовании', cls: 'text-amber-400' },
  accepted: { label: 'согласовано', cls: 'text-accent' },
  completed: { label: 'завершено', cls: 'text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'text-slate-500' },
  reverted: { label: 'откачено', cls: 'text-slate-500' },
}

function MemberRotationCell({
  member,
  candidate,
  rotation,
  onStartRotation,
}: {
  member: ProjectMember
  candidate: RotationCandidate | undefined
  rotation: RotationListItem | undefined
  onStartRotation: () => void
}) {
  const navigate = useNavigate()

  // активная/недавняя ротация имеет приоритет
  if (rotation) {
    const stat = ROT_STATUS_DISPLAY[rotation.status]
    return (
      <button
        onClick={() => navigate('/rotations')}
        className={`text-left text-xs ${stat.cls} hover:underline`}
        title="Открыть вкладку «Ротации»"
      >
        {stat.label}
      </button>
    )
  }
  if (member.rotation_locked) {
    return null
  }
  // Кандидат → яркая ссылка с подсказкой score; иначе — обычная кнопка «ротация».
  // В обоих случаях открывает модальное окно создания ротации.
  return (
    <button
      onClick={onStartRotation}
      className={
        candidate
          ? 'text-xs text-accent hover:underline'
          : 'text-xs text-slate-400 hover:text-slate-200'
      }
      title={
        candidate
          ? `score ${candidate.score} · стаж ${candidate.tenure_months} мес.`
          : 'Запланировать ротацию для этого участника'
      }
    >
      ротация
    </button>
  )
}

export function MemberList({
  projectId,
  members,
  onChanged,
}: {
  projectId: number
  members: ProjectMember[]
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const existingIds = new Set(members.map((m) => m.employee_id))

  const [candidatesByEmp, setCandidatesByEmp] = useState<Map<number, RotationCandidate>>(
    new Map(),
  )
  const [rotByEmp, setRotByEmp] = useState<Map<number, RotationListItem>>(new Map())
  const [createForEmpId, setCreateForEmpId] = useState<number | null>(null)

  // Подгружаем кандидатов и ротации этого проекта — для inline-индикатора.
  // useCallback, чтобы можно было дёрнуть вручную после создания ротации.
  const refreshRotationsData = useCallback(async () => {
    try {
      const [panel, rots] = await Promise.all([
        api.projects.rotations(projectId).catch(() => null),
        api.rotations
          .list({ project_id: projectId })
          .catch(() => [] as RotationListItem[]),
      ])
      const cMap = new Map<number, RotationCandidate>()
      if (panel) {
        for (const c of panel.candidates) cMap.set(c.employee_id, c)
      }
      setCandidatesByEmp(cMap)
      const rMap = new Map<number, RotationListItem>()
      const sorted = [...rots].sort(
        (a, b) =>
          new Date(b.proposed_at).getTime() - new Date(a.proposed_at).getTime(),
      )
      for (const r of sorted) {
        if (
          r.status === 'proposed' ||
          r.status === 'accepted' ||
          r.status === 'completed'
        ) {
          if (!rMap.has(r.employee_id)) rMap.set(r.employee_id, r)
        }
      }
      setRotByEmp(rMap)
    } catch {
      // ignore
    }
  }, [projectId])

  useEffect(() => {
    refreshRotationsData()
  }, [refreshRotationsData, members.length])

  const formatDate = (iso: string | null): string => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const remove = async (memberId: number) => {
    if (!confirm('Убрать из проекта?')) return
    try {
      await api.projects.removeMember(projectId, memberId)
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const toggleLock = async (m: ProjectMember) => {
    try {
      if (m.rotation_locked) {
        if (!confirm('Снять заморозку ротации?')) return
        await api.projects.unlockMember(projectId, m.id)
      } else {
        const note = prompt(
          `Заморозить ${m.full_name} от ротации.\nКороткое обоснование (релиз, аудит, критическая фаза…):`,
          '',
        )
        if (note === null) return
        await api.projects.lockMember(projectId, m.id, note.trim() || null)
      }
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <AddMember projectId={projectId} existingIds={existingIds} onAdded={onChanged} />
      )}
      {createForEmpId !== null && (
        <RotationCreateModal
          initialFromProjectId={projectId}
          initialFromEmployeeId={createForEmpId}
          onClose={() => setCreateForEmpId(null)}
          onCreated={() => {
            setCreateForEmpId(null)
            refreshRotationsData()
            onChanged()
          }}
        />
      )}

      {members.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Пока нет участников
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">ФИО</th>
                <th className="px-4 py-3">Роль / грейд</th>
                <th className="px-4 py-3">Роль в проекте</th>
                <th className="px-4 py-3">В проекте с</th>
                <th className="px-4 py-3">Руководитель</th>
                <th className="px-4 py-3">Ротация</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-white/5">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/employees/${m.employee_id}`)}
                      className="text-left hover:text-accent"
                    >
                      {m.full_name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {m.role_name || '—'}
                    {m.grade_code && ` · ${m.grade_code}`}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {m.role_in_project || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatDate(m.joined_at)}
                    {m.left_at && (
                      <span className="ml-2 text-xs text-slate-500">
                        ушёл {formatDate(m.left_at)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {m.is_yours ? (
                      <span className="text-emerald-400">вы</span>
                    ) : (
                      m.owner_name || '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <MemberRotationCell
                      member={m}
                      candidate={candidatesByEmp.get(m.employee_id)}
                      rotation={rotByEmp.get(m.employee_id)}
                      onStartRotation={() => setCreateForEmpId(m.employee_id)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!readOnly && (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => toggleLock(m)}
                          className={
                            m.rotation_locked
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-slate-500 hover:text-slate-300'
                          }
                          title={
                            m.rotation_locked
                              ? `Заморожен: ${m.rotation_lock_note || '—'}`
                              : 'Заморозить от ротации'
                          }
                        >
                          {m.rotation_locked ? 'заморожен' : 'заморозить'}
                        </button>
                        <button
                          onClick={() => remove(m.id)}
                          className="text-slate-500 hover:text-red-400"
                        >
                          убрать
                        </button>
                      </div>
                    )}
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
