import { useCallback, useEffect, useState } from 'react'

import {
  api,
  AssessmentListItem,
  Competency,
  MpkHistory,
  MpkProfile,
} from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'

import { AssessmentCard } from './AssessmentCard'
import { AssessmentForm } from './AssessmentForm'
import { DynamicsChart } from './DynamicsChart'
import { RecommendationsSection } from './RecommendationsSection'

function LevelBadge({ level, muted = false }: { level: number; muted?: boolean }) {
  const style = muted ? 'text-slate-400 bg-bg-panel' : 'text-accent bg-accent/15'
  return (
    <span
      className={`inline-block min-w-[1.75rem] rounded px-2 py-0.5 text-center font-semibold ${style}`}
    >
      {level}
    </span>
  )
}

function GapBadge({ gap }: { gap: number }) {
  if (gap === 0) return <span className="text-slate-500">0</span>
  if (gap > 0) return <span className="font-semibold text-amber-400">+{gap}</span>
  return <span className="font-semibold text-emerald-400">{gap}</span>
}

export function MpkTab({ employeeId }: { employeeId: number }) {
  const readOnly = useReadOnly()
  const [profile, setProfile] = useState<MpkProfile | null>(null)
  const [competencies, setCompetencies] = useState<Competency[] | null>(null)
  const [history, setHistory] = useState<AssessmentListItem[]>([])
  const [dynamics, setDynamics] = useState<MpkHistory | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [p, c, h, dyn] = await Promise.all([
        api.employees.mpkProfile(employeeId),
        api.mpk.competencies(),
        api.employees.assessments.list(employeeId),
        api.employees.mpkHistory(employeeId),
      ])
      setProfile(p)
      setCompetencies(c)
      setHistory(h)
      setDynamics(dyn)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [employeeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!profile || !competencies || !dynamics) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-sm text-slate-400">
          {profile.role ? (
            <>
              Роль: <span className="text-slate-200">{profile.role.name}</span> ·{' '}
              <span className="text-slate-200">{profile.grade?.code}</span>
            </>
          ) : (
            <span className="text-amber-400/80">
              Роль/грейд не назначены — требуемые уровни не отображаются. Задайте во
              вкладке «Профиль».
            </span>
          )}
        </div>
        <div className="flex-1" />
        {profile.last_assessment && (
          <div className="text-sm text-slate-400">
            Последняя оценка: {profile.last_assessment.assessed_at} · всего: {history.length}
          </div>
        )}
        {!readOnly && (
          <button
            onClick={() => setFormOpen(true)}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90"
          >
            Новая оценка
          </button>
        )}
      </div>

      {formOpen && (
        <AssessmentForm
          employeeId={employeeId}
          competencies={competencies}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            refresh()
          }}
        />
      )}

      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="w-12 px-4 py-3 text-right">#</th>
              <th className="px-4 py-3">Компетенция</th>
              <th className="w-24 px-4 py-3 text-center">Текущий</th>
              <th className="w-24 px-4 py-3 text-center">Требуемый</th>
              <th className="w-16 px-4 py-3 text-center">Δ</th>
            </tr>
          </thead>
          <tbody>
            {profile.items.map((i, idx) => (
              <tr
                key={i.competency_id}
                className="border-t border-white/5 hover:bg-bg-panel/40"
              >
                <td className="px-4 py-3 text-right text-slate-500">{idx + 1}</td>
                <td className="px-4 py-3">{i.competency_name}</td>
                <td className="px-4 py-3 text-center">
                  {i.current_level === null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <LevelBadge level={i.current_level} />
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {i.required_level === null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <LevelBadge level={i.required_level} muted />
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {i.gap === null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <GapBadge gap={i.gap} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DynamicsChart history={dynamics} />

      <RecommendationsSection employeeId={employeeId} />

      {history.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-400">
            История оценок ({history.length})
          </h3>
          <div className="space-y-2">
            {history.map((a) => (
              <AssessmentCard
                key={a.id}
                item={a}
                employeeId={employeeId}
                competencies={competencies}
                onChanged={refresh}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
