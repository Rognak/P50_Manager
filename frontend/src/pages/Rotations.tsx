import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  GlobalRotationCandidate,
  LockedMember,
  RotationFull,
  RotationListItem,
  api,
} from '../api/client'
import { useCurrentUser, useReadOnly } from '../lib/auth-context'
import {
  ActiveRotationCard,
  CandidateRow,
  ScoreHelp,
} from '../components/project/RotationsPanel'
import { RotationCreateModal } from '../components/rotation/RotationCreateModal'

const POLL_MS = 3000

interface ProjectGroup {
  project_id: number
  project_name: string
  project_code: string | null
  candidates: GlobalRotationCandidate[]
}

function groupByProject(items: GlobalRotationCandidate[]): ProjectGroup[] {
  const map = new Map<number, ProjectGroup>()
  for (const c of items) {
    const g = map.get(c.from_project_id)
    if (g) {
      g.candidates.push(c)
    } else {
      map.set(c.from_project_id, {
        project_id: c.from_project_id,
        project_name: c.from_project_name,
        project_code: c.from_project_code,
        candidates: [c],
      })
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.project_name.localeCompare(b.project_name, 'ru'),
  )
}

export function Rotations() {
  const readOnly = useReadOnly()
  const currentUser = useCurrentUser()
  const isPm = currentUser?.role === 'manager'
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState<GlobalRotationCandidate[]>([])
  const [activeRots, setActiveRots] = useState<RotationFull[]>([])
  const [locked, setLocked] = useState<LockedMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [lockedCollapsed, setLockedCollapsed] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [showCreate, setShowCreate] = useState(false)

  const refresh = useCallback(async () => {
    try {
      // PM не видит ни кандидатов, ни заморозок — только ротации, требующие
      // его согласования
      if (!isPm) {
        const [c, lk] = await Promise.all([
          api.rotations.candidates(),
          api.rotations.locked(),
        ])
        setCandidates(c)
        setLocked(lk)
      } else {
        setCandidates([])
        setLocked([])
      }
      const list: RotationListItem[] = await api.rotations.list()
      const filtered = list.filter((r) => {
        if (statusFilter === 'active')
          return (
            r.status === 'proposed' ||
            r.status === 'accepted' ||
            r.status === 'completed'
          )
        if (statusFilter === 'all') return true
        return r.status === statusFilter
      })
      const fulls = await Promise.all(filtered.map((r) => api.rotations.get(r.id)))
      setActiveRots(fulls)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, isPm])

  const unlock = async (m: LockedMember) => {
    if (!confirm(`Снять заморозку с ${m.full_name}?`)) return
    try {
      await api.projects.unlockMember(m.project_id, m.member_id)
      refresh()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
    api.me().then((u) => setMe(u.id)).catch(() => undefined)
  }, [refresh])

  // авто-поллинг пока есть AI-генерации в работе
  useEffect(() => {
    const hasRunning = candidates.some((c) => c.suggestion_running)
    if (!hasRunning) return
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [candidates, refresh])

  if (loading) return <div className="text-slate-500">Загрузка…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>

  const groups = groupByProject(candidates)
  const total = candidates.length
  const projectsWithCandidates = groups.length

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ротации</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isPm
              ? 'Ротации по вашим проектам, требующие вашего согласования.'
              : 'Все кандидаты на ротацию по активным проектам и lifecycle активных ротаций.'}
          </p>
        </div>
        {!readOnly && !isPm && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
          >
            + Создать ротацию
          </button>
        )}
      </div>

      {showCreate && (
        <RotationCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            refresh()
          }}
        />
      )}

      {!isPm && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-bg-elevated p-4">
            <div className="text-xs text-slate-400">Кандидатов готово</div>
            <div className="mt-1 text-2xl font-semibold text-accent">{total}</div>
          </div>
          <div className="rounded-2xl bg-bg-elevated p-4">
            <div className="text-xs text-slate-400">В работе ротаций</div>
            <div className="mt-1 text-2xl font-semibold text-amber-400">
              {
                activeRots.filter(
                  (r) => r.status === 'proposed' || r.status === 'accepted',
                ).length
              }
            </div>
          </div>
          <div className="rounded-2xl bg-bg-elevated p-4">
            <div className="text-xs text-slate-400">Bus-factor алертов</div>
            <div className="mt-1 text-2xl font-semibold text-rose-400">
              {candidates.reduce((s, c) => s + c.bus_factor_score, 0)}
            </div>
          </div>
          <div className="rounded-2xl bg-bg-elevated p-4">
            <div className="text-xs text-slate-400">Заморожено</div>
            <div className="mt-1 text-2xl font-semibold text-slate-300">
              {locked.length}
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Активные и недавние ротации ({activeRots.length})
          </h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded bg-bg-panel px-2 py-1 text-xs text-slate-300 ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            <option value="active">в работе и недавно завершённые</option>
            <option value="proposed">только на согласовании</option>
            <option value="accepted">только согласованные</option>
            <option value="completed">только завершённые</option>
            <option value="cancelled">только отменённые</option>
            <option value="reverted">только откачённые</option>
            <option value="all">все</option>
          </select>
        </div>
        {activeRots.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Нет ротаций по выбранному фильтру
          </div>
        ) : (
          <div className="space-y-2">
            {activeRots.map((r) => (
              <ActiveRotationCard
                key={r.id}
                rotation={r}
                currentUserId={me}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </section>

      {!isPm && (
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Кандидаты по проектам
        </h2>
        <div className="mb-3">
          <ScoreHelp />
        </div>
        {projectsWithCandidates > 0 && (
          <div className="mb-3 text-xs text-slate-500">
            {total} кандидатов в {projectsWithCandidates} проект
            {projectsWithCandidates === 1
              ? 'е'
              : projectsWithCandidates < 5
                ? 'ах'
                : 'ах'}
            . Если ваш проект не появляется здесь — его участники ещё не достигли
            порога 18 месяцев или все заморожены.
          </div>
        )}
        {groups.length === 0 ? (
          <div className="rounded-2xl bg-emerald-500/10 px-6 py-6 text-center text-sm text-emerald-300 ring-1 ring-emerald-500/20">
            Кандидатов на ротацию нет — никто из активных участников не достиг
            порога 18 месяцев или все заморожены.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const isExpanded = expanded[g.project_id] === true
              return (
                <div key={g.project_id}>
                  <button
                    onClick={() =>
                      setExpanded({
                        ...expanded,
                        [g.project_id]: !isExpanded,
                      })
                    }
                    className="mb-2 flex w-full items-center gap-2 text-left text-sm font-semibold text-slate-200 hover:text-accent"
                  >
                    <span className="text-xs text-slate-500">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span>{g.project_name}</span>
                    {g.project_code && (
                      <span className="text-slate-500">({g.project_code})</span>
                    )}
                    <span className="text-xs text-slate-500">
                      · {g.candidates.length} кандидат
                      {g.candidates.length === 1 ? '' : g.candidates.length < 5 ? 'а' : 'ов'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="space-y-2">
                      {g.candidates.map((c) => (
                        <CandidateRow
                          key={`${g.project_id}-${c.employee_id}`}
                          candidate={c}
                          projectId={g.project_id}
                          currentUserId={me}
                          onChanged={refresh}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
      )}

      {!isPm && locked.length > 0 && (
        <section>
          <button
            onClick={() => setLockedCollapsed(!lockedCollapsed)}
            className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300"
          >
            <span className="text-xs">{lockedCollapsed ? '▶' : '▼'}</span>
            <span>Заморожены от ротации ({locked.length})</span>
          </button>
          {!lockedCollapsed && (
            <div className="overflow-hidden rounded-2xl bg-bg-elevated">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-panel text-slate-400">
                  <tr>
                    <th className="px-4 py-3">ФИО</th>
                    <th className="px-4 py-3">Проект</th>
                    <th className="px-4 py-3">Стаж</th>
                    <th className="px-4 py-3">Руководитель</th>
                    <th className="px-4 py-3">Причина</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {locked.map((m) => (
                    <tr key={m.member_id} className="border-t border-white/5">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/employees/${m.employee_id}`)}
                          className="text-left hover:text-accent"
                        >
                          {m.full_name}
                        </button>
                        <div className="text-xs text-slate-500">
                          {m.role_name || '—'}
                          {m.grade_code && ` · ${m.grade_code}`}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/projects/${m.project_id}`)}
                          className="text-left text-slate-300 hover:text-accent"
                        >
                          {m.project_name}
                        </button>
                        {m.project_code && (
                          <div className="text-xs text-slate-500">
                            {m.project_code}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {m.tenure_months} мес
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {m.owner_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-amber-300">
                        {m.rotation_lock_note || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!readOnly && (
                          <button
                            onClick={() => unlock(m)}
                            className="text-xs text-slate-500 hover:text-accent"
                          >
                            снять заморозку
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
