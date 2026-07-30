import { useEffect, useState } from 'react'

import {
  api,
  CoverageItem,
  ProjectCoverage,
  ProjectGradeDistribution,
} from '../../api/client'

function CoverageBar({ item }: { item: CoverageItem }) {
  const total = item.members_total
  const meeting = item.members_meeting
  if (total === 0)
    return (
      <span className="text-xs text-slate-500">
        нет участников с этой компетенцией в роли
      </span>
    )
  const ratio = meeting / total
  const color =
    ratio >= 1
      ? 'bg-emerald-500'
      : ratio >= 0.5
        ? 'bg-amber-500'
        : 'bg-rose-500'
  const pct = Math.round(ratio * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-panel">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 whitespace-nowrap text-right text-xs text-slate-400">
        {meeting} / {total}
      </span>
    </div>
  )
}

export function CoveragePanel({ projectId }: { projectId: number }) {
  const [coverage, setCoverage] = useState<ProjectCoverage | null>(null)
  const [grades, setGrades] = useState<ProjectGradeDistribution | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.projects
      .coverage(projectId)
      .then(setCoverage)
      .catch((e) => setError((e as Error).message))
    api.projects.grades(projectId).then(setGrades).catch(() => undefined)
  }, [projectId])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!coverage) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-bg-elevated p-5">
          <div className="text-sm text-slate-400">Risk score</div>
          <div
            className={`mt-2 text-3xl font-semibold ${
              coverage.risk_score === 0
                ? 'text-emerald-400'
                : coverage.risk_score <= 3
                  ? 'text-accent'
                  : coverage.risk_score <= 8
                    ? 'text-amber-400'
                    : 'text-rose-400'
            }`}
          >
            {coverage.risk_score}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            суммарный дефицит уровней по тех.стеку (меньше = лучше)
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-5">
          <div className="mb-2 text-sm text-slate-400">Распределение по грейдам</div>
          {grades && grades.items.length > 0 ? (
            <div className="space-y-1 text-sm">
              {grades.items.map((g) => (
                <div key={g.grade_code} className="flex items-center gap-2">
                  <span className="w-20 text-slate-300">{g.grade_code}</span>
                  <span className="text-accent">{g.count}</span>
                </div>
              ))}
              {grades.no_grade > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-20 text-slate-500">без грейда</span>
                  <span className="text-slate-500">{grades.no_grade}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500">нет данных</div>
          )}
        </div>
        <div className="rounded-2xl bg-bg-elevated p-5">
          <div className="mb-2 text-sm text-slate-400">Тех.стек</div>
          <div className="text-3xl font-semibold text-accent">
            {coverage.items.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            компетенций в стеке проекта
          </div>
        </div>
      </div>

      {coverage.items.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Тех.стек пуст. Добавьте компетенции — увидите покрытие командой.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <div className="border-b border-white/5 px-6 py-3 text-sm font-semibold text-slate-300">
            Покрытие тех.стека командой
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="px-4 py-2">Компетенция</th>
                <th
                  className="px-4 py-2"
                  title="Учитываются только те участники, для роли которых компетенция требуется"
                >
                  Дотягивают до целевого уровня
                </th>
                <th
                  className="w-32 px-4 py-2 text-right"
                  title="Оценённые / релевантные"
                >
                  Оценено
                </th>
              </tr>
            </thead>
            <tbody>
              {coverage.items.map((it) => (
                <tr key={it.competency_id} className="border-t border-white/5">
                  <td className="px-4 py-3">{it.competency_name}</td>
                  <td className="px-4 py-3">
                    <CoverageBar item={it} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {it.members_assessed} / {it.members_total}
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
