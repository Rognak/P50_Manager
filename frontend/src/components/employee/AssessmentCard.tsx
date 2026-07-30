import { useState } from 'react'

import { api, Assessment, AssessmentListItem, Competency } from '../../api/client'

export function AssessmentCard({
  item,
  employeeId,
  competencies,
  onChanged,
}: {
  item: AssessmentListItem
  employeeId: number
  competencies: Competency[]
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<Assessment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (detail) return
    setLoading(true)
    setError(null)
    try {
      const d = await api.employees.assessments.get(employeeId, item.id)
      setDetail(d)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Удалить оценку?')) return
    try {
      await api.employees.assessments.delete(employeeId, item.id)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const compNameById = new Map(competencies.map((c) => [c.id, c.name]))

  return (
    <div className="rounded-2xl bg-bg-elevated">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-4 px-6 py-4 text-left hover:bg-bg-panel/40"
      >
        <div className="flex-1">
          <div className="font-medium">{item.assessed_at}</div>
          {item.notes && (
            <div className="mt-1 text-sm text-slate-400">{item.notes}</div>
          )}
        </div>
        <span className="rounded bg-slate-500/15 px-2 py-1 text-xs text-slate-400">
          {item.source}
        </span>
        <span className="text-slate-500">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-6 py-4">
          {loading && <div className="text-sm text-slate-500">Загрузка…</div>}
          {error && <div className="text-sm text-red-400">{error}</div>}
          {detail && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-slate-400">
                  Оценено компетенций: {detail.scores.length}
                </div>
                <button
                  onClick={remove}
                  className="text-sm text-slate-500 hover:text-red-400"
                >
                  Удалить
                </button>
              </div>
              <div className="overflow-hidden rounded-lg bg-bg-panel">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Компетенция</th>
                      <th className="w-20 px-3 py-2 text-center">Уровень</th>
                      <th className="px-3 py-2">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scores.map((s) => (
                      <tr key={s.id} className="border-t border-white/5">
                        <td className="px-3 py-2">
                          {compNameById.get(s.competency_id) || `#${s.competency_id}`}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-block min-w-[1.75rem] rounded bg-accent/15 px-2 py-0.5 text-center font-semibold text-accent">
                            {s.level}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400">{s.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
